-- Migración 129: "Look" suma una tercera pestaña, "Dimensión" --
-- controla la relación de aspecto de la tarjeta del lineup (4:3, 16:9
-- -- default, de siempre --, 16:10, 21:9). Pensada sobre todo para
-- quien usa /overlay/clan-war/:id como fuente de navegador en OBS y
-- necesita que la tarjeta encaje con el resto de su composición.
-- Mismo permiso y mismas condiciones que cambiar_estructura_lineup_cw().

alter table public.clan_wars
  add column aspecto_lineup text not null default '16:9'
    check (aspecto_lineup in ('4:3', '16:9', '16:10', '21:9'));

create or replace function public.cambiar_aspecto_lineup_cw(p_clan_war_id uuid, p_aspecto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_aspecto not in ('4:3', '16:9', '16:10', '21:9') then
    raise exception 'Esa dimensión no es válida.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar la dimensión.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'La dimensión del lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set aspecto_lineup = p_aspecto where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_aspecto_lineup_cw(uuid, text) to authenticated;

-- lineup_publico_clan_war(): suma aspecto_lineup -- mismo cuerpo de la
-- migración 127, con este campo nuevo nada más.
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
    'estructura', cw.estructura_lineup,
    'aspecto', cw.aspecto_lineup,
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

-- lineup_editor_clan_war(): suma aspecto_lineup -- mismo cuerpo de la
-- migración 127.
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
    'estructura_lineup', v_reto.estructura_lineup,
    'aspecto_lineup', v_reto.aspecto_lineup,
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
