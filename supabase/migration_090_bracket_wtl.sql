-- ------------------------------------------------------------
-- Migración 090: formato "Clan vs Clan (WTL)" para torneos de
-- eliminación normal (bracket) -- hasta ahora el formato WTL solo
-- existía dentro de First Stand (fase de grupos) o en retos sueltos de
-- Clan War propuestos a mano. Esta migración lo conecta también a la
-- llave eliminatoria de siempre (generar_llave()/avanzar_ganador()/
-- reportar_resultado()), reutilizando exactamente la misma maquinaria
-- de Clan War ya probada (lineup, suplentes, reemplazo por
-- desacuerdo, check-in, ventana de revelación configurable) -- no se
-- duplica nada de eso.
--
-- 1) tournaments.formato admite 'wtl' como quinto valor, distinto de
--    1v1/2v2/3v3/4v4. Un torneo con este formato sigue siendo
--    modo = 'eliminacion_simple' de siempre (sin fase de grupos, a
--    diferencia de First Stand) -- lo único nuevo es que cada cruce
--    del bracket entre dos clanes genera una Clan War real en formato
--    WTL en vez de reportarse con un click.
-- 2) tournaments.jugadores_por_set / mapas_por_set (nuevas columnas,
--    default 3 y 2 -- los valores que ya regían fijos para WTL hasta
--    ahora): el organizador los define al crear un torneo 'wtl'. Para
--    los usos previos de WTL (First Stand y Todos contra todos con
--    formato_clan_war = 'wtl' en 2v2/3v3/4v4) quedan en su default de
--    siempre, sin exponer el campo -- no le cambia el comportamiento a
--    nada que ya estuviera funcionando.
-- 3) bracket_matches.clan_war_id (nueva columna, mismo patrón que
--    tournament_group_matches.clan_war_id de la migración 083):
--    generar_llave() la completa para los cruces de la ronda 1 que ya
--    tienen los dos clanes definidos; avanzar_ganador() la completa
--    para los cruces de rondas siguientes, en el momento en que
--    conoce a los dos clanes (cuando llega el segundo ganador
--    alimentador). reportar_resultado() rechaza reportar con el click
--    de siempre un partido que ya tiene Clan War vinculada, mismo
--    criterio que reportar_resultado_grupo().
-- 4) torneo_de_clan_war(): función auxiliar nueva que resuelve a qué
--    torneo pertenece una Clan War, sea que haya salido de la fase de
--    grupos (tournament_group_matches) o de la llave (bracket_matches)
--    -- centraliza en un solo lugar la búsqueda que plazo_edicion_
--    lineup_cw(), armar_lineup_cw() y reportar_mapa_wtl() necesitan
--    para leer ventana_revelacion_minutos/jugadores_por_set/
--    mapas_por_set del torneo correspondiente (o los defaults de
--    siempre, si la Clan War no salió de ningún torneo).
-- ------------------------------------------------------------

alter table public.tournaments drop constraint tournaments_formato_check;
alter table public.tournaments
  add constraint tournaments_formato_check check (formato in ('1v1', '2v2', '3v3', '4v4', 'wtl'));

alter table public.tournaments
  add column jugadores_por_set integer not null default 3 check (jugadores_por_set > 0),
  add column mapas_por_set integer not null default 2 check (mapas_por_set > 0);

-- El formato 'wtl' es siempre una llave de eliminación normal, sin
-- fase de grupos ni playoffs de liga -- "First Stand" es otro sistema
-- de fixture (grupos, no llave) y ya tiene su propio camino para jugar
-- WTL (formato_clan_war = 'wtl' en un torneo 3v3).
alter table public.tournaments
  add constraint tournaments_wtl_es_bracket_simple
  check (formato <> 'wtl' or (modo = 'eliminacion_simple' and formato_liga is null));

alter table public.bracket_matches
  add column clan_war_id uuid references public.clan_wars (id);

-- clan_war_lineup.posicion / clan_war_wtl_sets.posicion: antes solo
-- admitían 1, 2 o 3 -- ahora el límite superior lo define
-- jugadores_por_set del torneo (o 3 por default), así que el check de
-- la columna solo exige que sea positivo; el límite real se valida en
-- armar_lineup_cw().
alter table public.clan_war_lineup drop constraint if exists clan_war_lineup_posicion_check;
alter table public.clan_war_lineup add constraint clan_war_lineup_posicion_check
  check (posicion is null or posicion > 0);

