-- ------------------------------------------------------------
-- Migración 059: dos agregados independientes para Inicio.
--
-- 1. Ranking de clanes por liga: nueva columna tournaments.liga_ranking,
--    elegida por el organizador al crear el torneo (mismo patrón que
--    formato_liga, migración 057) -- no se intenta adivinar la liga
--    por el nombre del torneo. "General" no es un valor propio: se
--    calcula sumando los torneos ganados en las tres ligas.
-- 2. Clan Wars próximas en Inicio: clan_wars_proximas() expone en
--    forma pública (sin las columnas privadas del lineup, motivo de
--    rechazo, etc.) las guerras programadas, mismo espíritu que
--    overlay_clan_war() (migración 044) -- ninguna de las dos existía
--    para consultarse desde fuera del propio equipo hasta ahora.
-- ------------------------------------------------------------

alter table public.tournaments
  add column liga_ranking text check (liga_ranking in ('starleague_latam', 'btl', 'vtl'));

-- ------------------------------------------------------------
-- ranking_clanes_liga(): cantidad de torneos ganados por equipo,
-- filtrando por liga_ranking (o sumando las tres si p_liga es null,
-- para "General"). Solo entran los torneos POR EQUIPO (2v2/3v3/4v4):
-- un torneo 1v1 nunca tiene un team_id como ganador, así que el join
-- con tournament_participants.team_id ya los excluye solo. Un torneo
-- sin liga_ranking asignada (organizador no eligió ninguna) no cuenta
-- ni para su liga (no tiene) ni para "General" -- "General" es la
-- suma de las tres, no de todos los torneos que existen.
-- ------------------------------------------------------------
create or replace function public.ranking_clanes_liga(p_liga text default null)
returns table (
  team_id uuid,
  team_name text,
  team_tag text,
  logo_url text,
  torneos_ganados bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    t.name as team_name,
    t.tag as team_tag,
    t.logo_url,
    count(tn.id) as torneos_ganados
  from public.teams t
  join public.tournament_participants tp on tp.team_id = t.id
  join public.tournaments tn
    on tn.id = tp.tournament_id
    and tn.campeon_participant_id = tp.id
    and tn.estado = 'finalizado'
    and (
      (p_liga is null and tn.liga_ranking is not null)
      or tn.liga_ranking = p_liga
    )
  where not t.disuelto
  group by t.id, t.name, t.tag, t.logo_url
  order by torneos_ganados desc, t.name asc;
$$;

grant execute on function public.ranking_clanes_liga(text) to anon, authenticated;

-- ------------------------------------------------------------
-- clan_wars_proximas(): guerras confirmadas ('aceptada') todavía en
-- el futuro, más las que ya están 'en_curso' en este momento --
-- ordenadas por fecha, sin límite: la misma lista sirve para el
-- widget de Inicio (que se queda solo con hoy/mañana) y para el
-- listado completo ("Ver horario completo"), filtrando cada uno en
-- el frontend en vez de duplicar la consulta.
-- ------------------------------------------------------------
create or replace function public.clan_wars_proximas()
returns table (
  id uuid,
  fecha_hora_cet timestamptz,
  formato text,
  challenger_nombre text,
  challenger_tag text,
  challenger_logo_url text,
  challenged_nombre text,
  challenged_tag text,
  challenged_logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cw.id,
    cw.fecha_hora_cet,
    cw.formato,
    tc.name as challenger_nombre,
    tc.tag as challenger_tag,
    tc.logo_url as challenger_logo_url,
    td.name as challenged_nombre,
    td.tag as challenged_tag,
    td.logo_url as challenged_logo_url
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where cw.status = 'en_curso' or (cw.status = 'aceptada' and cw.fecha_hora_cet >= now())
  order by cw.fecha_hora_cet asc;
$$;

grant execute on function public.clan_wars_proximas() to anon, authenticated;
