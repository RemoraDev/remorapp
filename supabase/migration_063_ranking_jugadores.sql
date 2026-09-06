-- ------------------------------------------------------------
-- Migración 063: ranking de jugadores por cantidad total de partidas
-- ganadas -- independiente de liga, división o evento puntual. Suma
-- tres fuentes distintas de "victoria":
--   1. Partidas 1v1 de torneo, tanto de la llave eliminatoria
--      (bracket_matches) como de la etapa de grupos
--      (tournament_group_matches) -- ambas ya usan el mismo concepto
--      de "ganador_id"/"winner_id" resuelto a un participante.
--   2. Partidas individuales de Clan War en formato simple
--      (clan_war_matches.ganador_id).
--   3. Sets ganados en Clan War formato WTL (clan_war_wtl_sets,
--      comparando mapas_ganados_challenger vs mapas_ganados_challenged).
-- ------------------------------------------------------------
create or replace function public.ranking_jugadores()
returns table (
  jugador_id uuid,
  nick text,
  unique_id text,
  liga text,
  raza_principal text,
  team_id uuid,
  team_name text,
  team_tag text,
  team_logo_url text,
  victorias bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with victorias_bracket_1v1 as (
    select tp.user_id as jugador_id, count(*) as cnt
    from public.bracket_matches bm
    join public.tournaments t on t.id = bm.tournament_id
    join public.tournament_participants tp on tp.id = bm.winner_id
    where t.formato = '1v1'
      and bm.status = 'jugado'
      and bm.participant1_id is not null
      and bm.participant2_id is not null
      and tp.user_id is not null
    group by tp.user_id
  ),
  victorias_grupos_1v1 as (
    select tp.user_id as jugador_id, count(*) as cnt
    from public.tournament_group_matches gm
    join public.tournament_groups g on g.id = gm.group_id
    join public.tournaments t on t.id = g.tournament_id
    join public.tournament_participants tp on tp.id = gm.ganador_id
    where t.formato = '1v1'
      and gm.status = 'jugado'
      and tp.user_id is not null
    group by tp.user_id
  ),
  victorias_cw_simple as (
    select ganador_id as jugador_id, count(*) as cnt
    from public.clan_war_matches
    where status = 'jugado' and ganador_id is not null
    group by ganador_id
  ),
  victorias_wtl as (
    select jugador_id, count(*) as cnt
    from (
      select jugador_challenger_id as jugador_id
      from public.clan_war_wtl_sets
      where status = 'jugado' and mapas_ganados_challenger > mapas_ganados_challenged
      union all
      select jugador_challenged_id as jugador_id
      from public.clan_war_wtl_sets
      where status = 'jugado' and mapas_ganados_challenged > mapas_ganados_challenger
    ) w
    group by jugador_id
  ),
  totales as (
    select jugador_id, sum(cnt) as victorias
    from (
      select * from victorias_bracket_1v1
      union all
      select * from victorias_grupos_1v1
      union all
      select * from victorias_cw_simple
      union all
      select * from victorias_wtl
    ) todas
    group by jugador_id
  )
  select
    p.id as jugador_id,
    p.nick,
    p.unique_id,
    p.liga_1v1 as liga,
    pj.datos ->> 'raza_principal' as raza_principal,
    tm.team_id,
    te.name as team_name,
    te.tag as team_tag,
    te.logo_url as team_logo_url,
    tot.victorias
  from totales tot
  join public.profiles p on p.id = tot.jugador_id
  left join public.catalogo_juegos cj on cj.nombre = 'StarCraft II'
  left join public.perfiles_juego pj on pj.user_id = p.id and pj.juego_id = cj.id
  left join public.team_members tm on tm.user_id = p.id
  left join public.teams te on te.id = tm.team_id
  order by tot.victorias desc, p.nick asc nulls last;
$$;

grant execute on function public.ranking_jugadores() to anon, authenticated;
