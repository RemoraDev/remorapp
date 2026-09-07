-- ------------------------------------------------------------
-- Migración 069: dos formatos de torneo nuevos (Suizo y Tabla de
-- posiciones/Leaderboard) y un primer paquete de opciones avanzadas
-- para el formulario de creación (pestañas Bracket/Permissions/Misc
-- del PDF de referencia -- Notifications, adjuntos en partidos,
-- avance rápido y compartir acceso de admin quedan para un pedido
-- aparte, esta migración no los toca).
-- ------------------------------------------------------------

alter table public.tournaments drop constraint tournaments_modo_check;
alter table public.tournaments add constraint tournaments_modo_check
  check (modo in (
    'eliminacion_simple', 'eliminacion_doble', 'todos_contra_todos', 'rey_de_la_colina',
    'suizo', 'tabla_posiciones'
  ));

-- Suizo: cantidad de rondas -- si el organizador no la fija a mano,
-- generar_torneo_suizo() la calcula sola (techo de log2 de la
-- cantidad de inscritos).
alter table public.tournaments add column swiss_rondas_totales integer check (swiss_rondas_totales is null or swiss_rondas_totales > 0);

-- Opciones avanzadas -- pestaña Bracket.
alter table public.tournaments add column mostrar_nombres_ronda_personalizados boolean not null default false;
alter table public.tournaments add column ocultar_numeros_semilla boolean not null default false;
alter table public.tournaments add column ocultar_bracket_publico boolean not null default false;
alter table public.tournaments add column reglas_semillas text not null default 'aleatorio'
  check (reglas_semillas in ('aleatorio', 'tradicional'));

-- Opciones avanzadas -- pestaña Permissions. El autoreporte de
-- resultados por los propios participantes YA es el comportamiento de
-- siempre en reportar_resultado() -- esta columna, en false, es lo que
-- ahora permite DESACTIVARLO y dejar el reporte exclusivo del
-- organizador (que es la única forma real de "permiso" que tenía
-- sentido agregar, ya que el autoreporte de por sí ya existía).
alter table public.tournaments add column permite_autoreporte boolean not null default true;
alter table public.tournaments add column excluido_de_busqueda boolean not null default false;

-- Opciones avanzadas -- pestaña Misc.
alter table public.tournaments add column mostrar_posiciones boolean not null default true;

-- ------------------------------------------------------------
-- Formato Suizo: reutiliza tournament_groups / tournament_group_participants
-- / tournament_group_matches / posiciones_grupos() tal cual -- un
-- torneo Suizo es, en los hechos, un solo grupo cuyas rondas se van
-- generando de a una (no todas de entrada, como en todos contra
-- todos), emparejando por posiciones actuales y evitando revanchas.
-- ------------------------------------------------------------
create or replace function public.generar_torneo_suizo(p_tournament_id uuid)
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
  v_rondas int;
  v_i int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede iniciar el torneo.';
  end if;
  if v_torneo.modo <> 'suizo' then
    raise exception 'Este torneo no es de formato Suizo.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para iniciar.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'Necesitas al menos 3 jugadores confirmados para un torneo Suizo.';
  end if;

  -- Techo de log2(n): cantidad de rondas habitual en un Suizo, si el
  -- organizador no fijó una a mano al crear el torneo.
  v_rondas := coalesce(v_torneo.swiss_rondas_totales, ceil(log(2, v_n))::int);
  if v_rondas < 1 then
    v_rondas := 1;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Suizo')
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  -- Ronda 1: sin resultados todavía, empareja por sorteo -- de la 2 en
  -- adelante empareja por posiciones (ver generar_siguiente_ronda_suiza).
  v_i := 1;
  while v_i < v_n loop
    insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
    values (v_grupo_id, v_participantes[v_i], v_participantes[v_i + 1], 1);
    v_i := v_i + 2;
  end loop;
  -- Impar: el último queda libre esta ronda (bye), gana el punto sin
  -- jugar -- se resuelve con una fila ya jugada contra sí mismo... no:
  -- en vez de eso, directamente no se le crea partido esta ronda, y
  -- calcularle_puntos_suizo() (dentro de la función de standings) lo
  -- trata como "no jugó" esa ronda, sin sumar ni restar.

  update public.tournaments
    set estado = 'en_curso', swiss_rondas_totales = v_rondas
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_torneo_suizo(uuid) to authenticated;

