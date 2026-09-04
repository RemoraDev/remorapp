-- ------------------------------------------------------------
-- Migración 053: Herramientas de prueba del dueño de la plataforma --
-- generador de escenarios de Clan War para probar la sala de lineup
-- sin tener que simular dos cuentas reales por separado.
--
-- Incluye, además, el primer privilegio real de observación del dueño
-- sobre Clan Wars ajenas (RLS): hasta ahora es_dueno_plataforma() no
-- tenía ningún efecto sobre clan_wars/clan_war_lineup/clan_war_wtl_sets
-- -- el acceso estaba limitado estrictamente al dueño o capitán de
-- alguno de los dos equipos (es_capitan_o_dueno(), que se refiere al
-- dueño DEL EQUIPO, no al dueño de la plataforma -- son conceptos
-- distintos pese al nombre parecido). Este privilegio de observación
-- es nuevo: no existía ningún mecanismo de "invisibilidad" previo en
-- el código para esto.
-- ------------------------------------------------------------

alter table public.teams
  add column es_escenario_prueba boolean not null default false;

-- Las políticas de select de clan_wars/clan_war_lineup/clan_war_wtl_sets
-- no se pueden "reemplazar" in place -- hay que borrarlas y crearlas
-- de nuevo con la condición agregada.
drop policy if exists "clan_wars_select_propio" on public.clan_wars;

create policy "clan_wars_select_propio"
  on public.clan_wars for select
  to authenticated
  using (
    public.es_capitan_o_dueno(challenger_team_id)
    or public.es_capitan_o_dueno(challenged_team_id)
    or public.es_dueno_plataforma()
  );

drop policy if exists "clan_war_lineup_select_propio" on public.clan_war_lineup;

create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (
          public.es_capitan_o_dueno(cw.challenger_team_id)
          or public.es_capitan_o_dueno(cw.challenged_team_id)
          or public.es_dueno_plataforma()
        )
    )
  );

drop policy if exists "clan_war_wtl_sets_select_propio" on public.clan_war_wtl_sets;

create policy "clan_war_wtl_sets_select_propio"
  on public.clan_war_wtl_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (
          public.es_capitan_o_dueno(cw.challenger_team_id)
          or public.es_capitan_o_dueno(cw.challenged_team_id)
          or public.es_dueno_plataforma()
        )
    )
  );

-- Helper interno (sin grant a authenticated -- solo lo llaman las dos
-- funciones de más abajo): crea una cuenta ficticia mínima, directo en
-- auth.users, sin pasar por el flujo normal de signUp(). No hace falta
-- que sea una cuenta que de verdad pueda iniciar sesión -- el dueño
-- solo la va a OBSERVAR, nunca necesita loguearse como ella -- así que
-- encrypted_password queda con un valor que a propósito no es un hash
-- válido (ningún intento de login real puede prosperar contra esta
-- cuenta). Como nunca se llama a la API de signUp de verdad, tampoco
-- se dispara ningún correo de confirmación -- el dominio @mailinator.com
-- se mantiene igual por prolijidad y por la regla ya establecida, pero
-- acá no hace falta que la casilla exista de verdad.
create or replace function public.crear_jugador_prueba_interno(p_nick text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_email text := 'remorapp.prueba.' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || '@mailinator.com';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, 'no-login-' || md5(random()::text || clock_timestamp()::text),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  );

  -- El trigger on_auth_user_created ya creó la fila en profiles (con
  -- nick null) -- acá se completa con datos identificables.
  update public.profiles
    set nick = p_nick, country = 'chile', sc2_region = 'america',
        sc2_id = substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    where id = v_user_id;

  return v_user_id;
end;
$$;

