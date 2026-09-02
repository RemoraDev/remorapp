-- ============================================================
-- RemorApp — Esquema del gestor de torneos
--
-- Cómo correrlo: Supabase Dashboard -> tu proyecto -> SQL Editor
-- -> New query -> pegar todo este archivo -> Run. Se ejecuta una
-- sola vez sobre un proyecto nuevo (no es una migración
-- reversible ni pensada para correrse dos veces).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- profiles: espejo de auth.users con los datos propios de
-- RemorApp (nombre, tipo de perfil y si es administrador).
-- Se llena sola con el trigger de más abajo cada vez que
-- alguien se registra en /register.
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  -- Nadie lo elige a mano (migración 011): 'jugador' por defecto,
  -- pasa solo a 'lider_clan' al crear un equipo (ver
  -- crear_membresia_owner() más abajo). 'caster' no es un valor de
  -- perfil_tipo -- es la columna es_caster, independiente y no
  -- excluyente (se puede ser líder de clan y caster a la vez).
  perfil_tipo text not null default 'jugador' check (perfil_tipo in ('jugador', 'lider_clan')),
  es_caster boolean not null default false,
  es_admin boolean not null default false,
  -- Privilegio del dueño de la plataforma (migración 016) -- distinto
  -- de es_admin, para UNA sola cuenta, invisible incluso para otros
  -- admins (ver el revoke más abajo). Protegido por el mismo
  -- mecanismo que es_admin: solo se activa a mano en el SQL Editor.
  es_dueno_plataforma boolean not null default false,
  -- Identidad de jugador (Fase 1 del módulo de Equipos/Clanes). Todo
  -- nullable salvo unique_id: se completa en el gate de /perfil, no
  -- al registrarse.
  nick text check (nick is null or nick ~ '^[A-Za-z0-9_Øø]{3,13}$'),
  unique_id text not null unique,
  -- country: país del jugador (no el servidor de juego).
  country text check (country is null or country in ('chile', 'guatemala', 'puerto_rico', 'argentina', 'peru', 'bolivia')),
  -- sc2_region: servidor real de StarCraft II, elegido libremente
  -- por el jugador (no se detecta por IP).
  sc2_region text check (sc2_region is null or sc2_region in ('america', 'europe', 'asia')),
  sc2_id text,
  -- Rango competitivo, opcional -- se muestra junto al Nick#ID en la
  -- lista de miembros de un equipo.
  liga text check (liga is null or liga in (
    'Bronce 3', 'Bronce 2', 'Bronce 1',
    'Plata 3', 'Plata 2', 'Plata 1',
    'Oro 3', 'Oro 2', 'Oro 1',
    'Platino 3', 'Platino 2', 'Platino 1',
    'Diamante 3', 'Diamante 2', 'Diamante 1',
    'Master 3', 'Master 2', 'Master 1',
    'Gran Maestro'
  )),
  avatar_url text,
  bio text,
  -- Se recalcula sola (ver trigger actualizar_cuenta_validada): la
  -- app nunca la setea a mano, alcanza con guardar nick/country/
  -- sc2_region/sc2_id.
  cuenta_validada boolean not null default false,
  -- Panel de administración: cuenta suspendida por staff.
  suspendido boolean not null default false,
  -- No vive en auth.users por comodidad de consulta: se usa en
  -- /admin. Ver el revoke más abajo -- no es pública como el resto
  -- de esta tabla.
  email text,
  creado_en timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cualquiera puede leer perfiles (nick, tipo, si es admin, etc.);
-- no hay datos sensibles ahí, EXCEPTO email, al que se le saca el
-- permiso de columna más abajo (revoke), independiente de esta
-- política -- así nadie puede leerlo salvo admin_listar_usuarios().
create policy "profiles_select_publico"
  on public.profiles for select
  using (true);

-- El revoke de columna para email y es_dueno_plataforma NO va acá --
-- ver la explicación larga junto al grant de más abajo (migración
-- 017): un revoke de columna antes de un grant de tabla completa no
-- sirve de nada, hay que hacerlo al revés.

-- Cada usuario puede editar su propia fila (nombre, país, sc2_id,
-- etc., elegido en /perfil). es_admin queda protegido aparte por el
-- trigger de abajo: sigue activándose solo a mano en este editor.
-- perfil_tipo NO se edita acá pese a que esta política deja tocar
-- cualquier columna de la fila propia: el grant de columna sobre
-- perfil_tipo no existe para nadie (ver más abajo), así que Postgres
-- rechaza cualquier intento de escribirlo aunque la política de fila
-- lo permita -- la única puerta es admin_cambiar_perfil_tipo().
create policy "profiles_update_propio"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- current_setting('request.jwt.claims', true) solo existe cuando la
-- consulta llega a través de la API de Supabase (con sesión anon o
-- authenticated); es null cuando se corre directo en el SQL Editor.
-- Así, este trigger bloquea cambios a es_admin que vengan de la app,
-- pero no interfiere con activarlo a mano.
-- Migración 016: además de es_admin, protege es_dueno_plataforma con
-- el mismo mecanismo, y bloquea que se suspenda/banee desde la app a
-- la fila que ya tiene es_dueno_plataforma = true -- ni siquiera otro
-- administrador puede hacerlo por acá.
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;

    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    end if;
  end if;
  return new;
end;
$$;

create trigger before_update_profiles_proteger_admin
  before update on public.profiles
  for each row execute function public.proteger_es_admin();

-- cuenta_validada se recalcula sola en cada insert/update, a partir
-- de si nick, country, sc2_region y sc2_id están completos.
create or replace function public.actualizar_cuenta_validada()
returns trigger
language plpgsql
as $$
begin
  new.cuenta_validada := (
    new.nick is not null
    and new.country is not null
    and new.sc2_region is not null
    and new.sc2_id is not null
  );
  return new;
end;
$$;

create trigger before_upsert_profiles_validar_cuenta
  before insert or update on public.profiles
  for each row execute function public.actualizar_cuenta_validada();

-- unique_id es inmutable: una vez asignado, ningún UPDATE puede
-- volver a generarlo o cambiarlo.
create or replace function public.proteger_unique_id()
returns trigger
language plpgsql
as $$
begin
  if old.unique_id is not null then
    new.unique_id := old.unique_id;
  end if;
  return new;
