create or replace function public.simular_torneo_prueba(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_match record;
  v_resueltos integer := 0;
  v_vueltas integer := 0;
  v_cw record;
  v_team1_id uuid;
  v_team2_id uuid;
  v_jugadores_por_set integer;
  v_mapas_por_set integer;
  v_pos integer;
  v_jugador1 uuid;
  v_jugador2 uuid;
  v_gana_challenger boolean;
  v_mapas_ganador integer;
  v_mapas_perdedor integer;
  v_resultado_challenger integer;
  v_resultado_challenged integer;
  v_sets_challenger integer;
  v_sets_challenged integer;
  v_team_ganador_id uuid;
  v_winner_participant_id uuid;
  v_score1 integer;
  v_score2 integer;
begin
  if not (public.is_admin() or public.es_staff()) then
    raise exception 'Solo staff o administradores pueden usar esto.';
  end if;

  select * into v_torneo from public.tournaments where id = p_tournament_id for update;
  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;

  if v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora Simular solo está disponible para el modo de eliminación simple.';
  end if;

  -- Genera la llave si todavía no existe -- generar_llave() exige ser
  -- el organizador (auth.uid() = creador_id), lo que ya es cierto
  -- porque quien aprieta "Simular" es quien creó este torneo de prueba.
  if v_torneo.estado = 'abierto' then
    perform public.generar_llave(p_tournament_id);
    select * into v_torneo from public.tournaments where id = p_tournament_id;
  end if;

  v_jugadores_por_set := greatest(1, least(3, v_torneo.jugadores_por_set));
  v_mapas_por_set := greatest(1, v_torneo.mapas_por_set);

  loop
    v_vueltas := v_vueltas + 1;
    exit when v_vueltas > 20;

    select * into v_match
    from public.bracket_matches
    where tournament_id = p_tournament_id
      and status = 'pendiente'
      and participant1_id is not null
      and participant2_id is not null
      and not es_tercer_lugar
    order by round, match_number
    limit 1;

    exit when v_match is null;

    if v_match.clan_war_id is not null then
      select * into v_cw from public.clan_wars where id = v_match.clan_war_id for update;

      select team_id into v_team1_id from public.tournament_participants where id = v_match.participant1_id;
      select team_id into v_team2_id from public.tournament_participants where id = v_match.participant2_id;

      -- Arma el lineup si todavía no existe -- toma los primeros N
      -- miembros del roster de cada clan (orden estable, no hace falta
      -- que sean "los mejores", es solo para poder probar la pantalla
      -- de lineup con datos reales).
      if not exists (select 1 from public.clan_war_lineup where clan_war_id = v_cw.id) then
        for v_pos in 1..v_jugadores_por_set loop
          select user_id into v_jugador1
            from public.team_members
            where team_id = v_team1_id
            order by user_id
            offset (v_pos - 1) limit 1;

          select user_id into v_jugador2
            from public.team_members
            where team_id = v_team2_id
            order by user_id
            offset (v_pos - 1) limit 1;

          if v_jugador1 is not null then
            insert into public.clan_war_lineup (clan_war_id, team_id, jugador_id, agregado_por, posicion)
            values (v_cw.id, v_team1_id, v_jugador1, v_jugador1, v_pos)
            on conflict do nothing;
          end if;
          if v_jugador2 is not null then
            insert into public.clan_war_lineup (clan_war_id, team_id, jugador_id, agregado_por, posicion)
            values (v_cw.id, v_team2_id, v_jugador2, v_jugador2, v_pos)
            on conflict do nothing;
          end if;

          if v_jugador1 is not null and v_jugador2 is not null then
            v_gana_challenger := random() < 0.5;
            v_mapas_ganador := ceil((v_mapas_por_set + 1) / 2.0)::integer;
            v_mapas_perdedor := floor(random() * v_mapas_ganador)::integer;

            insert into public.clan_war_wtl_sets (
              clan_war_id, posicion, jugador_challenger_id, jugador_challenged_id,
              mapas_ganados_challenger, mapas_ganados_challenged, status
            ) values (
              v_cw.id, v_pos, v_jugador1, v_jugador2,
              case when v_gana_challenger then v_mapas_ganador else v_mapas_perdedor end,
              case when v_gana_challenger then v_mapas_perdedor else v_mapas_ganador end,
              'jugado'
            )
            on conflict do nothing;
          end if;
        end loop;
      end if;

      select coalesce(sum(mapas_ganados_challenger), 0), coalesce(sum(mapas_ganados_challenged), 0)
        into v_resultado_challenger, v_resultado_challenged
        from public.clan_war_wtl_sets
        where clan_war_id = v_cw.id;

      -- Si quedó empatado en mapas (no hay ACE real acá), se le suma
      -- un mapa a un lado elegido al azar para desempatar -- mismo
      -- espíritu que el mapa decisivo del ACE en cerrar_clan_war().
      if v_resultado_challenger = v_resultado_challenged then
        if random() < 0.5 then
          v_resultado_challenger := v_resultado_challenger + 1;
        else
          v_resultado_challenged := v_resultado_challenged + 1;
        end if;
      end if;

      v_team_ganador_id := case
        when v_resultado_challenger > v_resultado_challenged then v_cw.challenger_team_id
        else v_cw.challenged_team_id
      end;

      select
        count(*) filter (where mapas_ganados_challenger > mapas_ganados_challenged),
        count(*) filter (where mapas_ganados_challenged > mapas_ganados_challenger)
        into v_sets_challenger, v_sets_challenged
        from public.clan_war_wtl_sets
        where clan_war_id = v_cw.id;

      update public.clan_wars
        set status = 'finalizada',
            ganador_team_id = v_team_ganador_id,
            resultado_mapas_challenger = v_resultado_challenger,
            resultado_mapas_challenged = v_resultado_challenged,
            challenger_cierre_confirmado = true,
            challenged_cierre_confirmado = true,
            lineup_visto_bueno_challenger = true,
            lineup_visto_bueno_challenged = true,
            challenger_confirmado = true,
            challenged_confirmado = true
        where id = v_cw.id;

      v_winner_participant_id := case
        when v_team1_id = v_team_ganador_id then v_match.participant1_id
        else v_match.participant2_id
      end;

      if v_team1_id = v_team_ganador_id then
        v_score1 := v_sets_challenger;
        v_score2 := v_sets_challenged;
      else
        v_score1 := v_sets_challenged;
        v_score2 := v_sets_challenger;
      end if;

      update public.bracket_matches
        set status = 'jugado',
            winner_id = v_winner_participant_id,
            resultado_participant1 = v_score1,
            resultado_participant2 = v_score2
        where id = v_match.id;

      perform public.avanzar_ganador(v_match.id);
    else
      -- 1v1 (o cualquier cruce sin Clan War vinculada): ganador al azar
      -- directo, mismo resultado final que reportar_resultado() pero
      -- sin pasar por el click a mano.
      v_gana_challenger := random() < 0.5;
      v_mapas_ganador := ceil((v_mapas_por_set + 1) / 2.0)::integer;
      v_mapas_perdedor := floor(random() * v_mapas_ganador)::integer;

      update public.bracket_matches
        set status = 'jugado',
            winner_id = case when v_gana_challenger then participant1_id else participant2_id end,
            resultado_participant1 = case when v_gana_challenger then v_mapas_ganador else v_mapas_perdedor end,
            resultado_participant2 = case when v_gana_challenger then v_mapas_perdedor else v_mapas_ganador end
        where id = v_match.id;

      perform public.avanzar_ganador(v_match.id);
    end if;

    v_resueltos := v_resueltos + 1;
  end loop;

  return v_resueltos;
end;
$$;

grant execute on function public.simular_torneo_prueba(uuid) to authenticated;
