-- ------------------------------------------------------------
-- Corrección sobre la migración 090: cerrar_clan_war() nunca conocía
-- bracket_matches -- solo actualizaba el partido de liga vinculado
-- (tournament_group_matches). Sin este agregado, el bracket de un
-- torneo formato 'wtl' se quedaba trabado para siempre después de
-- cerrar la primera Clan War: nadie marcaba el cruce como jugado ni
-- llamaba a avanzar_ganador().
-- ------------------------------------------------------------

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

  update public.tournament_group_matches
    set status = 'jugado',
        ganador_id = case
          when (select team_id from public.tournament_participants where id = tournament_group_matches.participant1_id) = v_team_ganador_id
            then participant1_id
          else participant2_id
        end
    where clan_war_id = p_clan_war_id;

  -- Migración 090: cruce de bracket vinculado (si lo hay) -- a
  -- diferencia de un partido de liga, un cruce de bracket exige un
  -- ganador definido; para formato 'wtl' eso siempre está garantizado
  -- (el marcador empatado sin ace_ganador_id ya se rechazó más arriba).
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