end;
$$;

create trigger before_update_profiles_proteger_unique_id
  before update on public.profiles
  for each row execute function public.proteger_unique_id();

-- Genera un unique_id de 5 dígitos (10000-99999) que no se repita
-- con ninguno ya asignado. nick queda null: se completa recién en
-- el gate de /perfil, no al registrarse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_id text;
begin
  loop
    v_unique_id := (floor(random() * 90000) + 10000)::int::text;
    exit when not exists (select 1 from public.profiles where unique_id = v_unique_id);
  end loop;

  -- perfil_tipo no se manda: nadie lo elige a mano en /register, el
  -- default de la columna ('jugador') se encarga solo.
  insert into public.profiles (id, nombre, unique_id, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    v_unique_id,
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Función auxiliar reutilizada por las políticas de abajo:
-- ¿el usuario que hace la consulta es administrador?
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select es_admin from public.profiles where id = auth.uid()), false);
$$;

-- Un admin puede actualizar el perfil de cualquiera (cambiar
-- perfil_tipo, suspender, desde /admin). es_admin y unique_id
-- siguen protegidos por sus propios triggers: esta política no los
-- toca, sigue sin poder cambiarlos desde la app aunque seas admin.
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ¿el usuario que hace la consulta está suspendido? Se usa para
-- bloquear crear torneos / inscribirse más abajo.
create or replace function public.esta_suspendido()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select suspendido from public.profiles where id = auth.uid()), false);
$$;

