-- ============================================================
-- Migración 030: Sala de la Fama -- Muro de Campeones, Muro de
-- Jugadores, y la Galería de Batallas Épicas. La mayoría de esto se
-- arma en el frontend consultando datos que ya existen; esta
-- migración agrega solo lo que genuinamente faltaba:
--
--   1) gran_maestro_alcanzado_en: no existía ninguna forma de saber
--      CUÁNDO (ni si alguna vez) un jugador llegó por primera vez a
--      Gran Maestro -- liga_1v1 es una columna GENERATED que solo
--      refleja el estado actual, no guarda historia. Sin este campo,
--      "alcanzando Gran Maestro por primera vez" en la Galería
--      hubiera sido una fecha inventada. Se llena sola (no se manda
--      a mano) la primera vez que liga_1v1 pasa a ser 'Gran Maestro',
--      y nunca se vuelve a tocar después (aunque el MMR baje y suba
--      de nuevo, sigue siendo la PRIMERA vez).
--
--   2) titulos_activos_todos(): titulos_padre_hijo tiene RLS
--      restringida a los propios participantes (migración 026) -- a
--      propósito, para no exponer negociaciones pendientes. Pero el
--      Muro de Campeones/Jugadores y la Galería necesitan mostrar
--      CUALQUIER título activo de CUALQUIERA, públicamente. En vez de
--      pedir uno por uno con titulos_activos_de() (ya pública, pero
--      pensada para "los títulos de este equipo puntual"), esta
--      función trae todos los activos de un tipo de una sola vez.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.profiles add column gran_maestro_alcanzado_en timestamptz;

-- Solo puede escribirse sola, nunca a mano: no se agrega a ninguna
-- lista de columnas de UPDATE. Dispara después de un update real de
-- mmr_1v1 -- generated columns como liga_1v1 recién están calculadas
-- y visibles para triggers AFTER, no BEFORE, así que hace falta un
-- segundo UPDATE puntual en vez de asignar NEW directo.
create or replace function public.registrar_gran_maestro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.liga_1v1 = 'Gran Maestro' and new.gran_maestro_alcanzado_en is null then
    update public.profiles set gran_maestro_alcanzado_en = now() where id = new.id;
  end if;
  return new;
end;
$$;

create trigger after_update_profiles_gran_maestro
  after update of mmr_1v1 on public.profiles
  for each row execute function public.registrar_gran_maestro();

-- gran_maestro_alcanzado_en se suma a la lista pública de SELECT --
-- es un logro, se muestra en la Galería para cualquiera.
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

-- Todos los títulos activos de un tipo, de una sola vez -- pública,
-- sin restricción de participante (a diferencia de la RLS de la tabla
-- base, que sí la tiene). El frontend resuelve nombres y arma "Padre
-- de.../Hijo de..." con esto.
create or replace function public.titulos_activos_todos(p_tipo text)
returns table (
  id uuid,
  retador_id uuid,
  retado_id uuid,
  ganador_id uuid,
  duracion_dias integer,
  fecha_inicio timestamptz,
  fecha_fin timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.retador_id, t.retado_id, t.ganador_id, t.duracion_dias, t.fecha_inicio, t.fecha_fin
  from public.titulos_padre_hijo t
  where t.tipo = p_tipo and t.status = 'activo';
$$;

grant execute on function public.titulos_activos_todos(text) to anon, authenticated;
