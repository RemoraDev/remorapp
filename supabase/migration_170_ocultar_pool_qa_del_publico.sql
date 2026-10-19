-- Migración 170, a pedido del usuario: las cuentas/clanes del pool de
-- pruebas (scripts/sembrar-pool-qa.mjs) no deben aparecer en nada
-- público -- ni rankings, ni Hall of Fame, ni buscadores. Son de uso
-- exclusivo de staff/admin para probar mecánicas. Se agrega una
-- columna marcadora y se filtra en cada función/listado público.
alter table public.profiles add column es_cuenta_prueba boolean not null default false;
alter table public.teams add column es_cuenta_prueba boolean not null default false;

-- Marca retroactivamente el pool que ya se creó antes de esta
-- migración (si corriste sembrar-pool-qa.mjs antes de esto).
update public.profiles set es_cuenta_prueba = true where nick like 'QAPoolJugador%' or nick like 'QAPoolEquipo%';
update public.teams set es_cuenta_prueba = true where name like 'QA Pool Equipo%';

-- ranking_clanes(): excluye clanes de prueba del ranking público.
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
    and not t.es_cuenta_prueba
  group by t.id, t.name, t.tag, t.logo_url
  order by torneos_ganados desc, t.name asc;
$$;

-- ranking_jugadores(): excluye jugadores de prueba del ranking público.
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
    and not p.es_cuenta_prueba
  order by tot.victorias desc, p.nick asc nulls last;
$$;

-- ranking_actividad_clanes(): excluye clanes de prueba.
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
      and not t.es_cuenta_prueba
  )
  select team_id, team_name, team_tag, logo_url, actividades
  from conteo
  where actividades > 0
  order by actividades desc, team_name asc;
$$;

-- buscar_equipos_publicos_cw(): excluye clanes de prueba del buscador
-- de rivales para Clan War Amistosa.
create or replace function public.buscar_equipos_publicos_cw(p_query text, p_excluir_team_id uuid default null)
returns table (
  id uuid,
  name text,
  tag text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.tag
  from public.teams t
  where t.is_public
    and not t.disuelto
    and not t.banca_rota
    and not t.es_cuenta_prueba
    and (p_excluir_team_id is null or t.id <> p_excluir_team_id)
    and (
      unaccent(lower(t.name)) ilike '%' || unaccent(lower(p_query)) || '%'
      or unaccent(lower(t.tag)) ilike '%' || unaccent(lower(p_query)) || '%'
    )
  order by t.name
  limit 10;
$$;