-- Listado de /admin (pestaña Usuarios): junta todo lo que hace
-- falta, incluido email, y verifica que quien llama sea admin ANTES
-- de devolver nada. Como es security definer, puede leer email
-- aunque el rol que llama no tenga permiso de columna sobre eso.
create or replace function public.admin_listar_usuarios()
returns table (
  id uuid,
  nick text,
  unique_id text,
  email text,
  country text,
  perfil_tipo text,
  cuenta_validada boolean,
  suspendido boolean,
  es_admin boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado: se requiere ser administrador.';
  end if;

  return query
    select p.id, p.nick, p.unique_id, p.email, p.country, p.perfil_tipo,
           p.cuenta_validada, p.suspendido, p.es_admin
    from public.profiles p
    order by p.creado_en desc;
end;
$$;

grant execute on function public.admin_listar_usuarios() to authenticated;

-- Único camino para cambiar perfil_tipo de otro usuario: perfil_tipo
-- no tiene grant de columna para nadie (ver más arriba), así que la
-- única forma de tocarlo es esta función, security definer, que
-- verifica is_admin() antes de escribir nada.
create or replace function public.admin_cambiar_perfil_tipo(p_usuario_id uuid, p_nuevo_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar el rol de un usuario.';
  end if;

  if p_nuevo_rol not in ('jugador', 'lider_clan') then
    raise exception 'Ese rol no es válido.';
  end if;

  update public.profiles set perfil_tipo = p_nuevo_rol where id = p_usuario_id;
end;
$$;

grant execute on function public.admin_cambiar_perfil_tipo(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- maps: catálogo de mapas de StarCraft II (ficticios, de
-- ejemplo). Cada torneo elige un subconjunto en tournament_maps.
-- ------------------------------------------------------------
create table public.maps (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

alter table public.maps enable row level security;

create policy "maps_select_publico"
  on public.maps for select
  using (true);

insert into public.maps (nombre) values
  ('Vórtice de Cristal'),
  ('Bastión de Hierro'),
  ('Cañón Estelar'),
  ('Puente del Ocaso'),
  ('Dunas Carmesí'),
  ('Fortaleza Glacial');

-- ------------------------------------------------------------
-- tournaments: el torneo en sí.
-- ------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  juego text not null default 'StarCraft II',
  formato text not null check (formato in ('1v1', '2v2', '3v3', '4v4')),
  modo text not null check (
    modo in ('eliminacion_simple', 'eliminacion_doble', 'todos_contra_todos', 'rey_de_la_colina')
  ),
  publico boolean not null default true,
  -- El pozo de premios solo tiene sentido en torneos públicos.
  pozo_premio numeric(12, 2) check (publico = true or pozo_premio is null),
  cupos_totales integer not null check (cupos_totales > 0),
  cupos_ocupados integer not null default 0
    check (cupos_ocupados >= 0 and cupos_ocupados <= cupos_totales),
  fecha_inicio timestamptz not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'en_curso', 'finalizado')),
  creador_id uuid not null references auth.users (id),
  confirmado_por_staff boolean not null default false,
  -- Check-in antes de generar la llave (migración 010): mientras está
  -- en true, los inscritos pueden confirmar que van a jugar.
  check_in_abierto boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.tournaments enable row level security;

-- Cualquiera puede leer un torneo por id exacto — incluidos los
-- privados: es el modelo de "solo con el link directo" que
-- eligió el usuario. El listado público filtra publico = true
-- desde el query del frontend, no acá.
create policy "tournaments_select_publico"
  on public.tournaments for select
  using (true);

-- Una cuenta suspendida no puede crear torneos: bloqueado acá, a
-- nivel de base de datos, no solo escondiendo el botón en la app.
create policy "tournaments_insert_propio"
  on public.tournaments for insert
  to authenticated
  with check (creador_id = auth.uid() and not public.esta_suspendido());

create policy "tournaments_update_organizador"
  on public.tournaments for update
  to authenticated
  using (creador_id = auth.uid())
  with check (creador_id = auth.uid());

-- El staff (es_admin) puede actualizar cualquier torneo; hoy
-- solo se usa desde la UI para marcar confirmado_por_staff.
create policy "tournaments_update_admin"
  on public.tournaments for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- tournament_maps: mapas elegidos para un torneo y si se
-- pueden vetar. El veto real entre jugadores durante el
-- torneo es una función futura; el campo "vetado" ya queda
-- listo para usarse cuando se construya.
-- ------------------------------------------------------------
create table public.tournament_maps (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  map_id uuid not null references public.maps (id),
  es_veteable boolean not null default true,
  vetado boolean not null default false,
  unique (tournament_id, map_id)
);

alter table public.tournament_maps enable row level security;

create policy "tournament_maps_select_publico"
  on public.tournament_maps for select
  using (true);

create policy "tournament_maps_insert_organizador"
  on public.tournament_maps for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.creador_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- tournament_participants: quién se inscribió a qué torneo.
-- ------------------------------------------------------------
create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  -- Nullable a propósito (migración 009): un torneo por equipo
  -- inscribe un team_id acá en vez de un user_id -- ver el ALTER TABLE
  -- y el check constraint más abajo (sección "Torneos por equipo"),
  -- que agrega team_id recién después de que exista la tabla teams.
  user_id uuid references auth.users (id),
  inscrito_en timestamptz not null default now(),
  -- Check-in antes de generar la llave (migración 010).
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  unique (tournament_id, user_id)
);

alter table public.tournament_participants enable row level security;

create policy "tournament_participants_select_publico"
  on public.tournament_participants for select
  using (true);

-- Una cuenta suspendida no puede inscribirse a torneos: mismo
-- bloqueo a nivel de base de datos que en tournaments_insert_propio.
create policy "tournament_participants_insert_propio"
  on public.tournament_participants for insert
  to authenticated
  with check (user_id = auth.uid() and not public.esta_suspendido());

-- Antes de inscribir valida que haya cupo y que el torneo siga
-- abierto (esto no se puede expresar solo con RLS). "for update"
-- bloquea la fila del torneo para evitar que dos inscripciones
-- simultáneas se pasen del cupo.
create or replace function public.validar_inscripcion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_ocupados integer;
  v_totales integer;
begin
  select estado, cupos_ocupados, cupos_totales
    into v_estado, v_ocupados, v_totales
    from public.tournaments
    where id = new.tournament_id
    for update;

  if v_estado is null then
    raise exception 'El torneo no existe.';
  end if;

  if v_estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;

  if v_ocupados >= v_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;

  return new;
end;
$$;

create trigger before_insert_participant
  before insert on public.tournament_participants
  for each row execute function public.validar_inscripcion();

-- Después de inscribir, suma un cupo ocupado en el torneo.
create or replace function public.incrementar_cupos_ocupados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tournaments
     set cupos_ocupados = cupos_ocupados + 1
   where id = new.tournament_id;
  return new;
end;
$$;

create trigger after_insert_participant
  after insert on public.tournament_participants
  for each row execute function public.incrementar_cupos_ocupados();

-- Simétrico al de arriba (migración 019): cuando abandonar_torneo()
-- borra un participante de un torneo todavía 'abierto', el cupo se
-- libera solo.
create or replace function public.decrementar_cupos_ocupados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tournaments
     set cupos_ocupados = cupos_ocupados - 1
   where id = old.tournament_id;
  return old;
end;
$$;

create trigger after_delete_participant
  after delete on public.tournament_participants
  for each row execute function public.decrementar_cupos_ocupados();

-- Registro de actividad para la restauración de banca rota (migración
-- 020, sistema de MMR): inscribirse, confirmar asistencia, o jugar
-- una partida real cuentan como actividad. Referencia team_members,
-- que recién se define más abajo en este archivo -- no es un
-- problema, plpgsql no valida el cuerpo contra el esquema hasta que
-- se ejecuta (mismo caso que generar_llave() llamando a
-- avanzar_ganador() antes de que exista en el archivo).
create or replace function public.registrar_actividad_participante(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
begin
  select user_id, team_id into v_participante
  from public.tournament_participants
  where id = p_participant_id;

  if v_participante.user_id is not null then
    update public.profiles set ultima_actividad = now() where id = v_participante.user_id;
  elsif v_participante.team_id is not null then
    update public.teams set ultima_actividad = now() where id = v_participante.team_id;
    update public.profiles set ultima_actividad = now()
      where id in (select user_id from public.team_members where team_id = v_participante.team_id);
  end if;
end;
$$;

create or replace function public.registrar_actividad_tras_inscripcion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.registrar_actividad_participante(new.id);
  return new;
end;
$$;

create trigger after_insert_participant_actividad
  after insert on public.tournament_participants
  for each row execute function public.registrar_actividad_tras_inscripcion();

-- ------------------------------------------------------------
-- tournament_results: resultado por partida.
-- ------------------------------------------------------------
create table public.tournament_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  participant_id uuid not null references public.tournament_participants (id) on delete cascade,
  gano boolean not null default false,
  -- Solo aplica cuando tournaments.modo = 'rey_de_la_colina'.
  puntaje integer,
  creado_en timestamptz not null default now()
);

alter table public.tournament_results enable row level security;

create policy "tournament_results_select_publico"
  on public.tournament_results for select
  using (true);

create policy "tournament_results_insert_organizador"
  on public.tournament_results for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.creador_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- organizer_points: puntos que gana el organizador cuando su
-- torneo público, con 20+ participantes, es confirmado por
-- staff. Todavía no está conectado al Plan Pro: por ahora solo
-- se registra acá para usarlo más adelante (sin nada visual).
-- ------------------------------------------------------------
create table public.organizer_points (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  organizador_id uuid not null references auth.users (id),
  -- Valor fijo de referencia: falta definir la fórmula final de
  -- puntos cuando se diseñe el Plan Pro.
  puntos integer not null default 100,
  creado_en timestamptz not null default now(),
  unique (tournament_id)
);

alter table public.organizer_points enable row level security;

create policy "organizer_points_select_propio_o_admin"
  on public.organizer_points for select
  to authenticated
  using (organizador_id = auth.uid() or public.is_admin());

-- Se genera solo cuando el staff marca confirmado_por_staff en
-- un torneo público con 20+ inscritos. No hay policy de insert
-- para authenticated/anon: la única puerta de entrada es este
-- trigger (corre como security definer).
create or replace function public.generar_puntos_organizador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmado_por_staff = true
     and old.confirmado_por_staff = false
     and new.publico = true
     and new.cupos_ocupados >= 20
  then
    insert into public.organizer_points (tournament_id, organizador_id)
    values (new.id, new.creador_id)
    on conflict (tournament_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger after_update_confirmacion_staff
  after update of confirmado_por_staff on public.tournaments
  for each row execute function public.generar_puntos_organizador();

-- ------------------------------------------------------------
-- Privilegios base sobre las tablas.
--
-- Activar RLS y crear políticas no alcanza: en Postgres, antes
-- de evaluar cualquier política, el rol que hace la consulta
-- (anon o authenticated) necesita el permiso base sobre la
-- tabla (GRANT). Las políticas de arriba siguen filtrando qué
-- filas se ven/escriben; esto solo abre la puerta para que se
-- lleguen a evaluar.
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- profiles: SELECT y UPDATE solo por lista explícita de columnas, NO
-- "toda la tabla y después revoco una columna" -- ese patrón no
-- funciona en Postgres (un revoke de columna no recorta un grant de
-- tabla completa, son entradas independientes). Ver la explicación
-- larga en la migración 017.
-- mmr_1v1/mmr_equipos y sus columnas derivadas (migración 020)
-- reemplazan a xp/nivel -- ultima_actividad queda afuera a propósito,
-- es de uso interno nada más (restauración de banca rota).
grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos
) on public.profiles to anon, authenticated;

-- suspendido queda acá porque un admin necesita poder tocarlo desde
-- /admin -- pero como un admin también corre como "authenticated",
-- igual que cualquier usuario, un grant de columna no alcanza para
-- distinguir "admin suspendiendo a otro" de "usuario reactivándose a
-- sí mismo". Eso lo bloquea proteger_es_admin() (ver más arriba), que
-- exige is_admin() para poder cambiar suspendido.
--
-- perfil_tipo NO va en esta lista (a diferencia de suspendido): no
-- hay forma de que un grant de columna distinga "admin cambiando el
-- rol de otro" de "usuario cambiándose el suyo propio" -- y a
-- diferencia de suspendido, acá no alcanza con un trigger (el cambio
-- de perfil_tipo también tiene que validar que el nuevo valor sea
-- válido). Por eso queda totalmente afuera de este grant -- ni
-- siquiera un admin puede tocarlo con un update directo -- y la única
-- puerta es admin_cambiar_perfil_tipo() (ver más abajo, junto a
-- admin_listar_usuarios()), security definer, exige is_admin().
grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, suspendido
) on public.profiles to authenticated;

