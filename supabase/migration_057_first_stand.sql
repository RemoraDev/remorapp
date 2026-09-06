-- ------------------------------------------------------------
-- Migración 057: formato de liga "First Stand" -- 7 clanes, fixture
-- round-robin completo (algoritmo de Berger) y playoffs top 4.
--
-- Reutiliza la infraestructura de etapa de grupos que ya existía
-- (tournament_groups/tournament_group_participants/tournament_group_matches,
-- generar_llave() para los playoffs) en vez de tablas nuevas -- First
-- Stand es, ni más ni menos, un torneo con modo = 'eliminacion_simple'
-- y tiene_fase_grupos = true, con UN solo grupo de 7 en vez de varios
-- grupos configurables, y una función de fixture propia porque
-- generar_grupos() exige cantidad_grupos >= 2 y no organiza los
-- partidos en jornadas.
-- ------------------------------------------------------------

alter table public.tournaments
  add column formato_liga text check (formato_liga in ('first_stand'));

alter table public.tournaments
  add column puntos_victoria_2_0 integer not null default 3;

alter table public.tournaments
  add column puntos_victoria_2_1 integer not null default 3;

-- Necesarias para First Stand, más allá de lo pedido explícitamente:
-- sin "jornada" no hay forma de agrupar los 21 partidos en las 7
-- rondas que pide el fixture; sin el resultado detallado (2-0/2-1) no
-- hay forma de distinguir cuántos puntos vale cada victoria -- el
-- sistema de puntos que se pide en el punto 3 no se puede calcular
-- solo con el ganador binario que ya existía.
alter table public.tournament_group_matches
  add column jornada integer;

alter table public.tournament_group_matches
  add column resultado_participant1 integer check (resultado_participant1 is null or resultado_participant1 in (0, 1, 2));

alter table public.tournament_group_matches
  add column resultado_participant2 integer check (resultado_participant2 is null or resultado_participant2 in (0, 1, 2));

-- También necesaria, más allá de lo pedido: "marcar la final como
-- Bo5" no tiene dónde vivir sin esta columna. Es solo una etiqueta
-- informativa -- no existe (ni se construye acá) un sistema de
-- puntaje por mapa dentro de la llave eliminatoria, reportar_resultado()
-- sigue reportando un ganador binario como siempre; esto únicamente
-- cambia lo que la interfaz le muestra a los jugadores sobre cómo se
-- tiene que jugar esa partida puntual.
alter table public.bracket_matches
  add column formato_partido text not null default 'normal' check (formato_partido in ('normal', 'bo5'));

