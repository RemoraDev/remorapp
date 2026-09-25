-- ------------------------------------------------------------
-- Migración 101: la eliminación doble ya existe por completo en la
-- base (tournaments.modo = 'eliminacion_doble', generar_llave_doble(),
-- avanzar_ganador_doble(), bracket_matches.bracket_tipo
-- 'ganadores'/'perdedores'/'final'/'reset') -- lo único que faltaba es
-- poder desactivar el partido de reset de la Gran Final. Hoy SIEMPRE
-- se juega si el campeón de la llave de perdedores le gana la final al
-- campeón (invicto) de la llave de ganadores. gran_final_con_reset
-- (default true, mismo comportamiento de siempre) permite que el
-- organizador elija una Gran Final única sin revancha.
-- ------------------------------------------------------------

alter table public.tournaments
  add column gran_final_con_reset boolean not null default true;

-- Mismo cuerpo de avanzar_ganador_doble() de siempre, con un solo
-- cambio: en el bracket_tipo = 'final', si gran_final_con_reset es
-- false, el ganador de esa única partida es campeón sin importar de
-- qué llave viene -- nunca se crea la partida de reset.
create or replace function public.avanzar_ganador_doble(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_loser_id uuid;
  v_user1 uuid;
  v_user2 uuid;
  v_user_ganador uuid;
  v_total_en_ronda_wb int;
  v_target_round_lb int;
  v_target_match_lb int;
  v_es_impar boolean;
  v_target record;
  v_total_en_ronda_lb int;
  v_es_final_lb boolean;
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

  if v_match.bracket_tipo = 'final' then
    -- Migración 101: sin reset, cualquiera de los dos gana la única
    -- Gran Final y ya es campeón -- no importa de qué llave viene.
    if v_match.winner_id = v_match.participant1_id or not v_torneo.gran_final_con_reset then
      update public.tournaments
        set estado = 'finalizado', campeon_participant_id = v_match.winner_id
        where id = v_match.tournament_id;
    else
      insert into public.bracket_matches (
        tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
      ) values (
        v_match.tournament_id, v_match.round + 1, 1, v_match.participant1_id, v_match.participant2_id, 'pendiente', 'reset'
      );
    end if;
    return;
  end if;

  if v_match.bracket_tipo = 'reset' then
    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  v_loser_id := case when v_match.winner_id = v_match.participant1_id
    then v_match.participant2_id else v_match.participant1_id end;

  if v_match.bracket_tipo = 'ganadores' then
    select count(*) into v_total_en_ronda_wb
    from public.bracket_matches
    where tournament_id = v_match.tournament_id and round = v_match.round and bracket_tipo = 'ganadores';

    if v_total_en_ronda_wb = 1 then
      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id and bracket_tipo = 'final'
      for update;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant1_id, status, bracket_tipo
        ) values (
          v_match.tournament_id, v_match.round + 1, 1, v_match.winner_id, 'pendiente', 'final'
        );
      else
        update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
      end if;
    else
      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and bracket_tipo = 'ganadores'
        and round = v_match.round + 1
        and match_number = ceil(v_match.match_number::numeric / 2)
      for update;

      v_es_impar := (v_match.match_number % 2) = 1;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
        ) values (
          v_match.tournament_id,
          v_match.round + 1,
          ceil(v_match.match_number::numeric / 2),
          case when v_es_impar then v_match.winner_id else null end,
          case when v_es_impar then null else v_match.winner_id end,
          'pendiente',
          'ganadores'
        );
      else
        if v_es_impar then
          update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
        else
          update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
        end if;
      end if;
    end if;

    if v_match.round = 1 then
      v_target_round_lb := 1;
      v_target_match_lb := ceil(v_match.match_number::numeric / 2);
      v_es_impar := (v_match.match_number % 2) = 1;

      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and bracket_tipo = 'perdedores'
        and round = v_target_round_lb
        and match_number = v_target_match_lb
      for update;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
        ) values (
          v_match.tournament_id,
          v_target_round_lb,
          v_target_match_lb,
          case when v_es_impar then v_loser_id else null end,
          case when v_es_impar then null else v_loser_id end,
          'pendiente',
          'perdedores'
        );
      else
        if v_es_impar then
          update public.bracket_matches set participant1_id = v_loser_id where id = v_target.id;
        else
          update public.bracket_matches set participant2_id = v_loser_id where id = v_target.id;
        end if;
      end if;
    else
      v_target_round_lb := 2 * (v_match.round - 1);
      v_target_match_lb := v_match.match_number;

      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and bracket_tipo = 'perdedores'
        and round = v_target_round_lb
        and match_number = v_target_match_lb
      for update;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant2_id, status, bracket_tipo
        ) values (
          v_match.tournament_id, v_target_round_lb, v_target_match_lb, v_loser_id, 'pendiente', 'perdedores'
        );
      else
        update public.bracket_matches set participant2_id = v_loser_id where id = v_target.id;
      end if;
    end if;

    return;
  end if;

  if (v_match.round % 2) = 1 then
    select * into v_target
    from public.bracket_matches
    where tournament_id = v_match.tournament_id
      and bracket_tipo = 'perdedores'
      and round = v_match.round + 1
      and match_number = v_match.match_number
    for update;

    if not found then
      insert into public.bracket_matches (
        tournament_id, round, match_number, participant1_id, status, bracket_tipo
      ) values (
        v_match.tournament_id, v_match.round + 1, v_match.match_number, v_match.winner_id, 'pendiente', 'perdedores'
      );
    else
      update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
    end if;
  else
    select count(*) into v_total_en_ronda_lb
    from public.bracket_matches
    where tournament_id = v_match.tournament_id and bracket_tipo = 'perdedores' and round = v_match.round;

    v_es_final_lb := (v_total_en_ronda_lb = 1);

    if v_es_final_lb then
      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id and bracket_tipo = 'final'
      for update;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant2_id, status, bracket_tipo
        ) values (
          v_match.tournament_id, v_match.round + 1, 1, v_match.winner_id, 'pendiente', 'final'
        );
      else
        update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
      end if;
    else
      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and bracket_tipo = 'perdedores'
        and round = v_match.round + 1
        and match_number = ceil(v_match.match_number::numeric / 2)
      for update;

      v_es_impar := (v_match.match_number % 2) = 1;

      if not found then
        insert into public.bracket_matches (
          tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
        ) values (
          v_match.tournament_id,
          v_match.round + 1,
          ceil(v_match.match_number::numeric / 2),
          case when v_es_impar then v_match.winner_id else null end,
          case when v_es_impar then null else v_match.winner_id end,
          'pendiente',
          'perdedores'
        );
      else
        if v_es_impar then
          update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
        else
          update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
        end if;
      end if;
    end if;
  end if;
end;
$$;