grant select on public.maps to anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant insert, update on public.tournaments to authenticated;

grant select on public.tournament_maps to anon, authenticated;
grant insert on public.tournament_maps to authenticated;

grant select on public.tournament_participants to anon, authenticated;
grant insert on public.tournament_participants to authenticated;

grant select on public.tournament_results to anon, authenticated;
grant insert on public.tournament_results to authenticated;

-- organizer_points no lleva grant de insert para nadie: la única
-- forma de escribir ahí es el trigger generar_puntos_organizador,
-- que corre como security definer y no necesita este permiso.
grant select on public.organizer_points to authenticated;

-- ------------------------------------------------------------
-- Equipos (Fase 2 del módulo de Equipos/Clanes).
-- ------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 20),
  tag text not null check (tag ~ '^[A-Z]{3,6}$'),
  sc2_regions text[] not null check (
    cardinality(sc2_regions) >= 1
    and sc2_regions <@ array['america', 'europe', 'asia']::text[]
  ),
  description text,
  logo_url text,
  banner_url text,
  is_public boolean not null default true,
  invite_code text unique,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Migración 019: cuando el dueño es el único miembro y sale del
  -- equipo, en vez de borrar la fila (dejaría huérfano el historial de
  -- team_kicks_log, los torneos en los que participó, etc.) queda
  -- marcado disuelto y deja de aparecer en el buscador público
  -- (filtrado en el frontend).
  disuelto boolean not null default false
);

alter table public.teams enable row level security;

create policy "teams_select_publico"
  on public.teams for select
  using (true);

create or replace function public.cuenta_esta_validada()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select cuenta_validada from public.profiles where id = auth.uid()), false);
$$;

create policy "teams_insert_propio"
  on public.teams for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and public.cuenta_esta_validada()
    and not public.esta_suspendido()
  );

create or replace function public.generar_invite_code()
returns trigger
language plpgsql
as $$
declare
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i int;
begin
  if new.invite_code is not null then
    return new;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.teams where invite_code = v_code);
  end loop;

  new.invite_code := v_code;
  return new;
end;
$$;

create trigger before_insert_teams_invite_code
  before insert on public.teams
  for each row execute function public.generar_invite_code();

-- El tag es único POR SERVIDOR (intersección real de sc2_regions), no
-- en general: ver la explicación larga en migration_005_teams.sql.
create or replace function public.validar_tag_unico_por_servidor()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.teams t
    where t.tag = new.tag
      and t.id is distinct from new.id
      and t.sc2_regions && new.sc2_regions
  ) then
    raise exception 'Ese tag ya está en uso en uno de esos servidores. Intenta con otro.';
  end if;

  return new;
end;
$$;

create trigger before_upsert_teams_validar_tag
  before insert or update of tag, sc2_regions on public.teams
  for each row execute function public.validar_tag_unico_por_servidor();

-- user_id es la PRIMARY KEY: "un jugador pertenece a un solo equipo"
-- queda garantizado por el esquema, no por una regla saltable.
create table public.team_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  roles text[] not null default array['jugador']::text[] check (
    roles <@ array['owner', 'jugador']::text[]
  ),
  joined_at timestamptz not null default now()
);

alter table public.team_members enable row level security;

create policy "team_members_select_publico"
  on public.team_members for select
  using (true);

create policy "team_members_insert_propio"
  on public.team_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and roles = array['jugador']::text[]
    and not public.esta_suspendido()
    -- Migración 019: un equipo disuelto no puede sumar gente de vuelta
    -- por esta vía (código de invitación), aunque siga existiendo la
    -- fila en teams.
    and exists (select 1 from public.teams t where t.id = team_id and not t.disuelto)
  );

create or replace function public.crear_membresia_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, roles)
  values (new.id, new.owner_id, array['owner']::text[]);

  -- Crear un equipo te vuelve líder de clan automáticamente (migración
  -- 011) -- nadie elige perfil_tipo a mano. No toca es_caster: son
  -- independientes, se puede ser líder de clan y caster a la vez.
  update public.profiles set perfil_tipo = 'lider_clan' where id = new.owner_id;

  return new;
