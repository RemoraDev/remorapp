-- ============================================================
-- Migración 027: corrige un error de la migración 026 -- la conexión
-- de títulos Padre/Hijo con cerrar_clan_war() y avanzar_ganador()
-- había quedado escrita en el archivo de referencia
-- (schema_tournaments.sql) pero nunca se incluyó en la migración que
-- de verdad se corrió. Esta migración redefine esas dos funciones con
-- la lógica que faltaba -- el resto de la 026 (tabla, RLS,
-- proponer/responder, expirar, titulos_activos_de) ya está bien.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

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
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  select exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid())
    into v_soy_challenger;
  select exists (select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid())
    into v_soy_challenged;

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    -- Falta que confirme el otro capitán -- todavía no se cierra.
    return;
  end if;

  select count(*) into v_ganadas_challenger
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

  select count(*) into v_ganadas_challenged
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

  if v_ganadas_challenger = v_ganadas_challenged then
    update public.clan_wars set status = 'empatada' where id = p_clan_war_id;
    return;
  end if;

  if v_ganadas_challenger > v_ganadas_challenged then
    v_team_ganador_id := v_reto.challenger_team_id;
    v_team_perdedor_id := v_reto.challenged_team_id;
  else
    v_team_ganador_id := v_reto.challenged_team_id;
    v_team_perdedor_id := v_reto.challenger_team_id;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;

  -- Títulos Padre/Hijo entre clanes (migración 026): si estos dos
  -- equipos tenían un título ya acordado (aceptado, todavía
  -- 'pendiente') entre ellos, esta CW lo resuelve con el mismo
  -- ganador. Un empate no resuelve ningún título -- no hay ganador
  -- real que transferir.
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
end;
$$;

grant execute on function public.cerrar_clan_war(uuid) to authenticated;

create or replace function public.avanzar_ganador(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_total_en_ronda int;
  v_target_match_number int;
  v_target record;
  v_es_impar boolean;
  v_user1 uuid;
  v_user2 uuid;
  v_user_ganador uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    perform public.registrar_actividad_participante(v_match.participant1_id);
    perform public.registrar_actividad_participante(v_match.participant2_id);

    -- Títulos Padre/Hijo entre jugadores (migración 026): se
    -- resuelven con cualquier partida 1v1 real entre ambos, en
    -- cualquier torneo -- nunca con una partida de equipo (ahí
    -- participant*_id no tiene user_id, tiene team_id).
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

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round;

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
  for update;

  if not found then
    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, status
    )
    values (
      v_match.tournament_id,
      v_match.round + 1,
      v_target_match_number,
      case when v_es_impar then v_match.winner_id else null end,
      case when v_es_impar then null else v_match.winner_id end,
      'pendiente'
    );
  else
    if v_es_impar then
      update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
    else
      update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
    end if;
  end if;
end;
$$;
