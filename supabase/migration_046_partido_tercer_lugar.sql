-- ============================================================
-- Migración 046: partido por el tercer lugar en la llave eliminatoria.
--
-- 1) tournaments.tiene_tercer_lugar: configurable por el organizador
--    al crear el torneo, igual que tiene_fase_grupos. Solo tiene
--    sentido con eliminación simple, mismo gate que la etapa de
--    grupos.
-- 2) bracket_matches.es_tercer_lugar: marca este partido como algo
--    aparte de la progresión normal de rondas -- se inserta en la
--    MISMA ronda que la final (en paralelo, como pidió el
--    organizador), distinguido por esta bandera, no por un round
--    propio. avanzar_ganador() excluye estas filas de sus conteos
--    "cuántos partidos tiene esta ronda", así la final se sigue
--    detectando igual que siempre (ronda con exactamente 1 partido).
-- 3) tournaments.tercer_lugar_participant_id: se llena solo cuando se
--    juega el partido por el tercer lugar, mismo patrón que
--    campeon_participant_id.
-- 4) avanzar_ganador() ahora, además de lo que ya hacía:
--    a) si el partido que se acaba de jugar es el de tercer lugar,
--       guarda el ganador y no sigue con ninguna lógica de avance de
--       ronda (ese partido no avanza a ningún lado).
--    b) si no lo es, y la ronda que se acaba de completar tiene
--       exactamente 2 partidos (la semifinal, la que antecede a la
--       final) y el torneo tiene tiene_tercer_lugar = true, revisa si
--       las DOS semifinales ya están jugadas; si es así, crea el
--       partido por el tercer lugar con ambos perdedores. Si alguna
--       de las dos semifinales fue un bye (sin segundo participante),
--       no hay un perdedor real de ese lado -- se omite el partido
--       por el tercer lugar en ese caso, no pedido explícitamente
--       pero necesario para no insertar un partido con un cupo vacío
--       (torneos muy chicos, con 3 inscritos).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.tournaments add column if not exists tiene_tercer_lugar boolean not null default false;
alter table public.tournaments
  add column if not exists tercer_lugar_participant_id uuid references public.tournament_participants (id);

alter table public.bracket_matches add column if not exists es_tercer_lugar boolean not null default false;

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

  -- Registro de actividad (migración 020): solo en partidas reales,
  -- con los dos participantes presentes -- un bye no se jugó. Cubre
  -- tanto un reporte normal como uno resuelto por disputa o un
  -- abandono, porque todas esas rutas terminan acá. Reemplaza al
  -- reparto de XP que hacía este mismo punto antes (migración 013);
  -- el ajuste de MMR por resultado todavía no existe -- eso es la
  -- fase de Clan Wars -- pero la actividad sí se registra desde ya.
  -- También cubre el partido por el tercer lugar (migración 046): es
  -- una partida 1v1 real como cualquier otra.
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

  -- El partido por el tercer lugar no avanza a ningún lado: solo
  -- guarda su ganador y termina acá.
  if v_match.es_tercer_lugar then
    update public.tournaments
      set tercer_lugar_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round and not es_tercer_lugar;

  -- Partido por el tercer lugar: se genera al completarse las dos
  -- semifinales, reconocibles porque su ronda tiene exactamente 2
  -- partidos (la ronda siguiente, la final, siempre tiene 1 solo).
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