end;
$$;

create trigger after_insert_teams_owner
  after insert on public.teams
  for each row execute function public.crear_membresia_owner();

grant select on public.teams to anon, authenticated;
grant insert on public.teams to authenticated;

grant select on public.team_members to anon, authenticated;
grant insert on public.team_members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-logos',
  'team-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "team_logos_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'team-logos');

create policy "team_logos_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------
-- Fotos de perfil, banners de equipo y panel de líder (migración
-- 007). El dueño puede editar su equipo (menos name/tag, protegidos
-- por trigger), y sacar miembros solo por la RPC quitar_miembro()
-- -- sin política DELETE en team_members, mismo patrón que
-- reportar_resultado() más abajo.
-- ------------------------------------------------------------
create policy "teams_update_propio"
  on public.teams for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Lista explícita de columnas, no toda la tabla: excluye mmr (mismo
-- criterio que xp antes, ver migración 017 -- ninguna función
-- legítima necesita escribirlo desde acá, cualquier ajuste futuro de
-- MMR pasará por una función propia) y name/tag (ya protegidos por su
-- propio trigger de abajo, pero afuera de la lista de todas formas).
grant update (description, logo_url, banner_url) on public.teams to authenticated;

create or replace function public.proteger_nombre_y_tag_equipo()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name or new.tag is distinct from old.tag then
    raise exception 'El nombre y el tag del equipo no se pueden cambiar por ahora.';
  end if;
  return new;
end;
$$;

create trigger before_update_teams_proteger_nombre_tag
  before update on public.teams
  for each row execute function public.proteger_nombre_y_tag_equipo();

-- ------------------------------------------------------------
-- Invitaciones reales a equipo + historial de expulsados
-- (migración 012), dentro del Panel de control.
-- ------------------------------------------------------------
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  invited_user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now()
);

-- Mientras una invitación de ESTE equipo a ESTE jugador siga
-- pendiente, no se puede mandar otra -- pero sí se puede volver a
-- invitar más adelante si la rechazó o si en algún momento dejó el
-- equipo (el índice único es solo sobre las pendientes).
create unique index team_invitations_pendiente_unica
  on public.team_invitations (team_id, invited_user_id)
  where (status = 'pendiente');

alter table public.team_invitations enable row level security;

create policy "team_invitations_select"
  on public.team_invitations for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or exists (
      select 1 from public.teams t
      where t.id = team_id and t.owner_id = auth.uid()
    )
  );

grant select on public.team_invitations to authenticated;

create table public.team_kicks_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  kicked_by uuid not null references public.profiles (id),
  kicked_at timestamptz not null default now(),
  -- Migración 019: distingue si la salida la inició el líder
  -- (quitar_miembro) o el propio jugador (salir_equipo) -- mismo
  -- kicked_by en los dos casos cuando es el propio jugador (uno se
  -- "expulsa a sí mismo" en los datos), pero el motivo deja clara la
  -- diferencia al mirar el historial.
  motivo text not null default 'expulsado' check (motivo in ('expulsado', 'renuncia'))
);

alter table public.team_kicks_log enable row level security;

create policy "team_kicks_log_select_propio"
  on public.team_kicks_log for select
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = team_id and t.owner_id = auth.uid()
    )
  );

grant select on public.team_kicks_log to authenticated;

