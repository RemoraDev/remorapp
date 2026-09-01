-- ============================================================
-- Migración 010: check-in antes de generar la llave.
--
-- Evita byes injustos por gente que se inscribió y después no
-- apareció: el organizador abre el check-in, cada participante
-- confirma que va a jugar, y generar_llave() arma los emparejamientos
-- SOLO con los que confirmaron.
--
-- No duplica el motor de llave -- extiende generar_llave() (la misma
-- función de las migraciones 006/009), solo cambia DE DÓNDE saca la
-- lista de participantes.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas.
-- ------------------------------------------------------------
alter table public.tournament_participants
  add column checked_in boolean not null default false,
  add column checked_in_at timestamptz;

alter table public.tournaments
  add column check_in_abierto boolean not null default false;

-- ------------------------------------------------------------
-- 2) confirmar_asistencia: un participante (jugador individual, o el
--    dueño del equipo si es un torneo por equipo -- misma regla que
--    reportar_resultado, así nadie confirma sin acuerdo interno del
--    clan) marca que va a jugar. Sin política UPDATE en
--    tournament_participants para authenticated a propósito: esta
--    función es la única puerta, mismo patrón que quitar_miembro() y
--    resolver_disputa().
-- ------------------------------------------------------------
create or replace function public.confirmar_asistencia(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
begin
  select * into v_participante
  from public.tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Ese participante no existe.';
  end if;

  if not public.es_dueno_del_participante(p_participant_id) then
    raise exception 'No tienes permiso para confirmar esta inscripción.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id;

  if not v_torneo.check_in_abierto then
    raise exception 'El check-in no está abierto para este torneo.';
  end if;

  update public.tournament_participants
    set checked_in = true, checked_in_at = now()
    where id = p_participant_id;
end;
$$;

grant execute on function public.confirmar_asistencia(uuid) to authenticated;

-- Abrir el check-in es un simple UPDATE de tournaments, ya cubierto
-- por la política "tournaments_update_organizador" que existe desde
-- antes (solo el dueño del torneo puede actualizar su propia fila) --
-- no hace falta una función nueva para eso, el frontend lo hace
-- directo. Cerrar el check-in SÍ queda adentro de generar_llave() de
-- abajo (ver punto 3): si generar_llave() falla (por ejemplo, menos de
-- 2 confirmados), la excepción revierte TODO lo de la función,
-- incluido el intento de cerrar el check-in -- así el torneo no queda
-- en un estado raro a medio camino.

-- ------------------------------------------------------------
-- 3) generar_llave: ahora arma la ronda 1 solo con
--    checked_in = true, y cierra el check-in (check_in_abierto =
--    false) en el mismo UPDATE que pasa el torneo a en_curso -- todo
--    o nada, gracias a que un `raise exception` revierte la función
--    completa. El resto de la lógica (potencia de 2, byes al azar,
--    avanzar a los byes) es exactamente la misma que ya existía.
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
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 2 then
    raise exception 'Necesitas al menos 2 jugadores confirmados wn';
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

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false
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
