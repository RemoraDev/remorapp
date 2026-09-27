-- ------------------------------------------------------------
-- Migración 114: hoy cualquier usuario que crea un "torneo por ligas"
-- y lo termina con un clan/jugador campeón mete ese resultado directo
-- en el Ranking de clanes y el Ranking de jugadores públicos, sin
-- ningún control -- reportado por el usuario: "cualquiera que hace una
-- liga puede meter eso ahí". Se agrega una aprobación manual: solo
-- torneos por ligas (liga_id is not null) marcados aprobado_para_ranking
-- por el staff, un admin o el dueño de la plataforma cuentan para
-- cualquiera de los dos rankings.
--
-- Default false para TODOS los torneos, incluidos los que ya existen
-- -- de ahora en más los dos rankings quedan vacíos hasta que el staff
-- revise y apruebe manualmente los torneos por ligas que considere
-- importantes, desde el Panel de Administración ("Torneos").
--
-- Los torneos 1v1 SIN liga (amistosos, uno contra otro sin división)
-- no se tocan: siguen sumando victorias al Ranking de jugadores igual
-- que antes -- el problema reportado es específico de "ligas", no de
-- cualquier torneo 1v1.
-- ------------------------------------------------------------

alter table public.tournaments
  add column aprobado_para_ranking boolean not null default false;

create or replace function public.admin_aprobar_torneo_ranking(p_tournament_id uuid, p_aprobado boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.es_staff() or public.es_dueno_plataforma()) then
    raise exception 'Solo el staff, un admin o el dueño de la plataforma puede aprobar un torneo para el ranking.';
  end if;

  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'Ese torneo no existe.';
  end if;

  update public.tournaments set aprobado_para_ranking = p_aprobado where id = p_tournament_id;
end;
$$;

grant execute on function public.admin_aprobar_torneo_ranking(uuid, boolean) to authenticated;

create or replace function public.ranking_clanes(p_liga_id uuid default null, p_division_id uuid default null)
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
    and tn.aprobado_para_ranking
    and (
      (p_liga_id is null and tn.liga_id is not null)
      or (
        p_liga_id is not null
        and tn.liga_id = p_liga_id
        and (p_division_id is null or tn.division_id = p_division_id)
      )
    )
  where not t.disuelto
  group by t.id, t.name, t.tag, t.logo_url
  order by torneos_ganados desc, t.name asc;
$$;

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
      and (t.liga_id is null or t.aprobado_para_ranking)
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
      and (t.liga_id is null or t.aprobado_para_ranking)
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
  where not p.suspendido
  order by tot.victorias desc, p.nick asc nulls last;
$$;

grant execute on function public.ranking_jugadores() to anon, authenticated;