alter table public.clan_war_wtl_sets drop constraint if exists clan_war_wtl_sets_posicion_check;
alter table public.clan_war_wtl_sets add constraint clan_war_wtl_sets_posicion_check
  check (posicion > 0);

-- ------------------------------------------------------------
-- torneo_de_clan_war(): a qué torneo pertenece una Clan War, si salió
-- de un fixture -- null si es un reto propuesto a mano, sin torneo
-- detrás. Devuelve la fila completa de tournaments para que cada
-- llamador lea la columna que necesite.
-- ------------------------------------------------------------
create or replace function public.torneo_de_clan_war(p_clan_war_id uuid)
returns public.tournaments
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.tournament_group_matches gm
  join public.tournament_groups g on g.id = gm.group_id
  join public.tournaments t on t.id = g.tournament_id
  where gm.clan_war_id = p_clan_war_id
  union all
  select t.*
  from public.bracket_matches bm
  join public.tournaments t on t.id = bm.tournament_id
  where bm.clan_war_id = p_clan_war_id
  limit 1;
$$;

grant execute on function public.torneo_de_clan_war(uuid) to authenticated;

-- plazo_edicion_lineup_cw(): mismo criterio de la migración 089, ahora
-- resuelto a través de torneo_de_clan_war() para que también alcance
-- a las Clan Wars generadas por un bracket 'wtl' (antes solo miraba
-- tournament_group_matches).
create or replace function public.plazo_edicion_lineup_cw(p_clan_war_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    cw.lineup_plazo_extendido_hasta,
    cw.fecha_hora_cet - (
      coalesce((select t.ventana_revelacion_minutos from public.torneo_de_clan_war(cw.id) t), 30)
      * interval '1 minute'
    )
  )
  from public.clan_wars cw
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.plazo_edicion_lineup_cw(uuid) to authenticated;

-- armar_lineup_cw(): mismo cuerpo de la migración 089 -- el único
-- cambio es que el límite de posición para un titular WTL sale de
-- jugadores_por_set del torneo (3 por default, igual que siempre) en
-- vez del fijo "entre 1 y 3".
create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null,
  p_team_id_como_admin uuid default null,
  p_es_suplente boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
  v_rangos jsonb;
  v_rango record;
  v_mmr_jugador int;
  v_jugadores_por_set int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede intervenir el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    v_soy_challenger := (p_team_id_como_admin = v_reto.challenger_team_id);
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text || ' accion=' || p_accion
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  if p_team_id_como_admin is null and now() >= public.plazo_edicion_lineup_cw(p_clan_war_id) then
    raise exception 'El plazo para editar el lineup ya venció. Pídele al staff una extensión, o solicítasela al equipo rival desde el panel de control.';
  end if;

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' and not p_es_suplente then
      if p_jugador_id is null or p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;

      v_jugadores_por_set := coalesce((select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t), 3);

      if p_posicion is null or p_posicion < 1 or p_posicion > v_jugadores_por_set then
        raise exception 'En formato WTL hay que indicar una posición entre 1 y % para esta Clan War.', v_jugadores_por_set;
      end if;
      if exists (
        select 1 from public.clan_war_lineup
        where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion = p_posicion
      ) then
        raise exception 'Ya asignaste esa posición a otro jugador.';
      end if;
    elsif v_reto.formato = 'wtl' and p_es_suplente then
      if p_jugador_id is null or p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;
    else
      if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
        raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
      end if;
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) where jugador_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de ese equipo, ni su mercenario, ni miembro de un equipo aliado para esta temporada.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de ese equipo.';
    end if;

    if v_reto.formato = 'wtl' and not p_es_suplente and v_reto.temporada_id is not null and p_jugador_id is not null then
      select rangos_mmr_por_posicion into v_rangos from public.temporadas where id = v_reto.temporada_id;

      if v_rangos is not null then
        select (elem->>'mmr_min')::int as mmr_min, (elem->>'mmr_max')::int as mmr_max
          into v_rango
          from jsonb_array_elements(v_rangos) as elem
          where (elem->>'posicion')::int = p_posicion;

        if v_rango is not null then
          select mmr_equipos into v_mmr_jugador from public.profiles where id = p_jugador_id;

          if v_mmr_jugador < v_rango.mmr_min or v_mmr_jugador > v_rango.mmr_max then
            raise exception 'El jugador para la posición % debe tener entre % y % de MMR de equipos (tiene %).',
              p_posicion, v_rango.mmr_min, v_rango.mmr_max, v_mmr_jugador;
          end if;
        end if;
      end if;
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por, posicion, es_suplente
    )
    values (
      p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid(),
      case when v_reto.formato = 'wtl' and not p_es_suplente then p_posicion else null end,
      p_es_suplente
    );

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de ese equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid, boolean) to authenticated;

