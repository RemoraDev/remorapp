-- Migración 148: Mini eventos privados por clan -- a pedido del
-- usuario, para que los resultados de Race War y Clan War Amistosa no
-- se pierdan. Cada Race War queda ligada al clan de quien la creó
-- (equipo_creador_id, nuevo) en el momento de crearla; una Clan War
-- Amistosa ya estaba ligada a sus dos clanes (challenger_team_id/
-- challenged_team_id), así que no hace falta ninguna columna nueva
-- ahí -- solo se filtra para excluir las que son parte de un torneo
-- por ligas (esas ya tienen su propia página pública, no son
-- "privadas" de nadie).
--
-- Pestaña nueva "Mini eventos" en /ranking (RankingPage.tsx): oculta
-- al público, solo la ve quien pertenece a un clan, y solo muestra
-- los mini eventos y el ranking de ESE clan -- nunca los de otro.

-- 1) Race War: a qué clan pertenece (el del creador al momento de
-- crearla). Nullable -- quien no pertenece a ningún equipo igual
-- puede crear una Race War, simplemente no aparece en el "Mini
-- eventos" de nadie.
alter table public.guerra_razas add column equipo_creador_id uuid references public.teams (id);

-- crear_race_war(): mismo cuerpo de la migración 137 (último), solo
-- suma completar equipo_creador_id con el equipo actual de quien la
-- crea.
drop function if exists public.crear_race_war(text);

create or replace function public.crear_race_war(p_titulo text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_race_war_id uuid;
  v_titulo text;
  v_equipo_id uuid;
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  v_titulo := nullif(trim(p_titulo), '');

  select team_id into v_equipo_id
  from public.team_members
  where user_id = auth.uid()
  limit 1;

  -- Valores placeholder en las columnas que exige tournaments pero que
  -- un Race War nunca usa (formato/modo/cupos_totales/fecha_inicio) --
  -- nadie se inscribe ni juega partidas acá, es solo el anfitrión
  -- técnico del marcador.
  insert into public.tournaments (
    nombre, formato, modo, publico, cupos_totales, fecha_inicio, creador_id
  ) values (
    coalesce(v_titulo, 'Race War'), '1v1', 'eliminacion_simple', false, 2, now(), auth.uid()
  )
  returning id into v_tournament_id;

  insert into public.guerra_razas (tournament_id, creado_por, equipo_creador_id)
  values (v_tournament_id, auth.uid(), v_equipo_id)
  returning id into v_race_war_id;

  return v_race_war_id;
end;
$$;

grant execute on function public.crear_race_war(text) to authenticated;

-- 2) mis_minieventos_clan(): Race Wars creadas por mi clan + Clan Wars
-- Amistosas (no de torneo) donde mi clan jugó, de cualquiera de los
-- dos lados. Vacío si no pertenezco a ningún equipo.
create or replace function public.mis_minieventos_clan()
returns table (
  tipo text,
  id uuid,
  titulo text,
  fecha timestamptz,
  rival_nombre text,
  resultado text
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
    null::text as resultado
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
    end as resultado
  from public.clan_wars cw
  cross join mi_equipo me
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where me.team_id is not null
    and (cw.challenger_team_id = me.team_id or cw.challenged_team_id = me.team_id)
    and not exists (
      select 1 from public.tournament_group_matches tgm where tgm.clan_war_id = cw.id
    )
  order by 4 desc;
$$;

grant execute on function public.mis_minieventos_clan() to authenticated;

-- 3) ranking_minieventos_clan(): ranking privado -- puntos acumulados
-- por jugador (el nombre libre que se escribió en cada Race War, ver
-- guerra_razas_jugadores -- no está ligado a una cuenta real) a
-- través de TODAS las Race War de mi clan, no solo una.
create or replace function public.ranking_minieventos_clan()
returns table (
  jugador_nombre text,
  puntos bigint
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
    grj.nombre,
    sum(p.puntos)::bigint as puntos
  from public.guerra_razas_puntos_jugador p
  join public.guerra_razas gr on gr.id = p.guerra_id
  join public.guerra_razas_jugadores grj on grj.id = p.jugador_id
  cross join mi_equipo me
  where me.team_id is not null and gr.equipo_creador_id = me.team_id
  group by grj.nombre
  order by puntos desc;
$$;

grant execute on function public.ranking_minieventos_clan() to authenticated;
