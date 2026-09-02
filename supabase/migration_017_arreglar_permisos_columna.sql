-- ============================================================
-- Migración 017: arregla una falla real de privacidad/seguridad que
-- viene desde hace tiempo -- no es solo sobre es_dueno_plataforma.
--
-- LA CAUSA RAÍZ: en Postgres, "grant select on tabla to rol" (toda la
-- tabla) y "revoke select (columna) on tabla from rol" son entradas
-- INDEPENDIENTES. El revoke de columna solo puede sacar un permiso
-- que se otorgó específicamente a esa columna -- NO puede recortar un
-- grant de tabla completa que ya cubre todas las columnas. El patrón
-- "grant select on profiles to X" + después "revoke select (email)
-- on profiles from X" nunca funcionó: profiles.email sigue siendo
-- legible con un select común desde la migración 004. El mismo error
-- se repitió esta sesión con es_dueno_plataforma (migración 016) y
-- con profiles.xp / teams.xp (migración 013) -- ese último significa
-- que, hasta correr esto, cualquiera podía regalarse XP con un update
-- directo a su propia fila.
--
-- EL ARREGLO: en vez de "otorgar todo, después sacar una columna",
-- hay que "sacar todo, después otorgar solo las columnas permitidas"
-- -- la única forma en que Postgres deja expresar esto de verdad.
--
-- De paso, protege profiles.suspendido: nunca tuvo ninguna protección
-- real más allá de "solo podés editar tu propia fila" (que no
-- restringe columnas) -- cualquier cuenta suspendida podía
-- reactivarse sola con un update directo. Ahora un trigger exige que
-- quien cambie suspendido sea administrador (o que venga directo del
-- SQL Editor).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) profiles: SELECT solo por lista explícita de columnas (excluye
--    email y es_dueno_plataforma).
-- ------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, bio,
  cuenta_validada, suspendido, creado_en, xp, nivel
) on public.profiles to anon, authenticated;

-- ------------------------------------------------------------
-- 2) profiles: UPDATE solo por lista explícita de columnas -- son
--    exactamente las que la app necesita tocar hoy (revisado en todo
--    el frontend): identidad de jugador, caster, avatar, y perfil_tipo
--    / suspendido desde /admin. Deja afuera xp, es_admin,
--    es_dueno_plataforma, unique_id, cuenta_validada -- esas ya están
--    protegidas por sus propios triggers, y ninguna función legítima
--    de la app necesita escribirlas directo.
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;

grant update (
  nombre, perfil_tipo, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, suspendido
) on public.profiles to authenticated;

-- suspendido queda en la lista de arriba porque un admin SÍ necesita
-- poder tocarlo (desde /admin) -- pero un admin también corre como el
-- rol "authenticated", igual que cualquier usuario común, así que un
-- grant/revoke de columna no puede distinguir "admin suspendiendo a
-- otro" de "usuario reactivándose a sí mismo". Por eso hace falta
-- este trigger aparte, que sí conoce quién es cada uno.
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;

    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    elsif new.suspendido is distinct from old.suspendido and not public.is_admin() then
      new.suspendido := old.suspendido;
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) teams: UPDATE solo por lista explícita de columnas -- excluye
--    xp (arreglando el mismo problema que profiles.xp) y también
--    name/tag (ya protegidos por su propio trigger,
--    proteger_nombre_y_tag_equipo, pero afuera de la lista de todas
--    formas: ninguna función legítima los necesita escribibles acá).
-- ------------------------------------------------------------
revoke update on public.teams from authenticated;

grant update (description, logo_url, banner_url) on public.teams to authenticated;