-- ------------------------------------------------------------
-- generar_fixture_first_stand(): algoritmo de Berger (método del
-- círculo) -- se fija el primer casillero de 8 (7 equipos + 1
-- "descanso") y se rota el resto una posición por jornada. Así,
-- ningún par se repite en las 7 jornadas y cada equipo descansa
-- exactamente una vez. 7 jornadas x 3 partidos reales = 21 partidos,
-- exactamente los C(7,2) = 21 cruces posibles.
-- ------------------------------------------------------------
create or replace function public.generar_fixture_first_stand(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_participantes uuid[];
  v_n int;
  v_grupo_id uuid;
  v_slots uuid[];
  v_ronda int;
  v_i int;
  v_home uuid;
  v_away uuid;
  v_ultimo uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar el fixture.';
  end if;
  if v_torneo.formato_liga is distinct from 'first_stand' then
    raise exception 'Este torneo no está configurado como First Stand.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar el fixture.';
  end if;

  select array_agg(id order by random())
  into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n <> 7 then
    raise exception 'First Stand necesita exactamente 7 equipos confirmados (hay %).', v_n;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Fase de todos contra todos')
  returning id into v_grupo_id;

  for v_i in 1..7 loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  -- Casillero 8 (null) es el "descanso" -- 7 equipos reales + 1.
  v_slots := array[
    v_participantes[1], v_participantes[2], v_participantes[3], v_participantes[4],
    v_participantes[5], v_participantes[6], v_participantes[7], null
  ];

  for v_ronda in 1..7 loop
    for v_i in 0..3 loop
      v_home := v_slots[v_i + 1];
      v_away := v_slots[8 - v_i];
      if v_home is not null and v_away is not null then
        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
        values (v_grupo_id, v_home, v_away, v_ronda);
      end if;
    end loop;

    -- El casillero 1 queda fijo; el último pasa a la posición 2, y el
    -- resto se corre un lugar hacia la derecha.
    v_ultimo := v_slots[8];
    v_slots := array[v_slots[1], v_ultimo, v_slots[2], v_slots[3], v_slots[4], v_slots[5], v_slots[6], v_slots[7]];
  end loop;

  -- cantidad_grupos/avanzan_por_grupo quedan en 1/4 para que
  -- generar_llave() reutilice tal cual su rama existente de "cerrar
  -- grupos y armar la llave con los clasificados" -- ver el sembrado
  -- especial para formato_liga = 'first_stand' dentro de esa función.
  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'grupos',
        tiene_fase_grupos = true, cantidad_grupos = 1, avanzan_por_grupo = 4
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_fixture_first_stand(uuid) to authenticated;

-- ------------------------------------------------------------
-- reportar_resultado_grupo(): se le agrega un parámetro opcional para
-- el resultado del que perdió (0 o 1, ya que el ganador de un Bo3
-- siempre tiene 2) -- sin este dato no hay forma de distinguir un 2-0
-- de un 2-1 para el sistema de puntos. Sigue funcionando exactamente
-- igual que antes para cualquier torneo que no mande este parámetro
-- (queda null, como hasta ahora).
-- ------------------------------------------------------------
drop function if exists public.reportar_resultado_grupo(uuid, uuid);

create or replace function public.reportar_resultado_grupo(
  p_match_id uuid, p_ganador_id uuid, p_resultado_perdedor integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
begin
  select * into v_match from public.tournament_group_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;
  if p_resultado_perdedor is not null and p_resultado_perdedor not in (0, 1) then
    raise exception 'El resultado del equipo que perdió tiene que ser 0 o 1 (al mejor de 3).';
  end if;

  select t.* into v_torneo
  from public.tournaments t
  join public.tournament_groups g on g.tournament_id = t.id
  where g.id = v_match.group_id;

  v_es_organizador := (v_torneo.creador_id = auth.uid());

  if not v_es_organizador
     and not public.es_dueno_del_participante(v_match.participant1_id)
     and not public.es_dueno_del_participante(v_match.participant2_id)
  then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  update public.tournament_group_matches
    set ganador_id = p_ganador_id,
        status = 'jugado',
        resultado_participant1 = case
          when p_resultado_perdedor is null then null
          when p_ganador_id = v_match.participant1_id then 2
          else p_resultado_perdedor
        end,
        resultado_participant2 = case
          when p_resultado_perdedor is null then null
          when p_ganador_id = v_match.participant2_id then 2
          else p_resultado_perdedor
        end
    where id = p_match_id;
end;
$$;

grant execute on function public.reportar_resultado_grupo(uuid, uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- posiciones_grupos(): se agregan "puntos" y "dif_mapas". Para
-- partidos sin resultado detallado (todos los torneos de grupos de
-- antes de esta migración, que solo guardan ganador binario), cada
-- victoria vale puntos_victoria_2_1 -- el mismo valor para todas, así
-- que el orden que da "puntos" queda idéntico al que daba "ganados"
-- antes: esto no cambia el comportamiento de ningún torneo existente.
-- ------------------------------------------------------------
drop function if exists public.posiciones_grupos(uuid);

create or replace function public.posiciones_grupos(p_tournament_id uuid)
returns table (
  group_id uuid,
  group_nombre text,
  participant_id uuid,
  ganados bigint,
  jugados bigint,
  puntos bigint,
  dif_mapas bigint,
  inscrito_en timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    g.id as group_id,
    g.nombre as group_nombre,
    gp.participant_id,
    coalesce(w.ganados, 0) as ganados,
    coalesce(pl.jugados, 0) as jugados,
    coalesce(pts.puntos, 0) as puntos,
    coalesce(dif.dif_mapas, 0) as dif_mapas,
    tp.inscrito_en
  from public.tournament_groups g
  join public.tournament_group_participants gp on gp.group_id = g.id
  join public.tournament_participants tp on tp.id = gp.participant_id
  left join (
    select group_id, ganador_id, count(*) as ganados
    from public.tournament_group_matches
    where status = 'jugado'
    group by group_id, ganador_id
  ) w on w.group_id = g.id and w.ganador_id = gp.participant_id
  left join (
    select group_id, participant_id, count(*) as jugados
    from (
      select group_id, participant1_id as participant_id
      from public.tournament_group_matches where status = 'jugado'
      union all
      select group_id, participant2_id as participant_id
      from public.tournament_group_matches where status = 'jugado'
    ) jugados_por_participante
    group by group_id, participant_id
  ) pl on pl.group_id = g.id and pl.participant_id = gp.participant_id
  left join (
    select gm.group_id, gm.ganador_id,
      sum(
        case
          when gm.resultado_participant1 = 0 or gm.resultado_participant2 = 0 then t2.puntos_victoria_2_0
          else t2.puntos_victoria_2_1
        end
      ) as puntos
    from public.tournament_group_matches gm
    join public.tournament_groups g2 on g2.id = gm.group_id
    join public.tournaments t2 on t2.id = g2.tournament_id
    where gm.status = 'jugado'
    group by gm.group_id, gm.ganador_id
  ) pts on pts.group_id = g.id and pts.ganador_id = gp.participant_id
  left join (
    select group_id, participant_id, sum(dif) as dif_mapas
    from (
      select group_id, participant1_id as participant_id,
        coalesce(resultado_participant1, 0) - coalesce(resultado_participant2, 0) as dif
      from public.tournament_group_matches where status = 'jugado'
      union all
      select group_id, participant2_id as participant_id,
        coalesce(resultado_participant2, 0) - coalesce(resultado_participant1, 0) as dif
      from public.tournament_group_matches where status = 'jugado'
    ) difs
    group by group_id, participant_id
  ) dif on dif.group_id = g.id and dif.participant_id = gp.participant_id
  where g.tournament_id = p_tournament_id
  order by g.nombre, coalesce(pts.puntos, 0) desc, coalesce(dif.dif_mapas, 0) desc, tp.inscrito_en asc;
$$;

grant execute on function public.posiciones_grupos(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- generar_llave(): dos agregados, ambos exclusivos de
-- formato_liga = 'first_stand' -- para cualquier otro torneo con
-- etapa de grupos, el comportamiento queda idéntico a como estaba
-- (mismo orden por ganados/puntos, sembrado al azar).
--
-- 1. Sembrado 1° vs 4°, 2° vs 3° en vez de al azar -- el array se
--    arma en el orden exacto que hace que el loop de más abajo (que
--    saca de a 2 participantes desde el final del array) produzca
--    esos cruces en la ronda 1.
-- 2. La final (ronda 2, la única con 4 clasificados) queda marcada
--    como Bo5.
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
  v_checked_in_count int;
  v_jugadores_por_equipo int;
  v_total_clanes int;
  v_total_jugadores int;
  v_cantidad_evento int;
  v_origen_evento text;
  v_team_organizador uuid;
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
    -- Cerrando la etapa de grupos: desde que se generaron los grupos
    -- el torneo ya está 'en_curso', no 'abierto' (ver generar_grupos()).
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

    if v_torneo.formato_liga = 'first_stand' then
      select array_agg(participant_id order by puesto_orden)
      into v_participantes
      from (
        select participant_id,
          case puesto when 1 then 3 when 2 then 1 when 3 then 2 when 4 then 4 end as puesto_orden
        from (
          select participant_id,
                 row_number() over (order by puntos desc, dif_mapas desc, inscrito_en asc) as puesto
          from public.posiciones_grupos(p_tournament_id)
        ) clasificados
        where puesto <= 4
      ) sembrados;
    else
      -- Los avanzan_por_grupo mejores de cada grupo, según la tabla de
      -- posiciones (puntos desc, diferencia de mapas como desempate,
      -- orden de inscripción como último desempate).
      select array_agg(participant_id order by random())
      into v_participantes
      from (
        select participant_id,
               row_number() over (
                 partition by group_id order by puntos desc, dif_mapas desc, inscrito_en asc
               ) as puesto
        from public.posiciones_grupos(p_tournament_id)
      ) clasificados
      where puesto <= v_torneo.avanzan_por_grupo;
    end if;
  else
    if v_torneo.estado <> 'abierto' then
      raise exception 'Este torneo ya no está abierto para generar la llave.';
    end if;

    -- Migración 010: solo entran a la llave los que confirmaron
    -- check_in = true -- los demás quedan afuera de esta edición, sin
    -- bye ni nada.
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

  select array_agg(x order by random())
  into v_bye_matches
  from generate_series(1, v_num_matches) as x;
  v_bye_matches := v_bye_matches[1:v_num_byes];

  for v_i in 1..v_num_matches loop
    v_es_bye := v_i = any(v_bye_matches);

    v_p1 := v_participantes[array_length(v_participantes, 1)];
    v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];

    if v_es_bye then
      v_p2 := null;
    else
      v_p2 := v_participantes[array_length(v_participantes, 1)];
      v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];
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

  -- El marcado de la final como Bo5 NO va acá: en este punto la ronda 2
  -- todavía no existe, se crea recién más adelante, cuando se juega la
  -- segunda semifinal (avanzar_ganador() la crea sobre la marcha, como
  -- cualquier ronda siguiente de la llave) -- ver el agregado ahí.

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

  -- Migración 050: carisma de equipo por el tamaño real del evento --
  -- se cuenta acá, con las inscripciones ya cerradas y la llave ya
  -- generada. Se recuenta directo de tournament_participants (no se
  -- reutiliza v_n) para que, en un torneo con etapa de grupos, el
  -- tamaño refleje a TODOS los que se inscribieron y confirmaron, no
  -- solo a quienes avanzaron de grupos.
  select count(*) into v_checked_in_count
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_jugadores_por_equipo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
    else 1
  end;
  -- "Clanes" solo tiene sentido en un torneo por equipos -- en 1v1
  -- queda en 0 a propósito, así el nivel "evento_masivo" (más de 5
  -- clanes) nunca se puede alcanzar ahí.
  v_total_clanes := case when v_torneo.formato = '1v1' then 0 else v_checked_in_count end;
  v_total_jugadores := v_checked_in_count * v_jugadores_por_equipo;

  if v_total_clanes > 5 and v_total_jugadores > 16 then
    v_cantidad_evento := 40;
    v_origen_evento := 'evento_masivo';
  elsif v_total_jugadores > 16 then
    v_cantidad_evento := 15;
    v_origen_evento := 'evento_grande';
  else
    v_cantidad_evento := 5;
    v_origen_evento := 'evento_normal';
  end if;

  -- Solo si quien organiza (creador_id) es dueño o capitán de un
  -- equipo actualmente -- sin eso, no hay a quién otorgarle el carisma.
  select tm.team_id into v_team_organizador
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.user_id = v_torneo.creador_id
    and (t.owner_id = v_torneo.creador_id or tm.es_capitan);

  if v_team_organizador is not null then
    perform public.registrar_carisma_equipo(v_team_organizador, v_cantidad_evento, v_origen_evento);
  end if;
end;
$$;

grant execute on function public.generar_llave(uuid) to authenticated;

-- ------------------------------------------------------------
-- avanzar_ganador(): un solo agregado, exclusivo de
-- formato_liga = 'first_stand' -- cuando el partido que se está
-- creando es la ronda siguiente a una ronda de exactamente 2 partidos
-- (es decir, es la final, se juega justo después de las semifinales),
-- queda marcado como Bo5 en vez de "normal". Mismo criterio
-- (v_total_en_ronda = 2) que ya usa esta función más arriba para
-- decidir si corresponde generar el partido por el tercer lugar.
-- ------------------------------------------------------------
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

  -- El partido por el tercer lugar (migración 046) no avanza a ningún
  -- lado: solo guarda su ganador y termina acá.
  if v_match.es_tercer_lugar then
    update public.tournaments
      set tercer_lugar_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round and not es_tercer_lugar;

  -- Partido por el tercer lugar (migración 046): se genera al
  -- completarse las dos semifinales, reconocibles porque su ronda
  -- tiene exactamente 2 partidos (la ronda siguiente, la final,
  -- siempre tiene 1 solo). Si alguna semifinal fue un bye (sin
  -- segundo participante) no hay un perdedor real de ese lado -- se
  -- omite el partido por el tercer lugar en ese caso.
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
      -- v_total_en_ronda = 2 acá significa lo mismo que arriba: se está
      -- creando la final, justo después de que terminaron las dos
      -- semifinales.
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

-- ------------------------------------------------------------
-- Invitación rápida de varios clanes a la vez (comodidad, no un
-- sistema nuevo): inscribir_equipo() solo puede inscribir al equipo
-- del que quien llama ya es dueño (lo resuelve por auth.uid(), sin
-- parámetro de equipo) -- no hay forma de reutilizarla tal cual para
-- que el organizador inscriba equipos ajenos, ni llamándola varias
-- veces. Esta función nueva es el equivalente exacto, pero para el
-- organizador del torneo y con el equipo indicado a mano.
-- ------------------------------------------------------------
create or replace function public.organizador_inscribir_equipo(p_tournament_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_miembros int;
  v_minimo int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador del torneo puede invitar equipos directamente.';
  end if;
  if v_torneo.formato not in ('2v2', '3v3', '4v4') then
    raise exception 'Este torneo no es por equipos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id and not disuelto) then
    raise exception 'Ese equipo no existe o está disuelto.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = p_team_id;

  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
  end;

  if v_miembros < v_minimo then
    raise exception 'Ese equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  insert into public.tournament_participants (tournament_id, team_id)
  values (p_tournament_id, p_team_id);
end;
$$;

grant execute on function public.organizador_inscribir_equipo(uuid, uuid) to authenticated;
