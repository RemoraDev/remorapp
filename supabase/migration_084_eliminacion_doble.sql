-- ------------------------------------------------------------
-- Migración 084: motor real de "Eliminación doble" -- hasta ahora
-- estaba en el selector de modo pero no tenía ninguna función detrás
-- (generar_llave() la rechazaba explícitamente). Restricción a
-- propósito: exige que la cantidad de confirmados sea una potencia de
-- 2 exacta (4, 8, 16, 32...) -- sin eso, mezclar byes con la llave de
-- perdedores es un problema mucho más difícil (a qué partido de
-- perdedores cae el bye de qué lado) que no vale la pena resolver para
-- la primera versión de este modo.
--
-- Estructura: llave de ganadores (bracket_tipo 'ganadores', igual que
-- eliminación simple de siempre) + llave de perdedores (bracket_tipo
-- 'perdedores', alimentada por los perdedores de ganadores) + gran
-- final (bracket_tipo 'final', el campeón de ganadores -- invicto --
-- contra el campeón de perdedores) + reset (bracket_tipo 'reset',
-- solo se crea si el de perdedores le gana la final al de ganadores:
-- como ese era su primera derrota del torneo, se juega una revancha
-- para desempatar de verdad).
--
-- La llave de perdedores alterna rondas "menores" (impares: sobrevi-
-- vientes de perdedores se empare-jan entre sí) y "mayores" (pares:
-- reciben a los recién eliminados de la ronda de ganadores
-- correspondiente). Con K rondas de ganadores, perdedores tiene
-- 2*(K-1) rondas -- la ronda de ganadores r (r=2..K) cae en la ronda
-- de perdedores 2*(r-1); la ronda 1 de ganadores cae directo en la
-- ronda 1 de perdedores (no hay ronda anterior con la que emparejarse).
-- ------------------------------------------------------------

alter table public.bracket_matches
  add column bracket_tipo text not null default 'ganadores'
    check (bracket_tipo in ('ganadores', 'perdedores', 'final', 'reset'));

alter table public.bracket_matches
  drop constraint if exists bracket_matches_tournament_id_round_match_number_key;

alter table public.bracket_matches
  add constraint bracket_matches_tournament_id_tipo_round_match_number_key
  unique (tournament_id, bracket_tipo, round, match_number);

-- generar_llave_doble(): mismo criterio de semillas (aleatorio o
-- tradicional por MMR) que generar_llave(), pero sin la rama de byes
-- -- v_n siempre es exactamente next_pow2 acá, así que todos los
-- partidos de la ronda 1 de ganadores tienen los dos participantes
-- reales.
create or replace function public.generar_llave_doble(p_tournament_id uuid)
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
  v_i int;
  v_p1 uuid;
  v_p2 uuid;
  v_seeds int[];
  v_ronda_size int;
  v_nuevos int[];
  v_s int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar la llave.';
  end if;
  if v_torneo.modo <> 'eliminacion_doble' then
    raise exception 'Este torneo no es de formato Eliminación doble.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar la llave.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);

  v_next_pow2 := 1;
  while v_next_pow2 < v_n loop
    v_next_pow2 := v_next_pow2 * 2;
  end loop;

  if v_n < 4 or v_n <> v_next_pow2 then
    raise exception
      'Eliminación doble necesita exactamente una potencia de 2 de confirmados (4, 8, 16, 32...) -- hay % confirmados.',
      v_n;
  end if;

  v_num_matches := v_n / 2;

  if v_torneo.reglas_semillas = 'tradicional' then
    -- Ordena por MMR descendente (semilla 1 = mejor MMR) y después
    -- aplica el patrón de cruces estándar (1 vs N, 2 vs N-1, ...) --
    -- sin el paso de "semillas fantasma" de generar_llave(), porque
    -- acá nunca hay bye (v_n = v_next_pow2 exacto).
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
    while array_length(v_seeds, 1) < v_n loop
      v_nuevos := array[]::int[];
      v_ronda_size := array_length(v_seeds, 1) * 2;
      foreach v_s in array v_seeds loop
        v_nuevos := array_append(v_nuevos, v_s);
        v_nuevos := array_append(v_nuevos, v_ronda_size + 1 - v_s);
      end loop;
      v_seeds := v_nuevos;
    end loop;

    declare
      v_ordenado_por_mmr uuid[] := v_participantes;
    begin
      for v_i in 1..v_n loop
        v_participantes[v_i] := v_ordenado_por_mmr[v_seeds[v_i]];
      end loop;
    end;
  end if;

  for v_i in 1..v_num_matches loop
    v_p1 := v_participantes[v_i * 2 - 1];
    v_p2 := v_participantes[v_i * 2];

    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
    ) values (
      p_tournament_id, 1, v_i, v_p1, v_p2, 'pendiente', 'ganadores'
    );
  end loop;

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'eliminacion'
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_llave_doble(uuid) to authenticated;

