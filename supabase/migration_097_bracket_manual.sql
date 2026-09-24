-- ------------------------------------------------------------
-- Migración 097: alternativa al sorteo automático de generar_llave()
-- -- el organizador puede armar el bracket a mano, arrastrando cada
-- participante a su casillero de la primera ronda (front: dnd-kit).
--
-- generar_llave_manual() reutiliza EXACTAMENTE la misma lógica de
-- validación de estado/permisos y de creación de partidas que
-- generar_llave() (mismo esquema de bracket_matches, misma llamada a
-- crear_clan_war_bracket() y a avanzar_ganador() para los byes) -- lo
-- único que cambia es que el orden de los participantes en los
-- casilleros lo define el organizador (p_orden), no un sorteo. Así el
-- resto del sistema (reportar resultados, avanzar rondas, etc.) no
-- distingue un bracket armado a mano de uno armado por sorteo.
--
-- p_orden es un array de exactamente v_next_pow2 posiciones (el
-- mismo cálculo de "próxima potencia de 2" que ya usa generar_llave()),
-- con el id de tournament_participants en cada casillero ocupado y
-- null en los casilleros vacíos (byes) -- la partida i del bracket
-- toma los casilleros (2i-1, 2i).
-- ------------------------------------------------------------

create or replace function public.generar_llave_manual(p_tournament_id uuid, p_orden uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_candidatos uuid[];
  v_n int;
  v_next_pow2 int;
  v_num_matches int;
  v_partidos_pendientes int;
  v_i int;
  v_es_bye boolean;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_asignados int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar la llave.';
  end if;
  if v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora la llave manual solo está disponible para el modo de eliminación simple.';
  end if;

  -- Mismo cálculo del universo de candidatos que generar_llave(): los
  -- clasificados de la etapa de grupos, o los inscritos con check-in
  -- confirmado si el torneo no tiene fase de grupos.
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

    select array_agg(participant_id)
    into v_candidatos
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

    select array_agg(id) into v_candidatos
    from public.tournament_participants
    where tournament_id = p_tournament_id and checked_in = true;
  end if;

  v_n := coalesce(array_length(v_candidatos, 1), 0);
  if v_n < 2 then
    raise exception 'Necesitas al menos 2 jugadores confirmados para generar la llave.';
  end if;

  v_next_pow2 := 1;
  while v_next_pow2 < v_n loop
    v_next_pow2 := v_next_pow2 * 2;
  end loop;

  v_num_matches := v_next_pow2 / 2;

  -- Validación del orden manual.
  if coalesce(array_length(p_orden, 1), 0) <> v_next_pow2 then
    raise exception 'El bracket necesita exactamente % casilleros (llegaron %).',
      v_next_pow2, coalesce(array_length(p_orden, 1), 0);
  end if;

  select count(*) into v_asignados from unnest(p_orden) x where x is not null;
  if v_asignados <> v_n then
    raise exception 'Hay % participante(s) inscritos y % asignado(s) a un casillero -- tienen que coincidir exactamente.',
      v_n, v_asignados;
  end if;

  if exists (
    select 1 from unnest(p_orden) x where x is not null group by x having count(*) > 1
  ) then
    raise exception 'Un mismo participante no puede ocupar más de un casillero.';
  end if;

  if exists (
    select 1 from unnest(p_orden) x where x is not null and not (x = any(v_candidatos))
  ) then
    raise exception 'Uno de los casilleros tiene un participante que no está confirmado en este torneo.';
  end if;

  -- Ningún partido puede quedar con los dos casilleros vacíos -- un
  -- bye necesita al menos un participante para avanzar solo.
  for v_i in 1..v_num_matches loop
    if p_orden[v_i * 2 - 1] is null and p_orden[v_i * 2] is null then
      raise exception 'La partida % quedó con los dos casilleros vacíos -- reacomoda los byes, cada uno necesita un participante.', v_i;
    end if;
  end loop;

  for v_i in 1..v_num_matches loop
    v_p1 := p_orden[v_i * 2 - 1];
    v_p2 := p_orden[v_i * 2];
    v_es_bye := v_p1 is null or v_p2 is null;

    if v_p1 is null then
      v_p1 := v_p2;
      v_p2 := null;
    elsif v_es_bye then
      v_p2 := null;
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
    if p_orden[v_i * 2 - 1] is null or p_orden[v_i * 2] is null then
      perform public.avanzar_ganador(
        (select id from public.bracket_matches
         where tournament_id = p_tournament_id and round = 1 and match_number = v_i)
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.generar_llave_manual(uuid, uuid[]) to authenticated;
