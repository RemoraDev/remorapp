-- ------------------------------------------------------------
-- Migración 085: arregla los bugs encontrados en la auditoría completa
-- de la web (5 revisiones en paralelo). Cada bloque de abajo es
-- independiente -- ver el resumen que se le dio al usuario para el
-- detalle de cada uno.
-- ------------------------------------------------------------

-- ---------- 1. CRÍTICO: avanzar_ganador_doble()/avanzar_ganador() sin
-- control de acceso -- son funciones "security definer" con
-- "grant execute to authenticated", así que Postgrest las expone como
-- RPC directo: cualquier usuario logueado podía llamarlas con el id de
-- CUALQUIER partido y corromper la llave o autoproclamarse campeón,
-- sin haber reportado nada real. reportar_resultado() ya validaba esto
-- antes de llamarlas, pero la llamada directa se saltaba ese chequeo
-- por completo. Se agrega acá, adentro de las dos funciones, el mismo
-- criterio que ya usa reportar_resultado(): organizador, o dueño de
-- alguno de los dos participantes, y que el partido ya tenga ganador
-- cargado (nunca se debería avanzar un partido sin resultado).
-- ------------------------------------------------------------

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
    if v_match.winner_id = v_match.participant1_id then
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

  -- Igual que en avanzar_ganador_doble(): esta función es security
  -- definer con grant a authenticated, así que Postgrest la expone
  -- como RPC directo -- sin este chequeo, cualquier usuario logueado
  -- podía llamarla con el id de cualquier partido de cualquier torneo.
  if v_match.status <> 'jugado' or v_match.winner_id is null then
    raise exception 'Este partido todavía no tiene resultado.';
  end if;
  if v_torneo.creador_id <> auth.uid()
     and not public.es_dueno_del_participante(v_match.participant1_id)
     and not public.es_dueno_del_participante(v_match.participant2_id)
  then
    raise exception 'No tienes permiso para avanzar este partido.';
  end if;

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
grant execute on function public.avanzar_ganador_doble(uuid) to authenticated;

-- ---------- 2. reportar_resultado_grupo() ignoraba permite_autoreporte ----------
-- El organizador puede desactivar el autoreporte, pero eso solo se
-- chequeaba en reportar_resultado() (llave eliminatoria) -- en grupos,
-- Suizo, Todos contra todos y la fase de grupos de First Stand,
-- cualquier participante podía seguir autoreportando igual.
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
  if v_match.clan_war_id is not null then
    raise exception 'Este partido se juega como Clan War -- reportalo desde ahí, no con este botón.';
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

  if not v_es_organizador and not v_torneo.permite_autoreporte then
    raise exception 'El organizador de este torneo desactivó el autoreporte -- solo él puede cargar resultados.';
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

-- ---------- 3. Suizo: cantidad impar de inscritos dejaba a alguien sin
-- jugar y sin punto de compensación cada ronda ----------
-- tournament_group_matches.participant2_id pasa a admitir null, mismo
-- criterio que bracket_matches para un bye: cuando es null, el partido
-- ya nace 'jugado' con el propio participant1_id como ganador (no es
-- un hueco esperando resultado, es un bye real). posiciones_grupos()
-- no necesita cambios: ya suma "ganados"/"jugados" a partir de
-- ganador_id/participant1_id, y un participant2_id null simplemente no
-- matchea contra ningún participante real en el otro lado del UNION.
alter table public.tournament_group_matches
  alter column participant2_id drop not null;

alter table public.tournament_group_matches
  add constraint tournament_group_matches_bye_jugado
  check (participant2_id is not null or (status = 'jugado' and ganador_id = participant1_id));

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
  where tournament_id = p_tournament_id;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'Necesitas al menos 3 jugadores inscritos para un torneo Suizo.';
  end if;

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

  v_i := 1;
  while v_i < v_n loop
    insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
    values (v_grupo_id, v_participantes[v_i], v_participantes[v_i + 1], 1);
    v_i := v_i + 2;
  end loop;

  -- Cantidad impar de inscritos: al último de la lista no le tocó
  -- rival -- recibe un bye (partido ya jugado, ganado solo).
  if v_i = v_n then
    insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, ganador_id, status, jornada)
    values (v_grupo_id, v_participantes[v_i], null, v_participantes[v_i], 'jugado', 1);
  end if;

  update public.tournaments
    set estado = 'en_curso', swiss_rondas_totales = v_rondas
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_torneo_suizo(uuid) to authenticated;

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

  -- Cantidad impar de participantes activos: quien haya quedado sin
  -- pareja (no encontró rival nuevo) recibe un bye esta ronda -- antes
  -- se quedaba directamente sin jugar y sin sumar nada.
  for v_i in 1..v_n loop
    if not v_usado[v_i] then
      insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, ganador_id, status, jornada)
      values (v_grupo_id, v_ordenados[v_i], null, v_ordenados[v_i], 'jugado', v_ronda_actual + 1);
    end if;
  end loop;
end;
$$;

grant execute on function public.generar_siguiente_ronda_suiza(uuid) to authenticated;