-- avanzar_ganador_doble(): la progresión real de ganadores/perdedores/
-- final/reset. Se llama desde avanzar_ganador() cuando el torneo es
-- 'eliminacion_doble' (ver el branch agregado ahí abajo) -- reportar_resultado()
-- no cambia en nada, ya era genérica sobre bracket_matches.
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

  -- ---------- Gran final ----------
  if v_match.bracket_tipo = 'final' then
    if v_match.winner_id = v_match.participant1_id then
      -- El de ganadores (invicto) ganó la final: campeón directo, sin reset.
      update public.tournaments
        set estado = 'finalizado', campeon_participant_id = v_match.winner_id
        where id = v_match.tournament_id;
    else
      -- El de perdedores le ganó al invicto: esa era la primera
      -- derrota del de ganadores en todo el torneo -- se juega una
      -- revancha para desempatar de verdad (bracket reset).
      insert into public.bracket_matches (
        tournament_id, round, match_number, participant1_id, participant2_id, status, bracket_tipo
      ) values (
        v_match.tournament_id, v_match.round + 1, 1, v_match.participant1_id, v_match.participant2_id, 'pendiente', 'reset'
      );
    end if;
    return;
  end if;

  -- ---------- Reset ----------
  if v_match.bracket_tipo = 'reset' then
    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  v_loser_id := case when v_match.winner_id = v_match.participant1_id
    then v_match.participant2_id else v_match.participant1_id end;

  -- ---------- Llave de ganadores ----------
  if v_match.bracket_tipo = 'ganadores' then
    select count(*) into v_total_en_ronda_wb
    from public.bracket_matches
    where tournament_id = v_match.tournament_id and round = v_match.round and bracket_tipo = 'ganadores';

    if v_total_en_ronda_wb = 1 then
      -- Fin de la llave de ganadores: el ganador espera invicto en la
      -- gran final (participant1, siempre); el perdedor cae a la
      -- llave de perdedores como cualquier otro, más abajo.
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
      -- Ronda de ganadores normal: el ganador avanza dentro de
      -- ganadores, exactamente como en eliminación simple.
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

    -- El perdedor de ganadores cae a la llave de perdedores. Ronda 1
    -- de ganadores -> ronda 1 de perdedores (empareja dos perdedores
    -- de ganadores entre sí, mismo patrón de emparejado que arriba).
    -- Ronda r de ganadores (r > 1) -> ronda 2*(r-1) de perdedores,
    -- SIEMPRE como participant2 (participant1 de esa ronda lo ocupa
    -- el sobreviviente de la ronda de perdedores anterior).
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

  -- ---------- Llave de perdedores ----------
  -- Ronda impar (menor, de consolidación) -> el ganador avanza a la
  -- ronda siguiente (par, mayor) en el MISMO número de partido, como
  -- participant1 (participant2 de esa ronda lo ocupa el que cae de
  -- ganadores). Ronda par (mayor) -> si es la última ronda de
  -- perdedores (un solo partido en esa ronda), el ganador pasa
  -- directo a la gran final como participant2; si no, avanza a la
  -- siguiente ronda impar emparejándose con el otro sobreviviente,
  -- igual que una ronda normal de ganadores.
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

grant execute on function public.avanzar_ganador_doble(uuid) to authenticated;

-- avanzar_ganador(): un solo branch nuevo al principio -- si el torneo
-- es 'eliminacion_doble', delega TODO a avanzar_ganador_doble() y
-- corta ahí. El resto de la función (eliminación simple, First Stand,
-- tercer lugar) queda exactamente igual que antes, intocado.
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
begin
  select * into v_match from public.bracket_matches where id = p_match_id;
  select * into v_torneo from public.tournaments where id = v_match.tournament_id;

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
        );
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
  end if;
end;
$$;

grant execute on function public.avanzar_ganador(uuid) to authenticated;
