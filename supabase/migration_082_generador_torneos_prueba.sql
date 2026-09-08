-- ------------------------------------------------------------
-- Migración 082: generador de torneos de prueba, dentro del Panel de
-- pruebas de /admin -- reutiliza exactamente la misma infraestructura
-- que ya existía para Clan War (migración 053: crear_jugador_prueba_interno(),
-- teams.es_escenario_prueba, limpiar_escenarios_prueba()), no un
-- sistema aparte. Crea un torneo real (organizador = el propio dueño
-- de la plataforma) con N jugadores ficticios (1v1) o N clanes
-- ficticios ya armados con el mínimo de integrantes del formato
-- (2v2/3v3/4v4), todos inscritos y con el check-in ya confirmado --
-- listo para generar la llave/fixture de una sin tener que armar nada
-- a mano.
-- ------------------------------------------------------------

alter table public.tournaments
  add column es_torneo_prueba boolean not null default false;

create or replace function public.generar_torneo_prueba(
  p_nombre text,
  p_formato text,
  p_modo text,
  p_cantidad int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_nombre text;
  v_minimo int;
  v_i int;
  v_j int;
  v_owner_id uuid;
  v_team_id uuid;
  v_participant_id uuid;
  v_tag text;
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Esta herramienta es exclusiva del dueño de la plataforma.';
  end if;
  if p_formato not in ('1v1', '2v2', '3v3', '4v4') then
    raise exception 'Formato inválido.';
  end if;
  if p_cantidad < 2 then
    raise exception 'La cantidad tiene que ser al menos 2.';
  end if;

  v_nombre := coalesce(nullif(trim(p_nombre), ''), 'Torneo de prueba ' || to_char(now(), 'DD-MM HH24:MI'));

  insert into public.tournaments (
    nombre, formato, modo, publico, cupos_totales, fecha_inicio,
    creador_id, estado, es_torneo_prueba
  ) values (
    v_nombre, p_formato, p_modo, true, p_cantidad, now(),
    auth.uid(), 'abierto', true
  )
  returning id into v_tournament_id;

  if p_formato = '1v1' then
    for v_i in 1..p_cantidad loop
      v_owner_id := public.crear_jugador_prueba_interno('Ficticio' || v_i);

      insert into public.tournament_participants (tournament_id, user_id, checked_in, checked_in_at)
      values (v_tournament_id, v_owner_id, true, now())
      returning id into v_participant_id;

      perform public.registrar_actividad_participante(v_participant_id);
    end loop;
  else
    v_minimo := case p_formato when '2v2' then 2 when '3v3' then 3 when '4v4' then 4 end;

    for v_i in 1..p_cantidad loop
      -- El primer jugador ficticio del clan queda como dueño (necesario
      -- para poder inscribirlo e insertar tournament_participants con
      -- team_id) -- el resto se suma como jugador raso, igual que
      -- generar_escenario_prueba_lineup().
      v_owner_id := public.crear_jugador_prueba_interno('Clan' || v_i || 'Cap');

      -- teams.tag exige solo letras (^[A-Z]{3,6}$, sin dígitos) -- 4
      -- letras al azar, no un sufijo numérico como en el resto de la
      -- función.
      select string_agg(chr(65 + floor(random() * 26)::int), '')
      into v_tag
      from generate_series(1, 4);

      insert into public.teams (name, tag, sc2_regions, owner_id, es_escenario_prueba)
      values (
        'Clan de prueba ' || v_i,
        v_tag,
        array['america']::text[],
        v_owner_id,
        true
      )
      returning id into v_team_id;

      for v_j in 2..v_minimo loop
        insert into public.team_members (user_id, team_id, roles)
        values (public.crear_jugador_prueba_interno('Clan' || v_i || 'J' || v_j), v_team_id, array['jugador']::text[]);
      end loop;

      insert into public.tournament_participants (tournament_id, team_id, checked_in, checked_in_at)
      values (v_tournament_id, v_team_id, true, now())
      returning id into v_participant_id;

      perform public.registrar_actividad_participante(v_participant_id);
    end loop;
  end if;

  return jsonb_build_object('tournament_id', v_tournament_id, 'nombre', v_nombre);
end;
$$;

grant execute on function public.generar_torneo_prueba(text, text, text, int) to authenticated;

-- limpiar_escenarios_prueba() se extiende para borrar también los
-- torneos de prueba (y de paso las cuentas ficticias 1v1, que no
-- cuelgan de ningún equipo así que no las agarraba el barrido de
-- abajo). Los torneos se borran PRIMERO: tournament_participants.team_id
-- no tiene on delete cascade desde teams, así que si un torneo de
-- prueba con participantes-equipo sobreviviera, borrar el clan de
-- prueba fallaría por la FK -- borrando el torneo antes, el cascade de
-- tournament_id se lleva sus participantes solo.
create or replace function public.limpiar_escenarios_prueba()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_ids uuid[];
  v_user_ids uuid[];
  v_torneo_prueba_ids uuid[];
  v_torneo_user_ids uuid[];
  v_equipos_borrados int := 0;
  v_retos_borrados int := 0;
  v_cuentas_borradas int := 0;
  v_torneos_borrados int := 0;
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Esta herramienta es exclusiva del dueño de la plataforma.';
  end if;

  select array_agg(id) into v_torneo_prueba_ids from public.tournaments where es_torneo_prueba;

  if v_torneo_prueba_ids is not null then
    select array_agg(user_id) into v_torneo_user_ids
      from public.tournament_participants
      where tournament_id = any(v_torneo_prueba_ids) and user_id is not null;
  end if;

  with borrados as (
    delete from public.tournaments where es_torneo_prueba returning 1
  )
  select count(*) into v_torneos_borrados from borrados;

  select array_agg(id) into v_team_ids from public.teams where es_escenario_prueba;

  if v_team_ids is not null then
    select array_agg(user_id) into v_user_ids
      from public.team_members where team_id = any(v_team_ids);

    with borrados as (
      delete from public.clan_wars
      where challenger_team_id = any(v_team_ids) or challenged_team_id = any(v_team_ids)
      returning 1
    )
    select count(*) into v_retos_borrados from borrados;

    with borrados as (
      delete from public.teams where id = any(v_team_ids) returning 1
    )
    select count(*) into v_equipos_borrados from borrados;
  end if;

  v_user_ids := coalesce(v_user_ids, array[]::uuid[]) || coalesce(v_torneo_user_ids, array[]::uuid[]);

  if array_length(v_user_ids, 1) > 0 then
    with borrados as (
      delete from auth.users where id = any(v_user_ids) returning 1
    )
    select count(*) into v_cuentas_borradas from borrados;
  end if;

  return jsonb_build_object(
    'equipos', v_equipos_borrados, 'retos', v_retos_borrados,
    'cuentas', v_cuentas_borradas, 'torneos', v_torneos_borrados
  );
end;
$$;

grant execute on function public.limpiar_escenarios_prueba() to authenticated;