create or replace function public.invitar_jugador(p_team_id uuid, p_invited_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_owner boolean;
begin
  -- Migración 019: "not disuelto" acá también bloquea que un ex-dueño
  -- reviva un equipo disuelto invitando gente de nuevo -- owner_id no
  -- cambia solo porque el equipo se disolvió.
  select exists (
    select 1 from public.teams where id = p_team_id and owner_id = auth.uid() and not disuelto
  ) into v_es_owner;

  if not v_es_owner then
    raise exception 'Solo el dueño del equipo puede invitar jugadores.';
  end if;

  if not exists (select 1 from public.profiles where id = p_invited_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  if exists (select 1 from public.team_members where user_id = p_invited_user_id) then
    raise exception 'Ese jugador ya pertenece a un equipo.';
  end if;

  if exists (
    select 1 from public.team_invitations
    where team_id = p_team_id and invited_user_id = p_invited_user_id and status = 'pendiente'
  ) then
    raise exception 'Ya le mandaste una invitación a ese jugador, todavía está pendiente.';
  end if;

  insert into public.team_invitations (team_id, invited_user_id, invited_by)
  values (p_team_id, p_invited_user_id, auth.uid());
end;
$$;

grant execute on function public.invitar_jugador(uuid, uuid) to authenticated;

create or replace function public.aceptar_invitacion(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
  v_disuelto boolean;
begin
  select * into v_invitacion from public.team_invitations where id = p_invitation_id for update;

  if v_invitacion is null then
    raise exception 'Esa invitación no existe.';
  end if;
  if v_invitacion.invited_user_id <> auth.uid() then
    raise exception 'Esta invitación no es tuya.';
  end if;
  if v_invitacion.status <> 'pendiente' then
    raise exception 'Esta invitación ya no está pendiente.';
  end if;
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  -- Migración 019: cubre una invitación que quedó pendiente de antes
  -- de que el equipo se disolviera.
  select disuelto into v_disuelto from public.teams where id = v_invitacion.team_id;
  if v_disuelto then
    raise exception 'Ese equipo ya no existe.';
  end if;

  insert into public.team_members (team_id, user_id, roles)
  values (v_invitacion.team_id, auth.uid(), array['jugador']::text[]);

  update public.team_invitations set status = 'aceptada' where id = p_invitation_id;
end;
$$;

grant execute on function public.aceptar_invitacion(uuid) to authenticated;

create or replace function public.rechazar_invitacion(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
begin
  select * into v_invitacion from public.team_invitations where id = p_invitation_id for update;

  if v_invitacion is null then
    raise exception 'Esa invitación no existe.';
  end if;
  if v_invitacion.invited_user_id <> auth.uid() then
    raise exception 'Esta invitación no es tuya.';
  end if;
  if v_invitacion.status <> 'pendiente' then
    raise exception 'Esta invitación ya no está pendiente.';
  end if;

  update public.team_invitations set status = 'rechazada' where id = p_invitation_id;
end;
$$;

grant execute on function public.rechazar_invitacion(uuid) to authenticated;

-- quitar_miembro: además de sacar al jugador, deja registro en
-- team_kicks_log antes de borrar la fila.
create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
  values (p_team_id, p_user_id, auth.uid(), 'expulsado');

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.quitar_miembro(uuid, uuid) to authenticated;

-- salir_equipo() (migración 019): la contraparte de quitar_miembro(),
-- iniciada por el propio jugador. Un miembro común sale sin más
-- trámite. El dueño solo puede usar esta misma función si es el
-- ÚNICO miembro que queda -- en ese caso el equipo no se borra, queda
-- marcado disuelto (así el historial de team_kicks_log y los torneos
-- en los que participó no quedan huérfanos) y perfil_tipo del ahora
-- ex-dueño vuelve a
-- 'jugador'. Si el equipo tiene más gente, el dueño tiene que
-- transferir el liderazgo primero (transferir_liderazgo(), más
-- abajo) -- después de eso ya no es dueño y puede usar esta misma
-- función sin problema.
create or replace function public.salir_equipo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_roles text[];
  v_total_miembros int;
begin
  select tm.team_id, tm.roles into v_team_id, v_roles
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'No perteneces a ningún equipo.';
  end if;

  perform 1 from public.teams where id = v_team_id for update;

  if v_roles @> array['owner']::text[] then
    select count(*) into v_total_miembros from public.team_members where team_id = v_team_id;

    if v_total_miembros > 1 then
      raise exception 'Como dueño del equipo, primero debes transferir el liderazgo a otro miembro antes de salir.';
    end if;

    insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
    values (v_team_id, auth.uid(), auth.uid(), 'renuncia');

    delete from public.team_members where user_id = auth.uid();
    update public.teams set disuelto = true where id = v_team_id;
    update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
    return;
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
  values (v_team_id, auth.uid(), auth.uid(), 'renuncia');

  delete from public.team_members where user_id = auth.uid();
end;
$$;

grant execute on function public.salir_equipo() to authenticated;

-- transferir_liderazgo() (migración 019): mismo criterio de
-- perfil_tipo que crear_membresia_owner() (migración 011) -- crear un
-- equipo o recibir su liderazgo son las dos únicas formas de volverse
-- lider_clan, siempre a mano vía estas funciones, nunca eligiéndolo
-- directo. El anterior dueño siempre puede volver a 'jugador' sin
-- chequear si lidera otro equipo, porque team_members.user_id es
-- primary key: nadie pertenece a más de un equipo a la vez.
create or replace function public.transferir_liderazgo(p_nuevo_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_es_miembro boolean;
begin
  select * into v_team from public.teams where owner_id = auth.uid() for update;

  if v_team is null then
    raise exception 'No eres dueño de ningún equipo.';
  end if;

  if v_team.disuelto then
    raise exception 'Este equipo ya fue disuelto.';
  end if;

  if p_nuevo_owner_id = auth.uid() then
    raise exception 'Ya eres el dueño de este equipo.';
  end if;

  select exists (
    select 1 from public.team_members where team_id = v_team.id and user_id = p_nuevo_owner_id
  ) into v_es_miembro;

  if not v_es_miembro then
    raise exception 'Ese jugador no pertenece a tu equipo.';
  end if;

  update public.team_members set roles = array['owner']::text[]
    where team_id = v_team.id and user_id = p_nuevo_owner_id;
  update public.team_members set roles = array['jugador']::text[]
    where team_id = v_team.id and user_id = auth.uid();

  update public.teams set owner_id = p_nuevo_owner_id where id = v_team.id;

  update public.profiles set perfil_tipo = 'lider_clan' where id = p_nuevo_owner_id;
  update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
end;
$$;

grant execute on function public.transferir_liderazgo(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "avatars_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-banners',
  'team-banners',
  true,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "team_banners_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'team-banners');

create policy "team_banners_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'team-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------
-- Llave de eliminación simple (1v1) — generar, reportar
-- resultados, avanzar ganadores, finalizar torneo. Por ahora solo
-- para formato 1v1 y modo eliminacion_simple.
-- ------------------------------------------------------------
create table public.bracket_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null,
  match_number int not null,
  participant1_id uuid references public.tournament_participants (id),
  -- null = bye (pase directo): participant1_id avanza solo.
  participant2_id uuid references public.tournament_participants (id),
  winner_id uuid references public.tournament_participants (id),
  reported_p1_winner uuid references public.tournament_participants (id),
  reported_p2_winner uuid references public.tournament_participants (id),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'jugado', 'en_disputa')),
  created_at timestamptz not null default now(),
  unique (tournament_id, round, match_number)
);

alter table public.bracket_matches enable row level security;

create policy "bracket_matches_select_publico"
  on public.bracket_matches for select
  using (true);

-- A propósito NO hay política de insert/update para authenticated:
-- la única forma de escribir acá es generar_llave() y
-- reportar_resultado(), security definer, que revisan permisos
-- por su cuenta.
grant select on public.bracket_matches to anon, authenticated;

alter table public.tournaments
  add column if not exists campeon_participant_id uuid references public.tournament_participants (id);

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

  -- Migración 010: solo entran a la llave los que confirmaron
  -- check_in = true -- los demás quedan afuera de esta edición, sin
  -- bye ni nada.
  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

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

  -- check_in_abierto pasa a false en el mismo UPDATE que cierra las
  -- inscripciones: si algo de arriba falla (por ejemplo, menos de 2
  -- confirmados), el raise exception revierte toda la función,
  -- incluido esto -- el torneo no queda en un estado a medio camino.
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

grant execute on function public.generar_llave(uuid) to authenticated;

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

  -- Migración 020: confirmar que vas a jugar cuenta como actividad,
  -- para la restauración de banca rota (30 días sin participar).
  perform public.registrar_actividad_participante(p_participant_id);
end;
$$;

grant execute on function public.confirmar_asistencia(uuid) to authenticated;

create or replace function public.avanzar_ganador(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_total_en_ronda int;
  v_target_match_number int;
  v_target record;
  v_es_impar boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;

  -- Registro de actividad (migración 020): solo en partidas reales,
  -- con los dos participantes presentes -- un bye no se jugó. Cubre
  -- tanto un reporte normal como uno resuelto por disputa o un
  -- abandono, porque todas esas rutas terminan acá. Reemplaza al
  -- reparto de XP que hacía este mismo punto antes (migración 013);
  -- el ajuste de MMR por resultado todavía no existe -- eso es la
  -- fase de Clan Wars -- pero la actividad sí se registra desde ya.
  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    perform public.registrar_actividad_participante(v_match.participant1_id);
    perform public.registrar_actividad_participante(v_match.participant2_id);
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round;

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

  -- es_dueno_del_participante() (migración 009) cubre tanto un
  -- participante de jugador individual (soy yo) como uno de equipo
  -- (soy el dueño de ese equipo) con la misma función.
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

grant execute on function public.reportar_resultado(uuid, uuid) to authenticated;

-- resolver_disputa (migración 008): única puerta de salida para una
-- partida en_disputa -- reportar_resultado la rechaza a propósito una
-- vez que llega a ese estado. Solo un administrador puede llamarla,
-- verificado adentro de la función misma.
create or replace function public.resolver_disputa(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver una disputa.';
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id for update;

  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'en_disputa' then
    raise exception 'Esta partida no está en disputa.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  update public.bracket_matches
    set winner_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;

  perform public.avanzar_ganador(p_match_id);

  if public.es_dueno_plataforma() then
    perform public.registrar_actividad_dueno(
      'resolver_disputa',
      'match_id=' || p_match_id::text || ' ganador=' || p_ganador_id::text
    );
  end if;
end;
$$;

grant execute on function public.resolver_disputa(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- Torneos por equipo (migración 009): 2v2, 3v3, 4v4. Reutiliza el
-- sistema de equipos (teams, team_members) y el motor de llave que ya
-- existe -- generar_llave() y avanzar_ganador() no cambian una línea,
-- porque nunca les importó si un tournament_participants.id es un
-- jugador o un equipo.
-- ------------------------------------------------------------
alter table public.tournament_participants
  add column team_id uuid references public.teams (id);

alter table public.tournament_participants
  add constraint tournament_participants_jugador_o_equipo check (
    (user_id is not null and team_id is null)
    or (user_id is null and team_id is not null)
  );

alter table public.tournament_participants
  add constraint tournament_participants_tournament_id_team_id_key unique (tournament_id, team_id);

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

  insert into public.tournament_participants (tournament_id, team_id)
  values (p_tournament_id, v_team_id);
end;
$$;

grant execute on function public.inscribir_equipo(uuid) to authenticated;

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

-- abandonar_torneo() (migración 019): saca a un participante de un
-- torneo 'abierto', o -- si el torneo ya está 'en_curso' y ese
-- participante todavía tiene una partida pendiente por jugar -- lo
-- trata como un abandono: su rival avanza automáticamente,
-- reutilizando avanzar_ganador() tal cual, con el mismo reparto de XP
-- que un partido jugado de verdad.
create or replace function public.abandonar_torneo(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
  v_match record;
  v_rival_id uuid;
begin
  select * into v_participante
  from public.tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Esa inscripción no existe.';
  end if;

  if not public.es_dueno_del_participante(p_participant_id) then
    raise exception 'No tienes permiso para abandonar esta inscripción.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id for update;

  if v_torneo.estado = 'abierto' then
    delete from public.tournament_participants where id = p_participant_id;
    return;
  end if;

  if v_torneo.estado = 'finalizado' then
    raise exception 'Este torneo ya terminó, no puedes abandonarlo.';
  end if;

  -- estado = 'en_curso': busca la partida pendiente donde participa.
  -- Si ya perdió o el torneo todavía no le asignó rival, no hay nada
  -- que abandonar.
  select * into v_match
  from public.bracket_matches
  where tournament_id = v_torneo.id
    and (participant1_id = p_participant_id or participant2_id = p_participant_id)
    and status = 'pendiente'
  for update
  limit 1;

  if v_match is null then
    raise exception 'No tienes ninguna partida pendiente en este torneo para abandonar.';
  end if;

  if v_match.participant1_id is null or v_match.participant2_id is null then
    raise exception 'Esta partida todavía no tiene rival asignado.';
  end if;

  v_rival_id := case
    when v_match.participant1_id = p_participant_id then v_match.participant2_id
    else v_match.participant1_id
  end;

  update public.bracket_matches
    set winner_id = v_rival_id, status = 'jugado'
    where id = v_match.id;

  perform public.avanzar_ganador(v_match.id);
end;
$$;

grant execute on function public.abandonar_torneo(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sistema de MMR y ligas oficiales de StarCraft II (migración 020)
-- -- reemplaza al de experiencia y niveles (antes acá, migraciones
-- 013 y 014, con su log y sus apuestas de XP entre clanes -- ninguno
-- de los dos sigue existiendo).
-- ------------------------------------------------------------

-- Tabla de ligas oficiales -- fija, no calculada. mmr < 1000 (entre
-- el piso absoluto de 500 y el arranque de Bronce 3) no es una liga
-- real: se trata directamente como 'Banca Rota'.
create or replace function public.calcular_liga(p_mmr integer)
returns text
language sql
immutable
as $$
  select case
    when p_mmr < 1000 then 'Banca Rota'
    when p_mmr <= 1200 then 'Bronce 3'
    when p_mmr <= 1440 then 'Bronce 2'
    when p_mmr <= 1680 then 'Bronce 1'
    when p_mmr <= 1880 then 'Plata 3'
    when p_mmr <= 2080 then 'Plata 2'
    when p_mmr <= 2280 then 'Plata 1'
    when p_mmr <= 2427 then 'Oro 3'
    when p_mmr <= 2573 then 'Oro 2'
    when p_mmr <= 2720 then 'Oro 1'
    when p_mmr <= 2853 then 'Platino 3'
    when p_mmr <= 2987 then 'Platino 2'
    when p_mmr <= 3120 then 'Platino 1'
    when p_mmr <= 3493 then 'Diamante 3'
    when p_mmr <= 3867 then 'Diamante 2'
    when p_mmr <= 4240 then 'Diamante 1'
    when p_mmr <= 4480 then 'Maestro 3'
    when p_mmr <= 4720 then 'Maestro 2'
    when p_mmr <= 4960 then 'Maestro 1'
    else 'Gran Maestro'
  end;
$$;

-- Nivel 1-100 derivado del MMR -- solo tiene sentido para 1v1 por
-- ahora (el de equipos se define en otra fase). Relación lineal
-- exacta: nivel 1 = 1000 MMR, nivel 100 = 4961 MMR o más. Por debajo
-- de 1000 (banca rota) queda fijo en nivel 1, no negativo.
create or replace function public.calcular_nivel(p_mmr integer)
returns integer
language sql
immutable
as $$
  select greatest(1, least(100,
    round(1 + (p_mmr - 1000)::numeric / (4961 - 1000) * 99)
  ))::int;
$$;

-- mmr_1v1 y mmr_equipos son del jugador (cada uno por separado -- el
-- rating de un jugador en 1v1 no tiene por qué ser el mismo que su
-- rating jugando en equipo); teams.mmr es del clan como unidad, nace
-- en 1441 (Bronce 1), no en 1000. Los tres tienen un piso absoluto de
-- 500. banca_rota, nivel_1v1, liga_1v1 y liga_equipos son GENERATED
-- -- igual que nivel dependía de xp antes, dependen del mmr
-- correspondiente y Postgres los recalcula solo, nunca se
-- desincronizan ni se escriben a mano.
alter table public.profiles add column mmr_1v1 integer not null default 1000 check (mmr_1v1 >= 500);
alter table public.profiles add column mmr_equipos integer not null default 1000 check (mmr_equipos >= 500);
-- Último momento en que este jugador participó en algo -- uso interno
-- nada más, para la restauración de banca rota. No es pública: no
-- está en la lista de columnas de SELECT de arriba.
alter table public.profiles add column ultima_actividad timestamptz not null default now();

alter table public.profiles add column banca_rota boolean
  generated always as (mmr_1v1 <= 500 or mmr_equipos <= 500) stored;
alter table public.profiles add column nivel_1v1 integer
  generated always as (public.calcular_nivel(mmr_1v1)) stored;
alter table public.profiles add column liga_1v1 text
  generated always as (public.calcular_liga(mmr_1v1)) stored;
alter table public.profiles add column liga_equipos text
  generated always as (public.calcular_liga(mmr_equipos)) stored;

alter table public.teams add column mmr integer not null default 1441 check (mmr >= 500);
alter table public.teams add column ultima_actividad timestamptz not null default now();
alter table public.teams add column banca_rota boolean generated always as (mmr <= 500) stored;
alter table public.teams add column liga text generated always as (public.calcular_liga(mmr)) stored;

-- Si pasaron 30 días corridos sin actividad y sigue en banca rota,
-- vuelve a 1000 MMR (Bronce 3) -- fresco, no al punto de partida
-- original de un equipo (1441), es una restauración desde el fondo
-- de la tabla. Se llama desde el frontend cada vez que alguien entra
-- a su perfil o a la página de su equipo -- se evalúa al toque, no
-- hace falta un cron (mismo patrón que esta_suspendido()). banca_rota
-- es GENERATED, se apaga sola en el mismo UPDATE.
create or replace function public.restaurar_banca_rota_perfil(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    mmr_1v1 = case when mmr_1v1 <= 500 then 1000 else mmr_1v1 end,
    mmr_equipos = case when mmr_equipos <= 500 then 1000 else mmr_equipos end
  where id = p_user_id
    and (mmr_1v1 <= 500 or mmr_equipos <= 500)
    and ultima_actividad <= now() - interval '30 days';
end;
$$;

grant execute on function public.restaurar_banca_rota_perfil(uuid) to authenticated;

create or replace function public.restaurar_banca_rota_equipo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.teams
  set mmr = 1000
  where id = p_team_id
    and mmr <= 500
    and ultima_actividad <= now() - interval '30 days';
end;
$$;

grant execute on function public.restaurar_banca_rota_equipo(uuid) to authenticated;

-- ------------------------------------------------------------
-- Privilegio del dueño de la plataforma (migración 016): función de
-- consulta, y registro privado de actividad.
--
-- es_dueno_plataforma() es la única forma de consultar el privilegio
-- desde afuera de la base -- la columna cruda tiene la lectura
-- revocada (ver arriba). PREPARADO PARA MÁS ADELANTE: cuando se
-- construya un sistema de "fulano vio tu perfil/equipo" o el botón
-- "Investigar jugador", hay que llamar a esta función para excluir al
-- dueño de la plataforma de generar esos registros/notificaciones, y
-- para bloquear que se lo investigue a él aunque quien llame sea otro
-- admin -- ninguna de esas dos funciones existe todavía.
-- ------------------------------------------------------------
create or replace function public.es_dueno_plataforma()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select es_dueno_plataforma from public.profiles where id = auth.uid()), false);
$$;

-- No es "sin registro", es "registro privado": solo legible por quien
-- tiene es_dueno_plataforma = true, invisible para todo el resto del
-- staff (incluidos otros admins).
create table public.dueno_actividad_log (
  id uuid primary key default gen_random_uuid(),
  accion text not null,
  detalle text,
  created_at timestamptz not null default now()
);

alter table public.dueno_actividad_log enable row level security;

create policy "dueno_actividad_log_select_propio"
  on public.dueno_actividad_log for select
  to authenticated
  using (public.es_dueno_plataforma());

grant select on public.dueno_actividad_log to authenticated;

create or replace function public.registrar_actividad_dueno(p_accion text, p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Solo el dueño de la plataforma puede registrar esto.';
  end if;

  insert into public.dueno_actividad_log (accion, detalle)
  values (p_accion, p_detalle);
end;
$$;

grant execute on function public.registrar_actividad_dueno(text, text) to authenticated;

-- ============================================================
-- Después de correr todo lo de arriba, activa tu propio usuario
-- como administrador (cambia el email):
--
--   update public.profiles set es_admin = true
--   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
--
-- Y, si además queres ser el dueño de la plataforma (privilegio
-- aparte de es_admin, ver migración 016):
--
--   update public.profiles set es_dueno_plataforma = true
--   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
-- ============================================================
