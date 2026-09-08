-- ------------------------------------------------------------
-- Migración 076: corrección encontrada en vivo -- al generar la llave
-- de un torneo, la base devolvía "function public.registrar_carisma_equipo
-- (uuid, integer, text) does not exist".
--
-- La migración 058 había eliminado por completo el sistema de Carisma
-- (tablas, columnas y funciones, registrar_carisma_equipo() incluida)
-- y en su momento corrigió generar_llave() para que dejara de
-- llamarla. Pero la migración 069 (Suizo/Leaderboard/opciones
-- avanzadas) reescribió generar_llave() entera para agregar las
-- semillas tradicionales, y esa reescritura partió de una versión
-- vieja de la función -- de antes de la migración 058 -- así que la
-- llamada muerta a registrar_carisma_equipo() volvió a colarse sin
-- que nadie lo notara hasta ahora, porque nadie había generado una
-- llave todavía con esa versión.
--
-- Esta migración vuelve a reemplazar generar_llave() completa, con el
-- mismo comportamiento que la migración 069 (semillas tradicionales
-- incluidas) pero sin el bloque de carisma al final -- ni la llamada,
-- ni el cálculo que solo servía para ella.
-- ------------------------------------------------------------
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
    -- Reordena v_participantes por MMR descendente -- participante
    -- individual usa el MMR 1v1 del jugador, participante por equipo
    -- usa el MMR del equipo.
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

    -- Orden de semillas estándar (1, N, N/2+1, N/2, ...) para un
    -- cuadro de tamaño v_next_pow2: arranca en [1] y en cada paso
    -- intercala el complemento (tamaño_actual*2 + 1 - semilla).
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

    -- v_seed_orden[i] = participante que ocupa la semilla i (null si
    -- esa semilla no existe de verdad -- semillas > v_n son bye).
    v_seed_orden := array_fill(null::uuid, array[v_next_pow2]);
    for v_i in 1..v_n loop
      v_seed_orden[v_i] := v_participantes[v_i];
    end loop;

    -- Bye matches en semilla tradicional: van SIEMPRE a los mejores
    -- puestos disponibles -- se recalculan más abajo con esta misma
    -- variable, así que acá solo se prepara v_participantes en el
    -- orden de semillas final (posición i del cuadro = v_seeds[i]-ésima
    -- semilla).
    for v_i in 1..v_next_pow2 loop
      v_participantes[v_i] := v_seed_orden[v_seeds[v_i]];
    end loop;
  end if;

  if v_torneo.reglas_semillas = 'tradicional' then
    -- Con semilla tradicional el bye de cada posición ya quedó
    -- determinado por dónde cae un hueco null en v_participantes
    -- (semillas fantasma > v_n) -- no hace falta sortear byes.
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
      -- v_participantes ya quedó ordenado en pares consecutivos por
      -- posición del cuadro (posiciones 2i-1/2i = partido i) -- si hay
      -- bye, el hueco null puede caer en cualquiera de las dos mitades
      -- del par, así que se ubica el real en p1 sin importar cuál era.
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
    );
  end loop;

  -- check_in_abierto pasa a false en el mismo UPDATE que cierra las
  -- inscripciones: si algo de arriba falla (por ejemplo, menos de 2
  -- confirmados), el raise exception revierte toda la función,
  -- incluido esto -- el torneo no queda en un estado a medio camino.
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