-- ---------- 4. responder_solicitud_torneo() no revalidaba el mínimo
-- de integrantes del equipo al aceptar (su gemela, responder_invitacion_torneo_equipo(),
-- sí lo hacía) ----------
create or replace function public.responder_solicitud_torneo(p_solicitud_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_torneo record;
  v_miembros int;
  v_minimo int;
begin
  select * into v_solicitud from public.torneo_solicitudes_equipo where id = p_solicitud_id for update;

  if v_solicitud is null then
    raise exception 'Esa solicitud no existe.';
  end if;
  if v_solicitud.status <> 'pendiente' then
    raise exception 'Esa solicitud ya fue respondida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_solicitud.tournament_id for update;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede responder esta solicitud.';
  end if;

  if not p_aceptar then
    update public.torneo_solicitudes_equipo set status = 'rechazada', respondida_en = now() where id = p_solicitud_id;
    return;
  end if;

  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;
  if exists (
    select 1 from public.tournament_participants where tournament_id = v_torneo.id and team_id = v_solicitud.equipo_id
  ) then
    raise exception 'Ese equipo ya está inscrito en este torneo.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = v_solicitud.equipo_id;
  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
  end;
  if v_minimo is not null and v_miembros < v_minimo then
    raise exception 'Ese equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  insert into public.tournament_participants (tournament_id, team_id) values (v_torneo.id, v_solicitud.equipo_id);

  update public.torneo_solicitudes_equipo set status = 'aceptada', respondida_en = now() where id = p_solicitud_id;
end;
$$;

grant execute on function public.responder_solicitud_torneo(uuid, boolean) to authenticated;

-- ---------- 5. ranking_jugadores() no filtraba cuentas suspendidas
-- (Sala de la Fama sí lo hacía -- mismo criterio del resto de la app:
-- una cuenta suspendida no aparece en listados públicos) ----------
create or replace function public.ranking_jugadores()
returns table (
  jugador_id uuid,
  nick text,
  unique_id text,
  liga text,
  raza_principal text,
  team_id uuid,
  team_name text,
  team_tag text,
  team_logo_url text,
  victorias bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with victorias_bracket_1v1 as (
    select tp.user_id as jugador_id, count(*) as cnt
    from public.bracket_matches bm
    join public.tournaments t on t.id = bm.tournament_id
    join public.tournament_participants tp on tp.id = bm.winner_id
    where t.formato = '1v1'
      and bm.status = 'jugado'
      and bm.participant1_id is not null
      and bm.participant2_id is not null
      and tp.user_id is not null
    group by tp.user_id
  ),
  victorias_grupos_1v1 as (
    select tp.user_id as jugador_id, count(*) as cnt
    from public.tournament_group_matches gm
    join public.tournament_groups g on g.id = gm.group_id
    join public.tournaments t on t.id = g.tournament_id
    join public.tournament_participants tp on tp.id = gm.ganador_id
    where t.formato = '1v1'
      and gm.status = 'jugado'
      and tp.user_id is not null
    group by tp.user_id
  ),
  victorias_cw_simple as (
    select ganador_id as jugador_id, count(*) as cnt
    from public.clan_war_matches
    where status = 'jugado' and ganador_id is not null
    group by ganador_id
  ),
  victorias_wtl as (
    select jugador_id, count(*) as cnt
    from (
      select jugador_challenger_id as jugador_id
      from public.clan_war_wtl_sets
      where status = 'jugado' and mapas_ganados_challenger > mapas_ganados_challenged
      union all
      select jugador_challenged_id as jugador_id
      from public.clan_war_wtl_sets
      where status = 'jugado' and mapas_ganados_challenged > mapas_ganados_challenger
    ) w
    group by jugador_id
  ),
  totales as (
    select jugador_id, sum(cnt) as victorias
    from (
      select * from victorias_bracket_1v1
      union all
      select * from victorias_grupos_1v1
      union all
      select * from victorias_cw_simple
      union all
      select * from victorias_wtl
    ) todas
    group by jugador_id
  )
  select
    p.id as jugador_id,
    p.nick,
    p.unique_id,
    p.liga_1v1 as liga,
    pj.datos ->> 'raza_principal' as raza_principal,
    tm.team_id,
    te.name as team_name,
    te.tag as team_tag,
    te.logo_url as team_logo_url,
    tot.victorias
  from totales tot
  join public.profiles p on p.id = tot.jugador_id
  left join public.catalogo_juegos cj on cj.nombre = 'StarCraft II'
  left join public.perfiles_juego pj on pj.user_id = p.id and pj.juego_id = cj.id
  left join public.team_members tm on tm.user_id = p.id
  left join public.teams te on te.id = tm.team_id
  where not p.suspendido
  order by tot.victorias desc, p.nick asc nulls last;
$$;

grant execute on function public.ranking_jugadores() to anon, authenticated;

-- ---------- 6. tournaments_update_organizador solo exige ser el
-- organizador, sin restricción de qué columnas puede tocar ni en qué
-- estado -- el gate de "Panel de organizador" (modo === 'abierto',
-- etc.) es puramente visual en el frontend. Un organizador podía, con
-- una llamada directa a la API (no hace falta el navegador, alcanza
-- con la consola), cambiar tournaments.modo o formato_liga con el
-- torneo ya en curso -- avanzar_ganador()/avanzar_ganador_doble()
-- deciden su rama según ESE campo, así que un cambio a mitad de
-- camino corrompe la llave. Se bloquea con un trigger: una vez que el
-- torneo dejó de estar 'abierto', modo y formato_liga quedan
-- congelados -- el resto de las columnas (opciones avanzadas, etc.)
-- se siguen pudiendo editar en cualquier momento, sin cambios. ----------
create or replace function public.bloquear_cambio_modo_torneo()
returns trigger
language plpgsql
as $$
begin
  if old.estado <> 'abierto' and (new.modo <> old.modo or new.formato_liga is distinct from old.formato_liga) then
    raise exception 'No se puede cambiar el modo de juego de un torneo que ya arrancó.';
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_bloquear_modo on public.tournaments;

create trigger before_update_bloquear_modo
  before update on public.tournaments
  for each row execute function public.bloquear_cambio_modo_torneo();
