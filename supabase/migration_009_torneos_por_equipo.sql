-- ============================================================
-- Migración 009: torneos por equipo (2v2, 3v3, 4v4).
--
-- Reutiliza el sistema de equipos que ya existe (teams,
-- team_members) y el motor de llave que ya existe (generar_llave,
-- avanzar_ganador, reportar_resultado) -- no se duplica nada de eso,
-- solo se extiende.
--
-- Idea central: tournament_participants ahora puede representar a UN
-- JUGADOR (user_id) o a UN EQUIPO (team_id), nunca los dos a la vez.
-- bracket_matches ya trabajaba solo con tournament_participants.id
-- (nunca leyó user_id directo), así que generar_llave() y
-- avanzar_ganador() funcionan igual sin tocarles una línea -- el
-- emparejamiento, los byes y el avance de rondas no les importa si el
-- participante de atrás es un jugador o un equipo.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) tournament_participants: agregar team_id, permitir user_id nulo,
--    y que sea exactamente uno de los dos (no ambos, no ninguno).
-- ------------------------------------------------------------
alter table public.tournament_participants alter column user_id drop not null;

alter table public.tournament_participants
  add column team_id uuid references public.teams (id);

alter table public.tournament_participants
  add constraint tournament_participants_jugador_o_equipo check (
    (user_id is not null and team_id is null)
    or (user_id is null and team_id is not null)
  );

-- Ya existía unique(tournament_id, user_id) desde el inicio (evita
-- inscribirse dos veces como jugador); esta es la misma idea para
-- equipos -- un equipo no puede inscribirse dos veces al mismo
-- torneo. Los NULL nunca chocan entre sí en un unique de Postgres,
-- así que esta constraint no molesta a las filas de jugador individual
-- (team_id null) ni viceversa.
alter table public.tournament_participants
  add constraint tournament_participants_tournament_id_team_id_key unique (tournament_id, team_id);

-- ------------------------------------------------------------
-- 2) inscribir_equipo: la puerta de entrada para inscribir un EQUIPO
--    completo a un torneo 2v2/3v3/4v4. Solo el dueño del equipo puede
--    llamarla, y solo si el equipo tiene suficientes miembros para el
--    formato. security definer porque tournament_participants_insert_propio
--    (la política que ya existe) exige user_id = auth.uid() -- a
--    propósito no alcanza para dejar pasar una fila de equipo, así que
--    esta función es la única puerta para ese caso, igual que
--    crear_membresia_owner() lo es para el rol 'owner' en team_members.
-- ------------------------------------------------------------
create or replace function public.inscribir_equipo(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_team_id uuid;
  v_es_owner boolean;
  v_miembros int;
  v_minimo int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.formato not in ('2v2', '3v3', '4v4') then
    raise exception 'Este torneo no es por equipos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;

  select tm.team_id into v_team_id
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'Necesitas pertenecer a un equipo para inscribirte a este torneo.';
  end if;

  select exists (
    select 1 from public.team_members
    where team_id = v_team_id and user_id = auth.uid() and roles @> array['owner']::text[]
  ) into v_es_owner;

  if not v_es_owner then
    raise exception 'Solo el dueño del equipo puede inscribirlo a un torneo.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = v_team_id;

  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
  end;

  if v_miembros < v_minimo then
    raise exception
      'Tu equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  -- validar_inscripcion() (trigger que ya existe) vuelve a chequear
  -- estado/cupos antes del insert -- queda como respaldo por si dos
  -- inscripciones llegan casi al mismo tiempo.
  insert into public.tournament_participants (tournament_id, team_id)
  values (p_tournament_id, v_team_id);
end;
$$;

grant execute on function public.inscribir_equipo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) es_dueno_del_participante: "soy yo" para un participante de
--    bracket, sea jugador individual (soy la cuenta) o equipo (soy el
--    dueño de ese equipo -- no cualquier miembro, para que nadie
--    reporte un resultado sin acuerdo interno del clan). La usa
--    reportar_resultado() de acá para abajo, así esa función no
--    necesita saber ella misma si el torneo es 1v1 o por equipo.
-- ------------------------------------------------------------
create or replace function public.es_dueno_del_participante(p_participant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tournament_participants tp
    where tp.id = p_participant_id
      and (
        tp.user_id = auth.uid()
        or (
          tp.team_id is not null
          and exists (
            select 1 from public.team_members tm
            where tm.team_id = tp.team_id
              and tm.user_id = auth.uid()
              and tm.roles @> array['owner']::text[]
          )
        )
      )
  );
$$;

grant execute on function public.es_dueno_del_participante(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) generar_llave: se le saca la restricción a "1v1" -- el resto de
--    la función (emparejar al azar, asignar byes) queda exactamente
--    igual, porque nunca le importó qué hay detrás de cada
--    tournament_participants.id.
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
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar la llave.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 2 then
    raise exception 'Hace falta al menos 2 inscritos para generar la llave.';
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

  update public.tournaments set estado = 'en_curso' where id = p_tournament_id;

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

-- ------------------------------------------------------------
-- 5) reportar_resultado: el único cambio real es CÓMO se decide "soy
--    uno de los dos" -- ahora usa es_dueno_del_participante() en vez
--    de comparar user_id directo, así cubre participantes de jugador
--    individual Y de equipo con la misma función, sin duplicarla.
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