-- Empareja la siguiente ronda por posiciones actuales (más puntos
-- primero), evitando repetir un cruce ya jugado -- algoritmo Suizo
-- simplificado: recorre la lista ordenada y empareja cada jugador
-- libre con el más cercano en la tabla que todavía no haya enfrentado.
-- Si ya se jugaron todas las rondas configuradas, en vez de armar una
-- ronda más cierra el torneo (campeón = primero en la tabla).
create or replace function public.generar_siguiente_ronda_suiza(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_grupo_id uuid;
  v_ronda_actual int;
  v_pendientes int;
  v_ordenados uuid[];
  v_usado boolean[];
  v_n int;
  v_i int;
  v_j int;
  v_ya_jugaron boolean;
  v_campeon uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede avanzar de ronda.';
  end if;
  if v_torneo.modo <> 'suizo' then
    raise exception 'Este torneo no es de formato Suizo.';
  end if;

  select id into v_grupo_id from public.tournament_groups where tournament_id = p_tournament_id;
  if v_grupo_id is null then
    raise exception 'Todavía no se inició el torneo.';
  end if;

  select max(jornada) into v_ronda_actual from public.tournament_group_matches where group_id = v_grupo_id;

  select count(*) into v_pendientes
  from public.tournament_group_matches
  where group_id = v_grupo_id and jornada = v_ronda_actual and status <> 'jugado';

  if v_pendientes > 0 then
    raise exception 'Todavía faltan % partido(s) de la ronda % por jugarse.', v_pendientes, v_ronda_actual;
  end if;

  if v_ronda_actual >= v_torneo.swiss_rondas_totales then
    select participant_id into v_campeon
    from public.posiciones_grupos(p_tournament_id)
    order by puntos desc, dif_mapas desc, inscrito_en asc
    limit 1;

    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_campeon
      where id = p_tournament_id;
    return;
  end if;

  -- Orden actual de la tabla: más puntos primero, mismo desempate que
  -- posiciones_grupos() ya usa para el resto de los formatos.
  select array_agg(participant_id order by puntos desc, dif_mapas desc, inscrito_en asc)
  into v_ordenados
  from public.posiciones_grupos(p_tournament_id);

  v_n := array_length(v_ordenados, 1);
  v_usado := array_fill(false, array[v_n]);

  for v_i in 1..v_n loop
    if v_usado[v_i] then
      continue;
    end if;

    for v_j in (v_i + 1)..v_n loop
      if v_usado[v_j] then
        continue;
      end if;

      select exists (
        select 1 from public.tournament_group_matches
        where group_id = v_grupo_id
          and (
            (participant1_id = v_ordenados[v_i] and participant2_id = v_ordenados[v_j])
            or (participant1_id = v_ordenados[v_j] and participant2_id = v_ordenados[v_i])
          )
      ) into v_ya_jugaron;

      if not v_ya_jugaron then
        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
        values (v_grupo_id, v_ordenados[v_i], v_ordenados[v_j], v_ronda_actual + 1);
        v_usado[v_i] := true;
        v_usado[v_j] := true;
        exit;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.generar_siguiente_ronda_suiza(uuid) to authenticated;

-- posiciones_grupos() ya devuelve "puntos" (migración 057, pensada
-- para First Stand) -- se generaliza para que sume 1 punto por
-- partido ganado también fuera de First Stand (antes esa columna
-- dependía de puntos_victoria_2_0/2_1, que solo tienen sentido en
-- formato WTL). Con eliminacion_simple/todos_contra_todos/suizo
-- (formato "simple", sin sets), 1 punto por victoria es el criterio
-- correcto y coincide con "ganados" -- se deja "puntos" igual a
-- "ganados" para esos casos, sin tocar el criterio de First Stand.
-- (Sin cambios de código acá: ya funciona así -- este comentario queda
-- para dejar constancia de que se revisó antes de reutilizarla para
-- Suizo.)

-- ------------------------------------------------------------
-- Formato Tabla de posiciones (Leaderboard): sin cuadro ni grupos --
-- el organizador asigna el puntaje de cada inscrito directamente,
-- "por el criterio que corresponda" (torneos, tiempos, lo que sea),
-- y la tabla se ordena sola por ese puntaje.
-- ------------------------------------------------------------
alter table public.tournament_participants add column puntos_leaderboard integer not null default 0;

create or replace function public.actualizar_puntos_leaderboard(p_participant_id uuid, p_puntos integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
begin
  select * into v_participante from public.tournament_participants where id = p_participant_id;
  if v_participante is null then
    raise exception 'Ese participante no existe.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede actualizar los puntajes.';
  end if;
  if v_torneo.modo <> 'tabla_posiciones' then
    raise exception 'Este torneo no es de formato Tabla de posiciones.';
  end if;
  if v_torneo.estado = 'finalizado' then
    raise exception 'Este torneo ya finalizó.';
  end if;

  update public.tournament_participants set puntos_leaderboard = p_puntos where id = p_participant_id;
end;
$$;

grant execute on function public.actualizar_puntos_leaderboard(uuid, integer) to authenticated;

create or replace function public.finalizar_leaderboard(p_tournament_id uuid, p_campeon_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;
  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede finalizar el torneo.';
  end if;
  if v_torneo.modo <> 'tabla_posiciones' then
    raise exception 'Este torneo no es de formato Tabla de posiciones.';
  end if;
  if not exists (
    select 1 from public.tournament_participants
    where id = p_campeon_participant_id and tournament_id = p_tournament_id
  ) then
    raise exception 'Ese participante no está inscrito en este torneo.';
  end if;

  update public.tournaments
    set estado = 'finalizado', campeon_participant_id = p_campeon_participant_id
    where id = p_tournament_id;
end;
$$;

grant execute on function public.finalizar_leaderboard(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- reportar_resultado(): mismo cuerpo, con el gate nuevo de
-- permite_autoreporte -- en false, el organizador sigue pudiendo
-- reportar (esa rama no cambia), pero un participante ya no puede.
-- ------------------------------------------------------------
create or replace function public.reportar_resultado(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
  v_soy_p1 boolean;
  v_soy_p2 boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if v_match.status = 'en_disputa' then
    raise exception 'Resultado en disputa, un administrador debe resolverlo.';
  end if;
  if v_match.participant2_id is null then
    raise exception 'Esta partida es un bye, no se reporta.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  v_es_organizador := (v_torneo.creador_id = auth.uid());

  v_soy_p1 := public.es_dueno_del_participante(v_match.participant1_id);
  v_soy_p2 := public.es_dueno_del_participante(v_match.participant2_id);

  if not v_es_organizador and not v_soy_p1 and not v_soy_p2 then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  if not v_es_organizador and not v_torneo.permite_autoreporte then
    raise exception 'El organizador de este torneo desactivó el autoreporte -- solo él puede cargar resultados.';
  end if;

  if v_es_organizador then
    update public.bracket_matches
      set winner_id = p_ganador_id, status = 'jugado'
      where id = p_match_id;
  else
    if v_soy_p1 then
      update public.bracket_matches set reported_p1_winner = p_ganador_id where id = p_match_id;
    else
      update public.bracket_matches set reported_p2_winner = p_ganador_id where id = p_match_id;
    end if;

    select * into v_match from public.bracket_matches where id = p_match_id;

    if v_match.reported_p1_winner is not null and v_match.reported_p2_winner is not null then
      if v_match.reported_p1_winner = v_match.reported_p2_winner then
        update public.bracket_matches
          set winner_id = v_match.reported_p1_winner, status = 'jugado'
          where id = p_match_id;
      else
        update public.bracket_matches set status = 'en_disputa' where id = p_match_id;
      end if;
    end if;
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.status = 'jugado' then
    perform public.avanzar_ganador(p_match_id);
  end if;
end;
$$;

grant execute on function public.reportar_resultado(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- generar_llave(): se agrega la semilla "tradicional" -- ordena a los
-- clasificados por MMR (mmr_1v1 para participantes individuales,
-- mmr del equipo para participantes por equipo) y los ubica en el
-- cuadro con el orden de semillas estándar (1 vs 16, 2 vs 15, ...),
-- en vez del sorteo puro de siempre. "aleatorio" (el default) no
-- cambia nada de su comportamiento anterior.
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