-- Genera 2 equipos de prueba ("Prueba Equipo A"/"Prueba Equipo B", tag
-- PRUEA/PRUEB, 4 jugadores ficticios cada uno), un reto de Clan War
-- entre ambos ya en estado 'aceptada' (equivalente a proponerlo y
-- aceptarlo, sin pasar por las dos cuentas por separado), con
-- fecha_hora_cet 10 minutos en el futuro -- la ventana de check-in
-- (15 minutos antes de esa hora) queda abierta de inmediato.
create or replace function public.generar_escenario_prueba_lineup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_a uuid;
  v_owner_b uuid;
  v_uid uuid;
  v_team_a_id uuid;
  v_team_b_id uuid;
  v_clan_war_id uuid;
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Esta herramienta es exclusiva del dueño de la plataforma.';
  end if;

  v_owner_a := public.crear_jugador_prueba_interno('PruebaA1');
  insert into public.teams (name, tag, sc2_regions, owner_id, es_escenario_prueba)
  values ('Prueba Equipo A', 'PRUEA', array['america']::text[], v_owner_a, true)
  returning id into v_team_a_id;

  v_uid := public.crear_jugador_prueba_interno('PruebaA2');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_a_id, array['jugador']::text[]);
  v_uid := public.crear_jugador_prueba_interno('PruebaA3');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_a_id, array['jugador']::text[]);
  v_uid := public.crear_jugador_prueba_interno('PruebaA4');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_a_id, array['jugador']::text[]);

  v_owner_b := public.crear_jugador_prueba_interno('PruebaB1');
  insert into public.teams (name, tag, sc2_regions, owner_id, es_escenario_prueba)
  values ('Prueba Equipo B', 'PRUEB', array['america']::text[], v_owner_b, true)
  returning id into v_team_b_id;

  v_uid := public.crear_jugador_prueba_interno('PruebaB2');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_b_id, array['jugador']::text[]);
  v_uid := public.crear_jugador_prueba_interno('PruebaB3');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_b_id, array['jugador']::text[]);
  v_uid := public.crear_jugador_prueba_interno('PruebaB4');
  insert into public.team_members (user_id, team_id, roles) values (v_uid, v_team_b_id, array['jugador']::text[]);

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet, status, formato)
  values (v_team_a_id, v_team_b_id, now() + interval '10 minutes', 'aceptada', 'simple')
  returning id into v_clan_war_id;

  return jsonb_build_object(
    'team_a_id', v_team_a_id, 'team_a_tag', 'PRUEA',
    'team_b_id', v_team_b_id, 'team_b_tag', 'PRUEB',
    'clan_war_id', v_clan_war_id
  );
end;
$$;

grant execute on function public.generar_escenario_prueba_lineup() to authenticated;

-- Borra todo lo que haya generado la herramienta de arriba --
-- identificado por teams.es_escenario_prueba, no por nombre (más
-- confiable). Orden importa: primero los retos (clan_wars no tiene
-- on delete cascade desde teams), después los equipos (que si arrastra
-- en cascada a team_members), y al final las cuentas ficticias mismas
-- (que arrastra en cascada a profiles) -- así no queda ninguna cuenta
-- de prueba acumulándose de una corrida a la siguiente.
create or replace function public.limpiar_escenarios_prueba()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_ids uuid[];
  v_user_ids uuid[];
  v_equipos_borrados int := 0;
  v_retos_borrados int := 0;
  v_cuentas_borradas int := 0;
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Esta herramienta es exclusiva del dueño de la plataforma.';
  end if;

  select array_agg(id) into v_team_ids from public.teams where es_escenario_prueba;

  if v_team_ids is null then
    return jsonb_build_object('equipos', 0, 'retos', 0, 'cuentas', 0);
  end if;

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

  if v_user_ids is not null then
    with borrados as (
      delete from auth.users where id = any(v_user_ids) returning 1
    )
    select count(*) into v_cuentas_borradas from borrados;
  end if;

  return jsonb_build_object('equipos', v_equipos_borrados, 'retos', v_retos_borrados, 'cuentas', v_cuentas_borradas);
end;
$$;

grant execute on function public.limpiar_escenarios_prueba() to authenticated;
