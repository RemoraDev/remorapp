-- Migración 164: "Clanes más activos" -- a pedido del usuario, nueva
-- sub-pestaña de Ranking junto a "Ranking de clanes" y "Ranking de
-- jugadores". Cuenta actividad real de cada clan: Clan Wars
-- (finalizadas/empatadas/en curso, como challenger o challenged),
-- torneos en los que participó (como equipo) y Race War que organizó.
-- No filtra por liga/división -- es un solo número de actividad total.
create or replace function public.ranking_actividad_clanes()
returns table (
  team_id uuid,
  team_name text,
  team_tag text,
  logo_url text,
  actividades bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with conteo as (
    select
      t.id as team_id,
      t.name as team_name,
      t.tag as team_tag,
      t.logo_url,
      (
        coalesce((
          select count(*) from public.clan_wars cw
          where (cw.challenger_team_id = t.id or cw.challenged_team_id = t.id)
            and cw.status in ('finalizada', 'empatada', 'en_curso')
        ), 0)
        + coalesce((
          select count(*) from public.tournament_participants tp where tp.team_id = t.id
        ), 0)
        + coalesce((
          select count(*) from public.guerra_razas gr where gr.equipo_creador_id = t.id
        ), 0)
      ) as actividades
    from public.teams t
    where not t.disuelto
  )
  select team_id, team_name, team_tag, logo_url, actividades
  from conteo
  where actividades > 0
  order by actividades desc, team_name asc;
$$;

grant execute on function public.ranking_actividad_clanes() to anon, authenticated;
