create or replace function public.deshacer_resultado(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_target_match_number int;
  v_es_impar boolean;
  v_target record;
  v_perdedor_id uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'jugado' then
    raise exception 'Esta partida no tiene resultado para deshacer.';
  end if;
  if v_match.clan_war_id is not null then
    raise exception 'Este partido se juega como Clan War -- deshacé el resultado desde ahí.';
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede deshacer un resultado.';
  end if;
  if v_torneo.modo = 'eliminacion_doble' then
    raise exception 'Todavía no se puede deshacer un resultado en eliminación doble.';
  end if;

  if v_match.es_tercer_lugar then
    -- El partido por el 3er lugar no genera más rondas -- solo hay
    -- que limpiar el 3er lugar del torneo si lo había fijado este.
    -- No hay nada más que deshacer para este caso.
    if v_torneo.tercer_lugar_participant_id = v_match.winner_id then
      update public.tournaments set tercer_lugar_participant_id = null where id = v_match.tournament_id;
    end if;
  else
    -- Si esta era una semifinal y ya existe el partido por el 3er
    -- lugar (se arma solo cuando las dos semis quedan jugadas), su
    -- perdedor ya está puesto ahí -- deshacer esta semifinal sin
    -- tocar eso dejaría ese partido con un jugador que en realidad
    -- nunca perdió. Más simple y seguro: bloquear, pedir deshacer
    -- primero el partido por el 3er lugar.
    v_perdedor_id := case when v_match.winner_id = v_match.participant1_id
      then v_match.participant2_id else v_match.participant1_id end;

    if v_perdedor_id is not null and exists (
      select 1 from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and es_tercer_lugar
        and (participant1_id = v_perdedor_id or participant2_id = v_perdedor_id)
    ) then
      raise exception 'No se puede deshacer: ya existe el partido por el 3er lugar con el perdedor de esta semifinal. Deshacé (o eliminá) primero ese partido.';
    end if;

    if v_torneo.estado = 'finalizado' and v_torneo.campeon_participant_id = v_match.winner_id then
      -- Esta era la final -- reabre el torneo.
      update public.tournaments set estado = 'en_curso', campeon_participant_id = null where id = v_match.tournament_id;
    else
      -- Hay que vaciar el lugar que este ganador ocupó en la ronda
      -- siguiente -- pero solo si esa partida TODAVÍA no tiene
      -- resultado propio (si ya se jugó, deshacerla desde acá dejaría
      -- un resultado huérfano).
      v_target_match_number := ceil(v_match.match_number::numeric / 2);
      v_es_impar := (v_match.match_number % 2) = 1;

      select * into v_target
      from public.bracket_matches
      where tournament_id = v_match.tournament_id
        and round = v_match.round + 1
        and match_number = v_target_match_number
        and not es_tercer_lugar
      for update;

      if found then
        if v_target.status = 'jugado' then
          raise exception 'No se puede deshacer: el ganador ya tiene resultado cargado en la siguiente ronda. Deshacé primero ese resultado.';
        end if;

        if v_es_impar then
          if v_target.participant2_id is null then
            delete from public.bracket_matches where id = v_target.id;
          else
            update public.bracket_matches set participant1_id = null where id = v_target.id;
          end if;
        else
          if v_target.participant1_id is null then
            delete from public.bracket_matches where id = v_target.id;
          else
            update public.bracket_matches set participant2_id = null where id = v_target.id;
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.bracket_matches
    set winner_id = null, status = 'pendiente',
        resultado_participant1 = null, resultado_participant2 = null,
        reported_p1_winner = null, reported_p2_winner = null
    where id = p_match_id;
end;
$$;

grant execute on function public.deshacer_resultado(uuid) to authenticated;
