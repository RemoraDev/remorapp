-- Migración 123: la gestión del lineup de una Clan War (fondo de la
-- sala, cantidad de jugadores por lado, armado del lineup propio y el
-- visto bueno) se muda de "Panel de control -> Eventos" en la ficha
-- del equipo a la página pública del evento (/clan-war/:id) -- ahí
-- puede entrar cualquiera de los dos capitanes directamente, sin tener
-- que ir a buscar su propio equipo primero.
--
-- lineup_editor_clan_war() es la única función nueva: arma en un solo
-- viaje todo lo que la página necesita para el capitán que la llama
-- (mi lado del lineup completo, más el roster elegible y los
-- temporales para el formulario de "agregar"), y del lado rival solo
-- expone POSICIÓN + si esa posición ya tiene alguien anotado --
-- nunca el nombre, salvo que el lineup ya esté revelado
-- (revelado_lineup_cw(): ambos vistos buenos, o venció el plazo de
-- edición). Las acciones en sí (armar_lineup_cw, confirmar_lineup_cw,
-- cambiar_jugadores_por_set_cw, cambiar_fondo_lineup_cw/_imagen_cw) ya
-- existían y no cambian: todas reciben clan_war_id, no team_id, así
-- que ya funcionaban sin importar desde qué página se las llame.

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
