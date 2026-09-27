-- Migración 125: "Datos de transmisión" (caster_nombre/caster_link/
-- tiene_delay) era un solo campo compartido para todo el partido, y
-- su edición vivía SOLO en la ficha del equipo (Panel de control),
-- nunca se mudó al lobby (/clan-war/:id) junto con el resto de la
-- gestión del lineup. Se reemplaza por dos streams independientes,
-- uno por equipo -- cada capitán carga el suyo sin pisar el del
-- rival, visibles y editables directo en el lobby.
--
-- No se tocan ni se borran caster_nombre/caster_link/tiene_delay (para
-- no perder datos ya cargados en Clan Wars reales) -- simplemente dejan
-- de tener una UI de edición propia; lineup_publico_clan_war() los
-- sigue devolviendo por si alguna tarjeta vieja los usaba.

alter table public.clan_wars
  add column challenger_stream_link text,
  add column challenger_stream_delay boolean,
  add column challenged_stream_link text,
  add column challenged_stream_delay boolean;

create or replace function public.actualizar_stream_equipo_cw(
  p_clan_war_id uuid,
  p_stream_link text,
  p_tiene_delay boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cargar el stream de su equipo.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya terminó.';
  end if;

  if v_soy_challenger then
    update public.clan_wars
      set challenger_stream_link = nullif(trim(p_stream_link), ''),
          challenger_stream_delay = p_tiene_delay
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set challenged_stream_link = nullif(trim(p_stream_link), ''),
          challenged_stream_delay = p_tiene_delay
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.actualizar_stream_equipo_cw(uuid, text, boolean) to authenticated;

-- lineup_publico_clan_war(): suma los dos streams por equipo -- mismo
-- cuerpo de la migración 067, con estos 4 campos nuevos nada más.
create or replace function public.lineup_publico_clan_war(p_clan_war_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revelado', public.revelado_lineup_cw(cw.id),
    'formato', cw.formato,
    'status', cw.status,
    'fecha_hora_cet', cw.fecha_hora_cet,
    'challenger', jsonb_build_object('nombre', tc.name, 'tag', tc.tag, 'logo_url', tc.logo_url),
    'challenged', jsonb_build_object('nombre', td.name, 'tag', td.tag, 'logo_url', td.logo_url),
    'caster_nombre', cw.caster_nombre,
    'caster_link', cw.caster_link,
    'challenger_stream_link', cw.challenger_stream_link,
    'challenger_stream_delay', cw.challenger_stream_delay,
    'challenged_stream_link', cw.challenged_stream_link,
    'challenged_stream_delay', cw.challenged_stream_delay,
    'fondo_clasico', cw.fondo_lineup,
    'fondo_imagen_url', (select f.image_url from public.catalogo_fondos_lineup f where f.id = cw.fondo_lineup_imagen_id),
    'lineup_challenger', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenger_team_id
    ) else null end,
    'lineup_challenged', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenged_team_id
    ) else null end
  )
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.lineup_publico_clan_war(uuid) to anon, authenticated;