-- reportar_mapa_wtl(): mismo cuerpo de siempre -- el set se cierra al
-- llegar a mapas_por_set del torneo (2 por default, igual que
-- siempre) en vez del fijo "2".
create or replace function public.reportar_mapa_wtl(p_set_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_gano_challenger boolean;
  v_total_mapas int;
  v_mapas_por_set int;
begin
  select * into v_set from public.clan_war_wtl_sets where id = p_set_id for update;
  if v_set is null then
    raise exception 'Ese set no existe.';
  end if;
  if v_set.status = 'jugado' then
    raise exception 'Este set ya jugó todos sus mapas.';
  end if;

  select * into v_reto from public.clan_wars where id = v_set.clan_war_id;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_set.jugador_challenger_id and p_ganador_id <> v_set.jugador_challenged_id then
    raise exception 'Ese jugador no juega este set.';
  end if;

  v_gano_challenger := (p_ganador_id = v_set.jugador_challenger_id);
  v_perdedor_id := case when v_gano_challenger then v_set.jugador_challenged_id else v_set.jugador_challenger_id end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;
  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  if v_gano_challenger then
    update public.clan_war_wtl_sets set mapas_ganados_challenger = mapas_ganados_challenger + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenger = resultado_mapas_challenger + 1 where id = v_set.clan_war_id;
  else
    update public.clan_war_wtl_sets set mapas_ganados_challenged = mapas_ganados_challenged + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenged = resultado_mapas_challenged + 1 where id = v_set.clan_war_id;
  end if;

  select mapas_ganados_challenger + mapas_ganados_challenged into v_total_mapas
  from public.clan_war_wtl_sets where id = p_set_id;

  v_mapas_por_set := coalesce((select t.mapas_por_set from public.torneo_de_clan_war(v_set.clan_war_id) t), 2);

  if v_total_mapas >= v_mapas_por_set then
    update public.clan_war_wtl_sets set status = 'jugado' where id = p_set_id;
  end if;
end;
$$;

grant execute on function public.reportar_mapa_wtl(uuid, uuid) to authenticated;

-- inscribir_equipo(): admite el formato 'wtl' -- el mínimo de
-- miembros que exige es jugadores_por_set del torneo, en vez de un
-- número fijo por formato.
create or replace function public.inscribir_equipo(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_team_id uuid;
  v_es_owner boolean;
  v_miembros int;
  v_minimo int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.formato not in ('2v2', '3v3', '4v4', 'wtl') then
    raise exception 'Este torneo no es por equipos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;

  select tm.team_id into v_team_id
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'Necesitas pertenecer a un equipo para inscribirte a este torneo.';
  end if;

  select exists (
    select 1 from public.team_members
    where team_id = v_team_id and user_id = auth.uid() and roles @> array['owner']::text[]
  ) into v_es_owner;

  if not v_es_owner then
    raise exception 'Solo el dueño del equipo puede inscribirlo a un torneo.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = v_team_id;

  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
    when 'wtl' then v_torneo.jugadores_por_set
  end;

  if v_miembros < v_minimo then
    raise exception
      'Tu equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  insert into public.tournament_participants (tournament_id, team_id)
  values (p_tournament_id, v_team_id);
end;
$$;

grant execute on function public.inscribir_equipo(uuid) to authenticated;

-- ------------------------------------------------------------
-- crear_clan_war_bracket(): crea la Clan War real de un cruce de la
-- llave apenas se conocen los dos clanes -- llamada desde
-- generar_llave() (ronda 1) y avanzar_ganador() (rondas siguientes).
-- No hace nada si el torneo no es formato 'wtl', si el partido ya
-- tiene una Clan War vinculada, o si todavía falta alguno de los dos
-- clanes (bye, o ronda siguiente sin el segundo ganador). La fecha de
-- la Clan War es fecha_inicio del torneo para la ronda 1 (ya definida
-- por el organizador); para las rondas siguientes, que se generan
-- dinámicamente a medida que avanza el torneo, se da un margen de 2
-- horas desde que se conocen los dos clanes -- el organizador puede
-- reprogramarla igual que cualquier Clan War si hace falta.
-- ------------------------------------------------------------
create or replace function public.crear_clan_war_bracket(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_team1_id uuid;
  v_team2_id uuid;
  v_temporada_id uuid;
  v_fecha timestamptz;
  v_clan_war_id uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    return;
  end if;
  if v_match.clan_war_id is not null then
    return;
  end if;
  if v_match.participant1_id is null or v_match.participant2_id is null then
    return;
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  if v_torneo.formato <> 'wtl' then
    return;
  end if;

  select team_id into v_team1_id from public.tournament_participants where id = v_match.participant1_id;
  select team_id into v_team2_id from public.tournament_participants where id = v_match.participant2_id;

  if v_team1_id is null or v_team2_id is null then
    return;
  end if;

  select id into v_temporada_id from public.temporadas
    where torneo_id = v_torneo.id
    order by fecha_inicio desc
    limit 1;

  v_fecha := case when v_match.round = 1 then v_torneo.fecha_inicio else greatest(now(), v_torneo.fecha_inicio) + interval '2 hours' end;

  insert into public.clan_wars (
    challenger_team_id, challenged_team_id, fecha_hora_cet,
    status, formato, temporada_id, tiene_delay
  ) values (
    v_team1_id, v_team2_id, v_fecha,
    'aceptada', 'wtl', v_temporada_id, false
  )
  returning id into v_clan_war_id;

  update public.bracket_matches set clan_war_id = v_clan_war_id where id = p_match_id;
end;
$$;

-- reportar_resultado(): un partido de la llave con Clan War vinculada
-- no se reporta con el click de siempre -- mismo criterio que
-- reportar_resultado_grupo() (migración 083). generar_llave() y
-- avanzar_ganador() llaman a crear_clan_war_bracket() apenas conocen a
-- los dos clanes de un cruce.
create or replace function public.reportar_resultado(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
  v_soy_p1 boolean;
  v_soy_p2 boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.clan_war_id is not null then
    raise exception 'Este partido se juega como Clan War -- reportalo desde ahí, no con este botón.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if v_match.status = 'en_disputa' then
    raise exception 'Resultado en disputa, un administrador debe resolverlo.';
  end if;
  if v_match.participant2_id is null then
    raise exception 'Esta partida es un bye, no se reporta.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  v_es_organizador := (v_torneo.creador_id = auth.uid());

  v_soy_p1 := public.es_dueno_del_participante(v_match.participant1_id);
  v_soy_p2 := public.es_dueno_del_participante(v_match.participant2_id);

  if not v_es_organizador and not v_soy_p1 and not v_soy_p2 then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  if not v_es_organizador and not v_torneo.permite_autoreporte then
    raise exception 'El organizador de este torneo desactivó el autoreporte -- solo él puede cargar resultados.';
  end if;

  if v_es_organizador then
    update public.bracket_matches
      set winner_id = p_ganador_id, status = 'jugado'
      where id = p_match_id;
  else
    if v_soy_p1 then
      update public.bracket_matches set reported_p1_winner = p_ganador_id where id = p_match_id;
    else
      update public.bracket_matches set reported_p2_winner = p_ganador_id where id = p_match_id;
    end if;

    select * into v_match from public.bracket_matches where id = p_match_id;

    if v_match.reported_p1_winner is not null and v_match.reported_p2_winner is not null then
      if v_match.reported_p1_winner = v_match.reported_p2_winner then
        update public.bracket_matches
          set winner_id = v_match.reported_p1_winner, status = 'jugado'
          where id = p_match_id;
      else
        update public.bracket_matches set status = 'en_disputa' where id = p_match_id;
      end if;
    end if;
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.status = 'jugado' then
    perform public.avanzar_ganador(p_match_id);
  end if;
end;
$$;

grant execute on function public.reportar_resultado(uuid, uuid) to authenticated;

-- generar_llave(): mismo cuerpo de siempre -- al terminar de insertar
-- cada partido de la ronda 1 que ya tiene los dos clanes (no bye), se
-- llama a crear_clan_war_bracket() para ese partido.
create or replace function public.generar_llave(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_participantes uuid[];
  v_n int;
  v_next_pow2 int;
  v_num_matches int;
  v_num_byes int;
  v_bye_matches int[];
  v_i int;
  v_es_bye boolean;
  v_p1 uuid;
  v_p2 uuid;
  v_partidos_pendientes int;
  v_seeds int[];
  v_seed_orden uuid[];
  v_ronda_size int;
  v_nuevos int[];
  v_s int;
  v_match_id uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar la llave.';
  end if;
  if v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora la llave solo está disponible para el modo de eliminación simple.';
  end if;

  if v_torneo.tiene_fase_grupos and v_torneo.fase_actual = 'grupos' then
    if v_torneo.estado <> 'en_curso' then
      raise exception 'La etapa de grupos de este torneo no está en curso.';
    end if;

    select count(*) into v_partidos_pendientes
    from public.tournament_group_matches gm
    join public.tournament_groups g on g.id = gm.group_id
    where g.tournament_id = p_tournament_id and gm.status <> 'jugado';

    if v_partidos_pendientes > 0 then
      raise exception 'Todavía faltan % partido(s) de grupo por jugarse.', v_partidos_pendientes;
    end if;

    select array_agg(participant_id order by random())
    into v_participantes
    from (
      select participant_id,
             row_number() over (
               partition by group_id order by ganados desc, inscrito_en asc
             ) as puesto
      from public.posiciones_grupos(p_tournament_id)
    ) clasificados
    where puesto <= v_torneo.avanzan_por_grupo;
  else
    if v_torneo.estado <> 'abierto' then
      raise exception 'Este torneo ya no está abierto para generar la llave.';
    end if;

    select array_agg(id order by random()) into v_participantes
    from public.tournament_participants
    where tournament_id = p_tournament_id and checked_in = true;
  end if;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 2 then
    raise exception 'Necesitas al menos 2 jugadores confirmados para generar la llave.';
  end if;

  v_next_pow2 := 1;
  while v_next_pow2 < v_n loop
    v_next_pow2 := v_next_pow2 * 2;
  end loop;

  v_num_matches := v_next_pow2 / 2;
  v_num_byes := v_next_pow2 - v_n;

  if v_torneo.reglas_semillas = 'tradicional' then
    select array_agg(pid order by mmr desc)
    into v_participantes
    from (
      select tp.id as pid,
             coalesce(pr.mmr_1v1, te.mmr, 500) as mmr
      from unnest(v_participantes) as tp_id
      join public.tournament_participants tp on tp.id = tp_id
      left join public.profiles pr on pr.id = tp.user_id
      left join public.teams te on te.id = tp.team_id
    ) ordenado;

    v_seeds := array[1];
    while array_length(v_seeds, 1) < v_next_pow2 loop
      v_nuevos := array[]::int[];
      v_ronda_size := array_length(v_seeds, 1) * 2;
      foreach v_s in array v_seeds loop
        v_nuevos := array_append(v_nuevos, v_s);
        v_nuevos := array_append(v_nuevos, v_ronda_size + 1 - v_s);
      end loop;
      v_seeds := v_nuevos;
    end loop;

    v_seed_orden := array_fill(null::uuid, array[v_next_pow2]);
    for v_i in 1..v_n loop
      v_seed_orden[v_i] := v_participantes[v_i];
    end loop;

    for v_i in 1..v_next_pow2 loop
      v_participantes[v_i] := v_seed_orden[v_seeds[v_i]];
    end loop;
  end if;

  if v_torneo.reglas_semillas = 'tradicional' then
    v_bye_matches := array[]::int[];
    for v_i in 1..v_num_matches loop
      if v_participantes[v_i * 2 - 1] is null or v_participantes[v_i * 2] is null then
        v_bye_matches := array_append(v_bye_matches, v_i);
      end if;
    end loop;
  else
    select array_agg(x order by random())
    into v_bye_matches
    from generate_series(1, v_num_matches) as x;
    v_bye_matches := v_bye_matches[1:v_num_byes];
  end if;

  for v_i in 1..v_num_matches loop
    v_es_bye := v_i = any(v_bye_matches);

    if v_torneo.reglas_semillas = 'tradicional' then
      if v_participantes[v_i * 2 - 1] is not null then
        v_p1 := v_participantes[v_i * 2 - 1];
        v_p2 := case when v_es_bye then null else v_participantes[v_i * 2] end;
      else
        v_p1 := v_participantes[v_i * 2];
        v_p2 := null;
      end if;
    else
      v_p1 := v_participantes[array_length(v_participantes, 1)];
      v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];

      if v_es_bye then
        v_p2 := null;
      else
        v_p2 := v_participantes[array_length(v_participantes, 1)];
        v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];
      end if;
    end if;

    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, winner_id, status
    )
    values (
      p_tournament_id,
      1,
      v_i,
      v_p1,
      v_p2,
      case when v_es_bye then v_p1 else null end,
      case when v_es_bye then 'jugado' else 'pendiente' end
    )
    returning id into v_match_id;

    if not v_es_bye then
      perform public.crear_clan_war_bracket(v_match_id);
    end if;
  end loop;

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'eliminacion'
    where id = p_tournament_id;

  for v_i in 1..v_num_matches loop
    if v_i = any(v_bye_matches) then
      perform public.avanzar_ganador(
        (select id from public.bracket_matches
         where tournament_id = p_tournament_id and round = 1 and match_number = v_i)
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.generar_llave(uuid) to authenticated;

-- avanzar_ganador(): mismo cuerpo de siempre -- al completar el
-- segundo cupo de un partido de ronda siguiente (rama "else", el
-- partido ya existía y le faltaba un participante), se llama a
-- crear_clan_war_bracket() para ese partido.
create or replace function public.avanzar_ganador(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_total_en_ronda int;
  v_target_match_number int;
  v_target record;
  v_es_impar boolean;
  v_user1 uuid;
  v_user2 uuid;
  v_user_ganador uuid;
  v_semis_jugadas int;
  v_semi1 record;
  v_semi2 record;
  v_perdedor1 uuid;
  v_perdedor2 uuid;
  v_tercer_lugar_match_id uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;
  select * into v_torneo from public.tournaments where id = v_match.tournament_id;

  if v_match.status <> 'jugado' or v_match.winner_id is null then
    raise exception 'Este partido todavía no tiene resultado.';
  end if;
  if v_torneo.creador_id <> auth.uid()
     and not public.es_dueno_del_participante(v_match.participant1_id)
     and not public.es_dueno_del_participante(v_match.participant2_id)
  then
    raise exception 'No tienes permiso para avanzar este partido.';
  end if;

  if v_torneo.modo = 'eliminacion_doble' then
    perform public.avanzar_ganador_doble(p_match_id);
    return;
  end if;

  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    perform public.registrar_actividad_participante(v_match.participant1_id);
    perform public.registrar_actividad_participante(v_match.participant2_id);

    select user_id into v_user1 from public.tournament_participants where id = v_match.participant1_id;
    select user_id into v_user2 from public.tournament_participants where id = v_match.participant2_id;

    if v_user1 is not null and v_user2 is not null then
      select user_id into v_user_ganador from public.tournament_participants where id = v_match.winner_id;

      update public.titulos_padre_hijo
        set status = 'activo',
            ganador_id = v_user_ganador,
            fecha_inicio = now(),
            fecha_fin = now() + (duracion_dias || ' days')::interval
        where tipo = 'jugador'
          and aceptado = true
          and status = 'pendiente'
          and (
            (retador_id = v_user1 and retado_id = v_user2)
            or (retador_id = v_user2 and retado_id = v_user1)
          );
    end if;
  end if;

  if v_match.es_tercer_lugar then
    update public.tournaments
      set tercer_lugar_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round and not es_tercer_lugar;

  if v_total_en_ronda = 2 and v_torneo.tiene_tercer_lugar then
    select count(*) into v_semis_jugadas
    from public.bracket_matches
    where tournament_id = v_match.tournament_id
      and round = v_match.round
      and not es_tercer_lugar
      and status = 'jugado';

    if v_semis_jugadas = 2 and not exists (
      select 1 from public.bracket_matches
      where tournament_id = v_match.tournament_id and es_tercer_lugar
    ) then
      select * into v_semi1 from public.bracket_matches
        where tournament_id = v_match.tournament_id and round = v_match.round
          and match_number = 1 and not es_tercer_lugar;
      select * into v_semi2 from public.bracket_matches
        where tournament_id = v_match.tournament_id and round = v_match.round
          and match_number = 2 and not es_tercer_lugar;

      if v_semi1.participant2_id is not null and v_semi2.participant2_id is not null then
        v_perdedor1 := case when v_semi1.winner_id = v_semi1.participant1_id
          then v_semi1.participant2_id else v_semi1.participant1_id end;
        v_perdedor2 := case when v_semi2.winner_id = v_semi2.participant1_id
          then v_semi2.participant2_id else v_semi2.participant1_id end;

        insert into public.bracket_matches (
          tournament_id, round, match_number, participant1_id, participant2_id, status, es_tercer_lugar
        )
        values (
          v_match.tournament_id, v_match.round + 1, 2, v_perdedor1, v_perdedor2, 'pendiente', true
        )
        returning id into v_tercer_lugar_match_id;

        perform public.crear_clan_war_bracket(v_tercer_lugar_match_id);
      end if;
    end if;
  end if;

  if v_total_en_ronda = 1 then
    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  v_target_match_number := ceil(v_match.match_number::numeric / 2);
  v_es_impar := (v_match.match_number % 2) = 1;

  select * into v_target
  from public.bracket_matches
  where tournament_id = v_match.tournament_id
    and round = v_match.round + 1
    and match_number = v_target_match_number
    and not es_tercer_lugar
  for update;

  if not found then
    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, status, formato_partido
    )
    values (
      v_match.tournament_id,
      v_match.round + 1,
      v_target_match_number,
      case when v_es_impar then v_match.winner_id else null end,
      case when v_es_impar then null else v_match.winner_id end,
      'pendiente',
      case when v_torneo.formato_liga = 'first_stand' and v_total_en_ronda = 2 then 'bo5' else 'normal' end
    );
  else
    if v_es_impar then
      update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
    else
      update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
    end if;

    perform public.crear_clan_war_bracket(v_target.id);
  end if;
end;
$$;

grant execute on function public.avanzar_ganador(uuid) to authenticated;

-- cerrar_clan_war(): mismo cuerpo de siempre -- lo único nuevo es que,
-- al terminar de resolver el ganador, también revisa si esta Clan War
-- está vinculada a un cruce del bracket (torneo formato 'wtl') y, de
-- ser así, lo marca jugado con el participante ganador y llama a
-- avanzar_ganador() para que el bracket progrese solo -- mismo
-- criterio que ya aplicaba para un partido de liga vinculado
-- (tournament_group_matches), pero un cruce de bracket exige un
-- ganador definido (nunca puede quedar "jugado" sin ganador, a
-- diferencia de un partido de liga que sí admite empate). Para
-- formato 'wtl' eso siempre está garantizado: el marcador empatado
-- sin ace_ganador_id ya se rechaza más arriba en esta misma función.
create or replace function public.cerrar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
  v_ganadas_challenger int;
  v_ganadas_challenged int;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_team_ganador_id uuid;
  v_team_perdedor_id uuid;
  v_bracket_match_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.formato = 'wtl' then
    if exists (
      select 1 from public.clan_war_wtl_sets where clan_war_id = p_clan_war_id and status <> 'jugado'
    ) then
      raise exception 'Todavía faltan sets de la Clan War por jugarse.';
    end if;
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged
       and v_reto.ace_ganador_id is null
    then
      raise exception 'El marcador global quedó empatado -- todavía falta jugar el mapa decisivo del ACE.';
    end if;
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    return;
  end if;

  if v_reto.formato = 'wtl' then
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged then
      if v_reto.ace_ganador_id = v_reto.ace_challenger_id then
        v_team_ganador_id := v_reto.challenger_team_id;
        v_team_perdedor_id := v_reto.challenged_team_id;
      else
        v_team_ganador_id := v_reto.challenged_team_id;
        v_team_perdedor_id := v_reto.challenger_team_id;
      end if;
    elsif v_reto.resultado_mapas_challenger > v_reto.resultado_mapas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  else
    select count(*) into v_ganadas_challenger
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

    select count(*) into v_ganadas_challenged
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

    if v_ganadas_challenger = v_ganadas_challenged then
      update public.clan_wars set status = 'empatada' where id = p_clan_war_id;

      -- Migración 083: el partido de liga vinculado (si lo hay) queda
      -- jugado y empatado -- posiciones_grupos() ya sabe sumarle el
      -- punto de empate a los dos participantes.
      update public.tournament_group_matches
        set status = 'jugado', ganador_id = null
        where clan_war_id = p_clan_war_id;

      return;
    end if;

    if v_ganadas_challenger > v_ganadas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;

  update public.titulos_padre_hijo
    set status = 'activo',
        ganador_id = v_team_ganador_id,
        fecha_inicio = now(),
        fecha_fin = now() + (duracion_dias || ' days')::interval
    where tipo = 'clan'
      and aceptado = true
      and status = 'pendiente'
      and (
        (retador_id = v_reto.challenger_team_id and retado_id = v_reto.challenged_team_id)
        or (retador_id = v_reto.challenged_team_id and retado_id = v_reto.challenger_team_id)
      );

  -- Migración 083: partido de liga vinculado (si lo hay) queda jugado,
  -- con el mismo ganador que la Clan War -- se resuelve por equipo, no
  -- por participant1/2 directo, porque no se sabe de antemano cuál de
  -- los dos quedó como "challenger" al generar el fixture.
  update public.tournament_group_matches
    set status = 'jugado',
        ganador_id = case
          when (select team_id from public.tournament_participants where id = tournament_group_matches.participant1_id) = v_team_ganador_id
            then participant1_id
          else participant2_id
        end
    where clan_war_id = p_clan_war_id;

  -- Migración 090: cruce de bracket vinculado (si lo hay).
  select id into v_bracket_match_id
  from public.bracket_matches
  where clan_war_id = p_clan_war_id;

  if v_bracket_match_id is not null then
    update public.bracket_matches
      set status = 'jugado',
          winner_id = case
            when (select team_id from public.tournament_participants where id = bracket_matches.participant1_id) = v_team_ganador_id
              then participant1_id
            else participant2_id
          end
      where id = v_bracket_match_id;

    perform public.avanzar_ganador(v_bracket_match_id);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Segunda corrección sobre la migración 090: confirmar_lineup_cw()
-- también tenía hardcodeado "el lineup WTL necesita exactamente 3
-- jugadores" -- se detectó recién al jugar en vivo un torneo formato
-- 'wtl' con jugadores_por_set = 2. Se generaliza al mismo criterio que
-- ya usa armar_lineup_cw(): el límite lo define jugadores_por_set del
-- torneo (o 3 por default, para los usos previos de WTL que no vienen
-- de un torneo formato 'wtl').
-- ------------------------------------------------------------

create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid, p_team_id_como_admin uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_posiciones_completas boolean;
  v_jugadores_por_set int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede confirmar el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_confirmar_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  if v_reto.formato = 'wtl' then
    v_jugadores_por_set := coalesce((select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t), 3);

    select (count(distinct posicion) = v_jugadores_por_set) into v_posiciones_completas
    from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion is not null;

    if not v_posiciones_completas then
      raise exception 'En formato WTL el lineup necesita exactamente % jugadores titulares.', v_jugadores_por_set;
    end if;
  end if;

  if v_mi_team_id = v_reto.challenger_team_id then
    update public.clan_wars
      set lineup_visto_bueno_challenger = true, visto_bueno_dado_por_challenger = auth.uid()
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = true, visto_bueno_dado_por_challenged = auth.uid()
      where id = p_clan_war_id;
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

grant execute on function public.confirmar_lineup_cw(uuid, uuid) to authenticated;
