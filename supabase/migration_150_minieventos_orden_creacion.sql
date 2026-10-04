-- Migración 150: mis_minieventos_clan() ordenaba por "fecha" (la
-- fecha_hora_cet programada de la Clan War, no cuándo se creó) -- a
-- pedido del usuario, ahora se suma una columna nueva orden_creacion
-- (creado_en de la Race War / created_at de la Clan War) y se ordena
-- por ESA, ascendente (orden de creación real). La pestaña de Mini
-- eventos en el frontend (RankingPage.tsx) además separa Race War y
-- Clan War Amistosa en sub-pestañas, así que ya no hace falta
-- intercalarlas en una sola lista por fecha.
drop function if exists public.mis_minieventos_clan();

create or replace function public.mis_minieventos_clan()
returns table (
  tipo text,
  id uuid,
  titulo text,
  fecha timestamptz,
  rival_nombre text,
  resultado text,
  orden_creacion timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with mi_equipo as (
    select team_id from public.team_members where user_id = auth.uid() limit 1
  )
  select
    'race_war'::text as tipo,
    gr.id,
    coalesce(t.nombre, 'Race War') as titulo,
    gr.creado_en as fecha,
    null::text as rival_nombre,
    null::text as resultado,
    gr.creado_en as orden_creacion
  from public.guerra_razas gr
  join public.tournaments t on t.id = gr.tournament_id
  cross join mi_equipo me
  where me.team_id is not null and gr.equipo_creador_id = me.team_id

  union all

  select
    'clan_war_amistosa'::text as tipo,
    cw.id,
    coalesce(cw.titulo, 'Clan War Amistosa') as titulo,
    cw.fecha_hora_cet as fecha,
    case when cw.challenger_team_id = me.team_id then td.name else tc.name end as rival_nombre,
    case
      when cw.ganador_team_id is null then null
      when cw.ganador_team_id = me.team_id then 'Ganada'
      else 'Perdida'
    end as resultado,
    cw.created_at as orden_creacion
  from public.clan_wars cw
  cross join mi_equipo me
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where me.team_id is not null
    and (cw.challenger_team_id = me.team_id or cw.challenged_team_id = me.team_id)
    and not exists (
      select 1 from public.tournament_group_matches tgm where tgm.clan_war_id = cw.id
    )
  order by 7 asc;
$$;

grant execute on function public.mis_minieventos_clan() to authenticated;

-- Limpieza de datos: liga "Racewar" creada sin querer durante pruebas
-- (confirmado con el usuario) -- los dos torneos que la tenían
-- enganchada (uno de ellos ya era un fixture de QA) quedan sin liga en
-- vez de romperse.
update public.tournaments set liga_id = null where liga_id = 'c52cda72-ba4f-4a31-8814-8c0c344845db';
delete from public.ligas where id = 'c52cda72-ba4f-4a31-8814-8c0c344845db';

-- Limpieza de datos: la Race War de prueba "e116dc1f-..." (equipo QAPNL,
-- sin jugadores ni puntos cargados) quedó de las pruebas en vivo del
-- punto 10 de la migración 148 -- se borra junto con el tournament
-- placeholder que la sostiene.
delete from public.guerra_razas where id = 'e116dc1f-735a-4ae6-a0ae-be96a97cc9de';
delete from public.tournaments where id = '900ba3ef-07f3-4330-8659-d92bd8e6484a';