-- lineup_editor_clan_war(): suma los 4 campos de stream por equipo,
-- mismo cuerpo de la migración 123.
create or replace function public.lineup_editor_clan_war(p_clan_war_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
  v_rival_team_id uuid;
  v_torneo record;
  v_revelado boolean;
  v_resultado jsonb;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede gestionar este lineup.';
  end if;

  select * into v_torneo from public.torneo_de_clan_war(p_clan_war_id);
  v_revelado := public.revelado_lineup_cw(p_clan_war_id);

  select jsonb_build_object(
    'mi_team_id', v_mi_team_id,
    'soy_challenger', v_soy_challenger,
    'rival_team_id', v_rival_team_id,
    'rival_nombre', (select name || ' [' || tag || ']' from public.teams where id = v_rival_team_id),
    'formato', v_reto.formato,
    'status', v_reto.status,
    'es_de_torneo', v_torneo.id is not null,
    'jugadores_por_set', coalesce(v_torneo.jugadores_por_set, v_reto.jugadores_por_set, 3),
    'fondo_lineup', v_reto.fondo_lineup,
    'fondo_lineup_imagen_id', v_reto.fondo_lineup_imagen_id,
    'fecha_hora_cet', v_reto.fecha_hora_cet,
    'lineup_plazo_extendido_hasta', v_reto.lineup_plazo_extendido_hasta,
    'ventana_revelacion_minutos', coalesce(v_torneo.ventana_revelacion_minutos, 30),
    'lineup_revelado', v_revelado,
    'lineup_aprobado', v_reto.lineup_visto_bueno_challenger and v_reto.lineup_visto_bueno_challenged,
    'mi_visto_bueno', case when v_soy_challenger then v_reto.lineup_visto_bueno_challenger else v_reto.lineup_visto_bueno_challenged end,
    'visto_bueno_rival', case when v_soy_challenger then v_reto.lineup_visto_bueno_challenged else v_reto.lineup_visto_bueno_challenger end,
    'mi_stream_link', case when v_soy_challenger then v_reto.challenger_stream_link else v_reto.challenged_stream_link end,
    'mi_stream_delay', case when v_soy_challenger then v_reto.challenger_stream_delay else v_reto.challenged_stream_delay end,
    'rival_stream_link', case when v_soy_challenger then v_reto.challenged_stream_link else v_reto.challenger_stream_link end,
    'rival_stream_delay', case when v_soy_challenger then v_reto.challenged_stream_delay else v_reto.challenger_stream_delay end,
    'roster_elegible', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jugador_id', re.jugador_id,
        'nombre', coalesce(p.nick, 'Jugador de RemorApp') || (case when p.nick is not null then '#' || p.unique_id else '' end),
        'es_mercenario', re.es_mercenario,
        'es_aliado', re.es_aliado
      ))
      from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) re
      join public.profiles p on p.id = re.jugador_id
    ), '[]'::jsonb),
    'temporales_propios', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'nick_temporal', t.nick_temporal))
      from public.team_temp_players t
      where t.team_id = v_mi_team_id and t.reemplazado_por is null
    ), '[]'::jsonb),
    'lineup_propio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'nombre', coalesce(
          (select coalesce(pr.nick, 'Jugador de RemorApp') || (case when pr.nick is not null then '#' || pr.unique_id else '' end) from public.profiles pr where pr.id = l.jugador_id),
          (select tp.nick_temporal from public.team_temp_players tp where tp.id = l.jugador_temporal_id)
        ),
        'posicion', l.posicion,
        'es_temporal', l.jugador_temporal_id is not null,
        'es_suplente', l.es_suplente,
        'link_verificacion', l.link_verificacion
      ) order by l.posicion nulls last)
      from public.clan_war_lineup l
      where l.clan_war_id = p_clan_war_id and l.team_id = v_mi_team_id
    ), '[]'::jsonb),
    'lineup_rival', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', l.posicion,
        'es_suplente', l.es_suplente,
        'nombre', case when v_revelado then coalesce(
          (select coalesce(pr.nick, 'Jugador de RemorApp') || (case when pr.nick is not null then '#' || pr.unique_id else '' end) from public.profiles pr where pr.id = l.jugador_id),
          (select tp.nick_temporal from public.team_temp_players tp where tp.id = l.jugador_temporal_id)
        ) else null end,
        'es_temporal', case when v_revelado then l.jugador_temporal_id is not null else null end,
        'link_verificacion', case when v_revelado then l.link_verificacion else null end
      ) order by l.posicion nulls last)
      from public.clan_war_lineup l
      where l.clan_war_id = p_clan_war_id and l.team_id = v_rival_team_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

grant execute on function public.lineup_editor_clan_war(uuid) to authenticated;
