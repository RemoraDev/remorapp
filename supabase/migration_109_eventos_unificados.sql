-- ------------------------------------------------------------
-- Migración 109: /tournaments pasa a llamarse "Eventos" y muestra los
-- tres tipos de evento juntos (torneo por ligas, Clan War Amistosa,
-- Race War), cada uno con su propia tarjeta. Race War se suma como
-- tercera opción dentro de "Crear evento" (antes "Crear torneo"), en
-- vez de tener su propio botón aparte -- ver CreateTournamentPage.tsx.
-- ------------------------------------------------------------

-- 1) Clan War Amistosa: título por defecto "TAG1 vs TAG2", calculado
-- una sola vez al proponerse (no es una columna generada -- así se
-- puede editar a mano más adelante si algún día se agrega esa opción,
-- sin perder lo que el usuario haya escrito).
alter table public.clan_wars add column titulo text;

-- Mismo cuerpo de siempre (última versión, migración 093), solo se
-- agrega el cálculo y guardado de titulo.
create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null,
  p_jugadores_por_set integer default 3,
  p_mapas_por_set integer default 2
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;
  if p_jugadores_por_set is null or p_jugadores_por_set < 1 then
    raise exception 'La cantidad de jugadores por lado tiene que ser al menos 1.';
  end if;
  if p_mapas_por_set is null or p_mapas_por_set < 1 then
    raise exception 'El "Bo" de cada set tiene que ser al menos 1.';
  end if;

  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
  end if;

  if v_challenger.disuelto then
    raise exception 'Tu equipo está disuelto.';
  end if;
  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
  end if;
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (
    challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id,
    jugadores_por_set, mapas_por_set, titulo
  )
  values (
    v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id,
    p_jugadores_por_set, p_mapas_por_set, v_challenger.tag || ' vs ' || v_challenged.tag
  );
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid, integer, integer) to authenticated;

-- 2) Listado unificado de eventos públicos: un torneo por ligas
-- (público, abierto, no excluido del buscador -- mismo filtro que ya
-- usaba /tournaments), un Race War (guerra_razas siempre es pública,
-- aunque su torneo anfitrión esté oculto -- ver crear_race_war(),
-- migración 106) o una Clan War Amistosa (reto directo sin torneo
-- detrás -- torneo_de_clan_war() nulo -- que siga vigente: pendiente,
-- aceptada o en curso).
--
-- security definer: clan_wars_select_propio (RLS normal) solo deja
-- ver la fila al capitán o dueño de alguno de los dos equipos -- igual
-- que lineup_publico_clan_war(), esta función expone nada más que lo
-- necesario para la tarjeta pública (id, título, fecha), no la fila
-- completa.
create or replace function public.eventos_publicos()
returns table (
  tipo text,
  id uuid,
  titulo text,
  formato text,
  modo text,
  fecha timestamptz,
  cupos_totales integer,
  cupos_ocupados integer,
  pozo_premio numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select
      'torneo'::text as tipo,
      t.id,
      t.nombre as titulo,
      t.formato,
      t.modo,
      t.fecha_inicio as fecha,
      t.cupos_totales,
      t.cupos_ocupados,
      t.pozo_premio
    from public.tournaments t
    where t.publico = true and t.estado = 'abierto' and t.excluido_de_busqueda = false

    union all

    select
      'race_war'::text,
      g.id,
      'Race War'::text,
      null::text,
      null::text,
      g.creado_en,
      null::integer,
      null::integer,
      null::numeric
    from public.guerra_razas g

    union all

    select
      'clan_war_amistosa'::text,
      cw.id,
      coalesce(cw.titulo, ct.tag || ' vs ' || cd.tag),
      null::text,
      null::text,
      cw.fecha_hora_cet,
      null::integer,
      null::integer,
      null::numeric
    from public.clan_wars cw
    join public.teams ct on ct.id = cw.challenger_team_id
    join public.teams cd on cd.id = cw.challenged_team_id
    where cw.status in ('pendiente', 'aceptada', 'en_curso')
      and (select tdc.id from public.torneo_de_clan_war(cw.id) tdc) is null
  ) eventos
  order by fecha asc;
$$;

grant execute on function public.eventos_publicos() to anon, authenticated;
