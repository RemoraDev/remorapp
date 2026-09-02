-- ============================================================
-- Migración 036: perfil de jugador vitrina + barra de estadísticas de
-- Inicio.
--
-- Los puntos 1 (sacar los formularios de /jugador/:nick/:uniqueId) y
-- 3 (banner de estadísticas en Inicio) son solo de frontend, salvo el
-- conteo en sí, que ya se puede hacer con las tablas existentes
-- (profiles, tournaments) sin nada nuevo acá.
--
-- carisma: como valentia_jugador (0-100, default 50), pero SIN
-- ninguna lógica todavía que lo suba o baje -- queda como un valor
-- fijo hasta que se defina cómo debería cambiar (decisión explícita
-- del usuario, no se inventó ningún sistema de cálculo).
--
-- horario_stream: texto libre, sin estructura de días/horas, tal como
-- se pidió.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.profiles
  add column if not exists carisma integer not null default 50
    check (carisma >= 0 and carisma <= 100);

alter table public.profiles
  add column if not exists horario_stream text;

revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, avatar_forma,
  banner_url, bio, links_transmision, horario_stream,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable, carisma,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

-- carisma NO entra en este grant a propósito -- no hay ninguna
-- función ni flujo todavía que lo cambie, ni manual ni automático.
revoke update on public.profiles from authenticated;

grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, avatar_forma, banner_url, bio, links_transmision, horario_stream
) on public.profiles to authenticated;
