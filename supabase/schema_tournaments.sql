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
  -- Preferencia visual de forma de avatar (migración 031): se respeta
  -- en cualquier lugar donde se muestre el avatar de ESTE usuario
  -- (header, listas de participantes, miembros de equipo) -- no
  -- afecta a los logos de equipo, que son un concepto aparte.
  avatar_forma text not null default 'cuadrado' check (avatar_forma in ('cuadrado', 'redondo')),
  -- Banner del Perfil Público de Jugador (migración 032) -- mismo
  -- concepto que teams.banner_url, recorte 4:1.
  banner_url text,
  bio text,
  -- Links de transmisión del jugador (migración 035): array de
  -- {plataforma, url}, sin límite de cantidad -- Twitch, YouTube,
  -- Kick, etc. a la vez. Distinto de clan_wars.caster_nombre/link, que
  -- es por guerra puntual, no del jugador.
  links_transmision jsonb not null default '[]'::jsonb,
  -- Horario habitual de transmisión (migración 036): texto libre, sin
  -- estructura de días/horas por ahora.
  horario_stream text,
  -- Carisma (migración 036): mismo formato que valentia_jugador, pero
  -- todavía SIN ninguna lógica que lo suba o baje -- valor fijo hasta
  -- que se defina cómo debería cambiar.
  carisma integer not null default 50 check (carisma >= 0 and carisma <= 100),
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

-- Historial de nicks (migración 025): quién se llamaba cómo antes de
-- cambiarse el nick -- se llena solo, desde el trigger de más abajo,
-- cada vez que un update de profiles cambia el nick. Nadie la lee
-- directo (sin política de select, sin grant): la única puerta es
-- investigar_jugador(), security definer, más abajo en el archivo.
create table public.nick_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  nick_anterior text not null,
  cambiado_en timestamptz not null default now()
);

alter table public.nick_history enable row level security;

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
  -- Historial de nicks (migración 025): se registra siempre que
  -- cambia, sin importar el camino por el que se guardó -- no es una
  -- protección de seguridad, es un registro para investigar_jugador().
  if new.nick is distinct from old.nick and old.nick is not null then
    insert into public.nick_history (user_id, nick_anterior, cambiado_en)
    values (old.id, old.nick, now());
  end if;

  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;

    -- Migración 017: el dueño de la plataforma nunca puede quedar
    -- suspendido; cualquier otro cambio de suspendido por esta vía
    -- (API) exige ser admin -- si no, se revierte, así una cuenta
    -- suspendida no puede reactivarse a sí misma con un update común.
    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    elsif new.suspendido is distinct from old.suspendido and not public.is_admin() then
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
  es_admin boolean,
  -- Migración 028: quién suspendió la cuenta, por qué, y cuándo --
  -- visible para CUALQUIER administrador, no solo quien la suspendió.
  -- suspendido_por_nick se resuelve acá (join) en vez de mandar el
  -- uuid crudo, para que sea legible sin una consulta aparte.
  suspendido_por_nick text,
  suspendido_motivo text,
  suspendido_en timestamptz
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
           p.cuenta_validada, p.suspendido, p.es_admin,
           sp.nick, p.suspendido_motivo, p.suspendido_en
    from public.profiles p
    left join public.profiles sp on sp.id = p.suspendido_por
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

-- admin_suspender_usuario() (migración 028): único camino para
-- suspender/reactivar una cuenta -- suspendido ya no tiene grant de
-- columna para nadie (ver más arriba). Exige un motivo obligatorio
-- para suspender, y deja registro de quién y cuándo. El dueño de la
-- plataforma nunca puede quedar suspendido, ni por acá.
create or replace function public.admin_suspender_usuario(
  p_usuario_id uuid,
  p_suspender boolean,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede suspender o reactivar una cuenta.';
  end if;

  if p_suspender and (p_motivo is null or trim(p_motivo) = '') then
    raise exception 'Tienes que escribir un motivo para suspender la cuenta.';
  end if;

  if exists (select 1 from public.profiles where id = p_usuario_id and es_dueno_plataforma) then
    raise exception 'No se puede suspender al dueño de la plataforma.';
  end if;

  update public.profiles
    set suspendido = p_suspender,
        suspendido_por = case when p_suspender then auth.uid() else null end,
        suspendido_motivo = case when p_suspender then trim(p_motivo) else null end,
        suspendido_en = case when p_suspender then now() else null end
    where id = p_usuario_id;
end;
$$;

grant execute on function public.admin_suspender_usuario(uuid, boolean, text) to authenticated;

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
-- valentia_jugador/responsabilidad_cw/responsabilidad_torneos/
-- poco_confiable (migración 024) son públicas igual que el MMR y la
-- liga.
-- gran_maestro_alcanzado_en (migración 030) es un logro -- se muestra
-- en la Sala de la Fama para cualquiera.
grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, avatar_forma,
  banner_url, bio, links_transmision, horario_stream,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable, carisma,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

-- Migración 028: suspendido sale de esta lista -- mismo motivo que
-- perfil_tipo (ver el párrafo de abajo): ahora hace falta guardar
-- también quién, por qué y cuándo, y eso solo lo puede hacer
-- atómicamente una función, no un grant de columna. La única puerta
-- pasa a ser admin_suspender_usuario() (más abajo), security definer,
-- exige is_admin() y un motivo obligatorio para suspender.
--
-- perfil_tipo tampoco va en esta lista: no hay forma de que un grant
-- de columna distinga "admin cambiando el rol de otro" de "usuario
-- cambiándose el suyo propio" -- y acá no alcanza con un trigger (el
-- cambio de perfil_tipo también tiene que validar que el nuevo valor
-- sea válido). Por eso queda totalmente afuera de este grant -- ni
-- siquiera un admin puede tocarlo con un update directo -- y la única
-- puerta es admin_cambiar_perfil_tipo() (ver más abajo, junto a
-- admin_listar_usuarios()), security definer, exige is_admin().
grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, avatar_forma, banner_url, bio, links_transmision, horario_stream
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
  joined_at timestamptz not null default now(),
  -- Capitán (migración 038): permiso delegado por el dueño, revocable
  -- en cualquier momento -- ver asignar_capitan() y
  -- es_capitan_o_dueno() más abajo. Sin límite de cuántos capitanes
  -- puede haber a la vez.
  es_capitan boolean not null default false
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
  motivo text not null default 'expulsado' check (motivo in ('expulsado', 'renuncia')),
  -- Migración 025: cuándo había entrado a ese equipo (team_members.
  -- joined_at, que se pierde en cuanto se borra la fila) -- para que
  -- investigar_jugador() pueda mostrar el historial de equipos
  -- completo, no solo la fecha de salida. Nullable: los registros de
  -- antes de esta migración no lo tienen.
  entrada_en timestamptz
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

-- ------------------------------------------------------------
-- Capitanes (migración 038): un capitán tiene, con pocas excepciones,
-- el mismo permiso que el dueño sobre SU equipo -- ver el detalle de
-- qué queda exclusivo del dueño en cada función de abajo.
-- ------------------------------------------------------------
create or replace function public.es_capitan_o_dueno(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams where id = p_team_id and owner_id = p_user_id
  ) or exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id and es_capitan
  );
$$;

grant execute on function public.es_capitan_o_dueno(uuid, uuid) to authenticated;

-- asignar_capitan(): exclusiva del dueño. Sin límite de capitanes; no
-- se puede marcar/desmarcar a uno mismo (el dueño ya tiene todo el
-- permiso, no necesita el rol).
create or replace function public.asignar_capitan(p_team_id uuid, p_user_id uuid, p_es_capitan boolean)
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
    raise exception 'Solo el dueño del equipo puede asignar o quitar capitanes.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'El dueño no necesita marcarse como capitán.';
  end if;

  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id) then
    raise exception 'Ese jugador no es miembro de tu equipo.';
  end if;

  update public.team_members set es_capitan = p_es_capitan where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.asignar_capitan(uuid, uuid, boolean) to authenticated;

create or replace function public.invitar_jugador(p_team_id uuid, p_invited_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.teams where id = p_team_id and not disuelto) then
    raise exception 'Ese equipo no existe.';
  end if;

  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede invitar jugadores.';
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
  v_entrada_en timestamptz;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  -- Migración 038: antes era imposible por construcción (solo el
  -- dueño podía llamar a esta función, y ya se bloqueaba sacarse a
  -- uno mismo) -- ahora que un capitán también puede, hace falta
  -- bloquear explícitamente sacar al dueño.
  if p_user_id = v_owner_id then
    raise exception 'No se puede quitar al dueño del equipo.';
  end if;

  select joined_at into v_entrada_en
  from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
  values (p_team_id, p_user_id, auth.uid(), 'expulsado', v_entrada_en);

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
  v_entrada_en timestamptz;
  v_total_miembros int;
begin
  select tm.team_id, tm.roles, tm.joined_at into v_team_id, v_roles, v_entrada_en
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

    insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
    values (v_team_id, auth.uid(), auth.uid(), 'renuncia', v_entrada_en);

    delete from public.team_members where user_id = auth.uid();
    update public.teams set disuelto = true where id = v_team_id;
    update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
    return;
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
  values (v_team_id, auth.uid(), auth.uid(), 'renuncia', v_entrada_en);

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

-- eliminar_equipo_definitivo() (migración 028): borra la fila de
-- teams de verdad, no solo la marca disuelta. Solo el dueño (o un
-- admin, para el caso de /admin) -- y solo si el equipo ya está
-- disuelto, o si no tiene otros miembros además del dueño (en ese
-- caso no hace falta pasar por salir_equipo()/disolver primero).
-- team_members, team_invitations y team_kicks_log caen en cascada
-- solos (on delete cascade); clan_wars/tournament_participants NO
-- tienen cascade a propósito -- si el equipo tiene historial de Clan
-- Wars o de torneos, la eliminación se bloquea para no perder esa
-- historia. titulos_padre_hijo no tiene foreign key (es polimórfica)
-- así que se limpia a mano antes de borrar -- si llegó hasta acá sin
-- historial de Clan Wars, cualquier título que la mencione todavía
-- está 'pendiente' o 'rechazado', nunca 'activo'.
create or replace function public.eliminar_equipo_definitivo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_otros_miembros int;
begin
  select * into v_team from public.teams where id = p_team_id for update;
  if v_team is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_team.owner_id <> auth.uid() and not public.is_admin() then
    raise exception 'No tienes permiso para eliminar este equipo.';
  end if;

  if not v_team.disuelto then
    select count(*) into v_otros_miembros
    from public.team_members
    where team_id = p_team_id and user_id <> v_team.owner_id;

    if v_otros_miembros > 0 then
      raise exception 'Este equipo todavía tiene otros miembros -- primero tiene que disolverse (o quedar sin otros miembros) antes de poder eliminarlo definitivamente.';
    end if;
  end if;

  if exists (
    select 1 from public.clan_wars where challenger_team_id = p_team_id or challenged_team_id = p_team_id
  ) or exists (
    select 1 from public.tournament_participants where team_id = p_team_id
  ) then
    raise exception 'Este equipo tiene historial de Clan Wars o de torneos y no se puede eliminar definitivamente -- esa historia queda protegida.';
  end if;

  delete from public.titulos_padre_hijo where tipo = 'clan' and (retador_id = p_team_id or retado_id = p_team_id);

  delete from public.teams where id = p_team_id;
end;
$$;

grant execute on function public.eliminar_equipo_definitivo(uuid) to authenticated;

-- investigar_jugador() (migración 025): revisar el historial completo
-- de un jugador antes de invitarlo -- nicks anteriores, en qué clanes
-- estuvo (con fecha de entrada y de salida, y si fue expulsión o
-- renuncia), reportes de 'no_se_presento' en su contra, y sus
-- valores actuales de responsabilidad/valentía. Solo para líderes de
-- clan (dueños de algún equipo) o administradores -- ni siquiera un
-- jugador puede usarla para investigarse a sí mismo por acá, ya tiene
-- su propio /perfil para eso. Devuelve todo junto en un jsonb, porque
-- la forma de la respuesta es heterogénea (identidad + tres listas).
create or replace function public.investigar_jugador(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puede_investigar boolean;
  v_resultado jsonb;
begin
  select exists (select 1 from public.teams where owner_id = auth.uid()) or public.is_admin()
    into v_puede_investigar;

  if not v_puede_investigar then
    raise exception 'No tienes permiso para investigar jugadores.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  select jsonb_build_object(
    'identidad', (
      select jsonb_build_object(
        'id', p.id,
        'nick', p.nick,
        'unique_id', p.unique_id,
        'suspendido', p.suspendido,
        'poco_confiable', p.poco_confiable,
        'valentia_jugador', p.valentia_jugador,
        'responsabilidad_cw', p.responsabilidad_cw,
        'responsabilidad_torneos', p.responsabilidad_torneos,
        'liga_1v1', p.liga_1v1
      )
      from public.profiles p
      where p.id = p_user_id
    ),
    'historial_nicks', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('nick_anterior', nh.nick_anterior, 'cambiado_en', nh.cambiado_en)
          order by nh.cambiado_en desc
        ),
        '[]'::jsonb
      )
      from public.nick_history nh
      where nh.user_id = p_user_id
    ),
    'historial_equipos', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', team_id, 'nombre', nombre, 'tag', tag,
            'entrada_en', entrada_en, 'salida_en', salida_en, 'motivo_salida', motivo_salida
          )
          order by entrada_en desc nulls last
        ),
        '[]'::jsonb
      )
      from (
        -- Equipo actual, si tiene -- todavía no salió.
        select t.id as team_id, t.name as nombre, t.tag as tag, tm.joined_at as entrada_en,
               null::timestamptz as salida_en, null::text as motivo_salida
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where tm.user_id = p_user_id

        union all

        -- Equipos anteriores -- team_members ya se borró al salir, la
        -- única fuente que queda es team_kicks_log.
        select t.id, t.name, t.tag, tkl.entrada_en, tkl.kicked_at, tkl.motivo
        from public.team_kicks_log tkl
        join public.teams t on t.id = tkl.team_id
        where tkl.user_id = p_user_id
      ) historial
    ),
    'reportes_no_presentado', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'clan_war_id', cwr.clan_war_id,
            'reportado_por_nombre', rt.name || ' [' || rt.tag || ']',
            'created_at', cwr.created_at
          )
          order by cwr.created_at desc
        ),
        '[]'::jsonb
      )
      from public.clan_war_reportes cwr
      join public.teams rt on rt.id = cwr.reportado_por
      where cwr.jugador_afectado_id = p_user_id and cwr.motivo = 'no_se_presento'
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

grant execute on function public.investigar_jugador(uuid) to authenticated;

-- ------------------------------------------------------------
-- Clan Wars -- Fase 1 (migración 021): proponer y responder retos
-- entre clanes. Sin check-in, sin ajuste de MMR, sin caster ni
-- transmisión todavía -- eso son fases siguientes. banca_rota
-- (migración 020) se aplica de verdad acá: un equipo en banca rota no
-- puede proponer ni ser desafiado a un reto por puntos.
--
-- fecha_hora_cet se guarda como timestamptz (un instante absoluto),
-- no como una hora local "ingenua" fijada a CET -- Europa cambia de
-- CET (UTC+1) a CEST (UTC+2) con el horario de verano, así que "la
-- hora CET" de un instante concreto no es un desplazamiento fijo todo
-- el año. Guardando el instante real, "convertir a CET" y "convertir
-- a la hora local de cada quien" son, en cualquier momento del año,
-- una conversión de huso horario correcta -- nunca se desincronizan
-- entre sí.
-- ------------------------------------------------------------
create table public.clan_wars (
  id uuid primary key default gen_random_uuid(),
  challenger_team_id uuid not null references public.teams (id),
  challenged_team_id uuid not null references public.teams (id),
  fecha_hora_cet timestamptz not null,
  status text not null default 'pendiente'
    check (status in (
      'pendiente', 'aceptada', 'rechazada', 'cancelada', 'en_curso', 'finalizada', 'empatada'
    )),
  motivo_rechazo text
    check (motivo_rechazo in (
      'Falta de jugadores', 'Conflicto de horario', 'Ya tenemos guerra ese día',
      'Roster incompleto', 'Otro'
    )),
  -- Solo tiene sentido (y solo puede estar lleno) cuando el motivo es
  -- 'Otro' -- en cualquier otro caso el motivo fijo ya lo dice todo.
  motivo_detalle text,
  created_at timestamptz not null default now(),
  -- Fase 2 (migración 022, check-in). La VENTANA de tiempo del
  -- check-in se sigue calculando comparando fecha_hora_cet con el
  -- instante actual (15 minutos antes) -- eso nunca dependió de este
  -- booleano. Desde la migración 037, check_in_abierto sí es la
  -- fuente de verdad de si el LINEUP ya fue aprobado por los dos
  -- capitanes (se prende en confirmar_lineup_cw()): confirmar_alineacion()
  -- exige las dos condiciones a la vez (ventana de tiempo Y lineup
  -- aprobado) antes de aceptar un check-in real.
  check_in_abierto boolean not null default false,
  -- Migración 037: lineup armado y aprobado por cada capitán, paso
  -- previo al check-in -- ver clan_war_lineup, armar_lineup_cw() y
  -- confirmar_lineup_cw() más abajo.
  lineup_visto_bueno_challenger boolean not null default false,
  lineup_visto_bueno_challenged boolean not null default false,
  -- Migración 038: quién dio realmente el visto bueno de cada lado --
  -- no necesariamente el mismo capitán que armó el lineup
  -- (clan_war_lineup.agregado_por), puede haber sido otro capitán o
  -- el dueño.
  visto_bueno_dado_por_challenger uuid references public.profiles (id),
  visto_bueno_dado_por_challenged uuid references public.profiles (id),
  challenger_confirmado boolean not null default false,
  challenged_confirmado boolean not null default false,
  caster_nombre text,
  caster_link text,
  -- Nullable a propósito: obligatorio definirlo ANTES de que la
  -- guerra pueda pasar a 'en_curso' (intentar_iniciar_clan_war() más
  -- abajo lo exige), pero al proponerse el reto todavía no se sabe.
  tiene_delay boolean,
  -- Fase 3 (migración 023, resultado). Mismo patrón de doble
  -- confirmación que challenger_confirmado/challenged_confirmado,
  -- pero para el cierre: cualquiera de los dos capitanes llama a
  -- cerrar_clan_war(), pero recién se cierra de verdad cuando los dos
  -- la llamaron.
  challenger_cierre_confirmado boolean not null default false,
  challenged_cierre_confirmado boolean not null default false,
  ganador_team_id uuid references public.teams (id),
  check (challenger_team_id <> challenged_team_id),
  check (motivo_rechazo = 'Otro' or motivo_detalle is null),
  check (motivo_rechazo is distinct from 'Otro' or motivo_detalle is not null)
);

alter table public.clan_wars enable row level security;

-- El dueño o un capitán (migración 038) de alguno de los dos equipos
-- involucrados ve el detalle de un reto -- ni siquiera otro miembro
-- del mismo equipo.
create policy "clan_wars_select_propio"
  on public.clan_wars for select
  to authenticated
  using (
    public.es_capitan_o_dueno(challenger_team_id) or public.es_capitan_o_dueno(challenged_team_id)
  );

grant select on public.clan_wars to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es proponer_clan_war() y
-- responder_clan_war(), security definer, mismo patrón que
-- reportar_resultado() y el resto de las mutaciones sensibles del
-- proyecto.
create or replace function public.proponer_clan_war(p_challenged_team_id uuid, p_fecha_hora_cet timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
begin
  -- Migración 038: ya no solo el dueño -- cualquier miembro que sea
  -- dueño o capitán de su equipo. team_members.user_id es primary key,
  -- así que solo puede pertenecer a un equipo a la vez.
  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
  end if;

  if v_challenger.disuelto then
    raise exception 'Tu equipo está disuelto.';
  end if;
  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
  end if;
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  -- Cooldown de 7 días desde el último reto entre estos dos equipos,
  -- en cualquier dirección y sin importar el resultado (pendiente,
  -- aceptada, rechazada o cancelada cuentan igual).
  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet);
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz) to authenticated;

create or replace function public.responder_clan_war(
  p_clan_war_id uuid,
  p_aceptar boolean,
  p_motivo_rechazo text default null,
  p_motivo_detalle text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo desafiado puede responder este reto.';
  end if;

  if v_reto.status <> 'pendiente' then
    raise exception 'Este reto ya no está pendiente de respuesta.';
  end if;

  if p_aceptar then
    update public.clan_wars set status = 'aceptada' where id = p_clan_war_id;

    -- Valentía de clan (migración 024): aceptar sube la del
    -- desafiado. Sin mirar la liga de cada equipo todavía -- eso es
    -- un ajuste posterior.
    update public.teams
      set valentia = greatest(0, least(100, valentia + 2))
      where id = v_reto.challenged_team_id;
    return;
  end if;

  if p_motivo_rechazo is null then
    raise exception 'Tienes que elegir un motivo para rechazar el reto.';
  end if;
  if p_motivo_rechazo not in (
    'Falta de jugadores', 'Conflicto de horario', 'Ya tenemos guerra ese día',
    'Roster incompleto', 'Otro'
  ) then
    raise exception 'Ese motivo no es válido.';
  end if;
  if p_motivo_rechazo = 'Otro' and (p_motivo_detalle is null or trim(p_motivo_detalle) = '') then
    raise exception 'Tienes que escribir un detalle cuando el motivo es "Otro".';
  end if;

  update public.clan_wars
    set status = 'rechazada',
        motivo_rechazo = p_motivo_rechazo,
        motivo_detalle = case when p_motivo_rechazo = 'Otro' then p_motivo_detalle else null end
    where id = p_clan_war_id;

  -- Valentía de clan: rechazar sube la del que propuso el reto y baja
  -- la del que rechazó.
  update public.teams
    set valentia = greatest(0, least(100, valentia + 5))
    where id = v_reto.challenger_team_id;
  update public.teams
    set valentia = greatest(0, least(100, valentia - 5))
    where id = v_reto.challenged_team_id;
end;
$$;

grant execute on function public.responder_clan_war(uuid, boolean, text, text) to authenticated;

-- ------------------------------------------------------------
-- Clan Wars -- Fase 2 (migración 022): check-in antes de la guerra.
-- Sin ajuste de MMR ni reporte de resultado todavía -- eso es la fase
-- siguiente, con las tablas de ganancia/pérdida de MMR.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Lineup de Clan War (migración 037): el paso entre aceptar el reto y
-- el check-in. Cada capitán arma el lineup de SU propio equipo (nunca
-- del rival), con jugadores reales de su roster o jugadores
-- temporales, y un link de verificación opcional por jugador. Solo
-- cuando los dos capitanes dan su visto bueno se habilita el check-in.
-- ------------------------------------------------------------

create table public.clan_war_lineup (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  jugador_id uuid references public.profiles (id),
  jugador_temporal_id uuid references public.team_temp_players (id),
  link_verificacion text,
  agregado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (
    (jugador_id is not null and jugador_temporal_id is null)
    or (jugador_id is null and jugador_temporal_id is not null)
  ),
  unique (clan_war_id, jugador_id),
  unique (clan_war_id, jugador_temporal_id)
);

alter table public.clan_war_lineup enable row level security;

create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

grant select on public.clan_war_lineup to authenticated;

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  if p_accion = 'agregar' then
    if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
      raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.team_members where team_id = v_mi_team_id and user_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de tu equipo.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de tu equipo.';
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por
    )
    values (p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid());

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de tu equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  -- Cualquier cambio en el lineup resetea el visto bueno (y quién lo
  -- dio) del lado que lo cambió -- hay que volver a confirmarlo.
  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid) to authenticated;

-- confirmar_lineup_cw(): el visto bueno lo puede dar CUALQUIER
-- capitán o el dueño de ese equipo -- no tiene que ser
-- específicamente quien armó el lineup originalmente (ver
-- clan_war_lineup.agregado_por, que sí registra a esa persona puntual
-- y no cambia). Queda guardado en visto_bueno_dado_por_challenger/
-- challenged quién dio el visto bueno de verdad (migración 038).
create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    update public.clan_wars
      set lineup_visto_bueno_challenger = true, visto_bueno_dado_por_challenger = auth.uid()
      where id = p_clan_war_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    update public.clan_wars
      set lineup_visto_bueno_challenged = true, visto_bueno_dado_por_challenged = auth.uid()
      where id = p_clan_war_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

grant execute on function public.confirmar_lineup_cw(uuid) to authenticated;

-- Reportes durante el check-in: cualquiera de los dos capitanes puede
-- reportar un problema sobre un jugador del roster RIVAL (nunca del
-- propio). 'no_se_presento' queda registrado acá nada más por ahora
-- -- bajarle la confiabilidad a ese jugador es una fase aparte,
-- todavía no construida.
create table public.clan_war_reportes (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id),
  reportado_por uuid not null references public.teams (id),
  jugador_afectado_id uuid not null references public.profiles (id),
  motivo text not null check (motivo in ('cuenta_no_coincide', 'sospecha_smurf', 'no_se_presento')),
  created_at timestamptz not null default now()
);

alter table public.clan_war_reportes enable row level security;

-- Mismo criterio que clan_wars: solo el dueño o un capitán de los dos
-- equipos del reto en cuestión ven sus reportes.
create policy "clan_war_reportes_select_propio"
  on public.clan_war_reportes for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

grant select on public.clan_war_reportes to authenticated;

-- Sin política de insert para authenticated a propósito -- la única
-- forma de escribir acá es reportar_problema(), security definer.

-- Helper interno: se llama desde confirmar_alineacion() y
-- completar_datos_transmision() después de cada cambio, porque
-- cualquiera de las dos puede ser la pieza que faltaba para arrancar
-- la guerra. Sin grant execute para authenticated -- no hace falta,
-- nunca se llama directo desde el cliente, mismo patrón que
-- avanzar_ganador() con generar_llave()/reportar_resultado().
create or replace function public.intentar_iniciar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;

  if v_reto.status = 'aceptada'
     and v_reto.challenger_confirmado
     and v_reto.challenged_confirmado
     and v_reto.tiene_delay is not null
  then
    update public.clan_wars set status = 'en_curso' where id = p_clan_war_id;
  end if;
end;
$$;

-- confirmar_alineacion(): el capitán verificó por su cuenta, fuera de
-- la plataforma (en el lobby de SC2), que las cuentas del roster
-- rival coinciden con lo declarado -- esto no valida nada contra
-- Battle.net, es una confirmación manual de que ya lo revisó.
create or replace function public.confirmar_alineacion(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya empezó.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de este reto.';
  end if;

  -- Migración 037: el lineup tiene que estar aprobado por los dos
  -- lados ANTES de que el check-in real pueda empezar -- el check-in
  -- pasa a ser el paso siguiente al lineup, no el primero.
  if not v_reto.lineup_visto_bueno_challenger or not v_reto.lineup_visto_bueno_challenged then
    raise exception 'Todavía falta que los dos equipos den el visto bueno al lineup.';
  end if;

  -- La ventana se abre 15 minutos antes de fecha_hora_cet -- se
  -- recalcula acá mismo con el instante actual, no depende de ningún
  -- booleano guardado.
  if now() < v_reto.fecha_hora_cet - interval '15 minutes' then
    raise exception 'Todavía no se abrió la ventana de check-in (se abre 15 minutos antes de la hora del reto).';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_confirmado = true where id = p_clan_war_id;
  end if;

  perform public.intentar_iniciar_clan_war(p_clan_war_id);
end;
$$;

grant execute on function public.confirmar_alineacion(uuid) to authenticated;

-- reportar_problema(): siempre sobre un jugador del roster RIVAL,
-- nunca del propio equipo.
create or replace function public.reportar_problema(
  p_clan_war_id uuid,
  p_jugador_afectado_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_rival_team_id uuid;
  v_reportes_recientes int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de este reto.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'Este reto no está en un estado que permita reportar un problema.';
  end if;

  if p_motivo not in ('cuenta_no_coincide', 'sospecha_smurf', 'no_se_presento') then
    raise exception 'Ese motivo no es válido.';
  end if;

  if not exists (
    select 1 from public.team_members where team_id = v_rival_team_id and user_id = p_jugador_afectado_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo rival.';
  end if;

  insert into public.clan_war_reportes (clan_war_id, reportado_por, jugador_afectado_id, motivo)
  values (p_clan_war_id, v_mi_team_id, p_jugador_afectado_id, p_motivo);

  -- Responsabilidad (migración 024): 'no_se_presento' baja
  -- responsabilidad_cw y valentia_jugador del jugador reportado en el
  -- momento del reporte. Acumular 3 reportes de ese motivo en los
  -- últimos 30 días marca poco_confiable = true (texto visible:
  -- "Poco Responsable", nunca "confiable").
  if p_motivo = 'no_se_presento' then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw - 15)),
          valentia_jugador = greatest(0, least(100, valentia_jugador - 10))
      where id = p_jugador_afectado_id;

    select count(*) into v_reportes_recientes
    from public.clan_war_reportes
    where jugador_afectado_id = p_jugador_afectado_id
      and motivo = 'no_se_presento'
      and created_at >= now() - interval '30 days';

    if v_reportes_recientes >= 3 then
      update public.profiles set poco_confiable = true where id = p_jugador_afectado_id;
    end if;
  end if;
end;
$$;

grant execute on function public.reportar_problema(uuid, uuid, text) to authenticated;

-- completar_datos_transmision(): solo el organizador (quien propuso
-- el reto, challenger_team_id). caster_nombre y caster_link son
-- opcionales -- si llegan vacíos se guardan como null. tiene_delay es
-- obligatorio (true o false, nunca queda sin definir).
create or replace function public.completar_datos_transmision(
  p_clan_war_id uuid,
  p_caster_nombre text,
  p_caster_link text,
  p_tiene_delay boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo organizador puede completar los datos de transmisión.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya empezó.';
  end if;

  if p_tiene_delay is null then
    raise exception 'Tienes que definir si la transmisión tiene delay o no.';
  end if;

  update public.clan_wars
    set caster_nombre = nullif(trim(p_caster_nombre), ''),
        caster_link = nullif(trim(p_caster_link), ''),
        tiene_delay = p_tiene_delay
    where id = p_clan_war_id;

  perform public.intentar_iniciar_clan_war(p_clan_war_id);
end;
$$;

grant execute on function public.completar_datos_transmision(uuid, text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- Títulos Padre/Hijo -- entre clanes y entre jugadores 1v1 (migración
-- 026). Se resuelven solos con un enfrentamiento real -- una Clan War
-- que se cierra (clanes, ver cerrar_clan_war() más abajo) o una
-- partida 1v1 que se resuelve en cualquier torneo (jugadores, ver
-- avanzar_ganador() más abajo) -- reutilizando esas dos funciones, no
-- unas paralelas.
--
-- retador_id/retado_id son polimórficos (team_id o profile_id, según
-- tipo) -- no llevan foreign key porque apuntan a una tabla u otra
-- según el caso; cada función valida que el id exista adentro.
--
-- Sobre "queda pendiente hasta que se resuelve": aceptar NO cambia el
-- status (sigue en 'pendiente'). La columna aceptado es la única
-- forma de distinguir "todavía sin responder" de "ya se acordó,
-- esperando el partido/CW que lo resuelva".
-- ------------------------------------------------------------
create table public.titulos_padre_hijo (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('clan', 'jugador')),
  retador_id uuid not null,
  retado_id uuid not null,
  duracion_dias integer not null check (duracion_dias between 7 and 90),
  -- Obligatorios solo para tipo = 'jugador' -- el check de abajo lo
  -- exige.
  caster_nombre text,
  caster_link text,
  status text not null default 'pendiente' check (status in ('pendiente', 'activo', 'expirado', 'rechazado')),
  aceptado boolean not null default false,
  -- null hasta resolverse.
  ganador_id uuid,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  created_at timestamptz not null default now(),
  check (retador_id <> retado_id),
  check (tipo <> 'jugador' or (caster_nombre is not null and caster_link is not null)),
  check (ganador_id is null or ganador_id in (retador_id, retado_id))
);

alter table public.titulos_padre_hijo enable row level security;

-- Cualquiera ve los títulos donde participa su propio equipo o su
-- propia cuenta -- pendientes de responder y propios, en el Panel de
-- control / en /perfil. Los títulos ACTIVOS que se muestran en el
-- perfil público de un tercero van por titulos_activos_de() más
-- abajo, que sí es pública -- no por esta política.
create policy "titulos_padre_hijo_select_propio"
  on public.titulos_padre_hijo for select
  to authenticated
  using (
    (tipo = 'jugador' and (retador_id = auth.uid() or retado_id = auth.uid()))
    or (tipo = 'clan' and (
      exists (select 1 from public.teams where id = retador_id and owner_id = auth.uid())
      or exists (select 1 from public.teams where id = retado_id and owner_id = auth.uid())
    ))
  );

grant select on public.titulos_padre_hijo to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es proponer_titulo_padre_hijo(),
-- responder_titulo_padre_hijo(), y la resolución automática desde
-- cerrar_clan_war()/avanzar_ganador(), todas security definer.

create or replace function public.proponer_titulo_padre_hijo(
  p_tipo text,
  p_retado_id uuid,
  p_duracion_dias integer,
  p_caster_nombre text default null,
  p_caster_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retador_id uuid;
begin
  if p_tipo not in ('clan', 'jugador') then
    raise exception 'Ese tipo de título no es válido.';
  end if;

  if p_duracion_dias < 7 or p_duracion_dias > 90 then
    raise exception 'La duración tiene que ser entre 7 y 90 días.';
  end if;

  if p_tipo = 'clan' then
    -- Migración 028: not disuelto, mismo motivo que en proponer_clan_war().
    select id into v_retador_id from public.teams where owner_id = auth.uid() and not disuelto;
    if v_retador_id is null then
      raise exception 'No eres dueño de ningún equipo.';
    end if;
    if not exists (select 1 from public.teams where id = p_retado_id) then
      raise exception 'Ese equipo no existe.';
    end if;
  else
    v_retador_id := auth.uid();
    if not exists (select 1 from public.profiles where id = p_retado_id) then
      raise exception 'Ese jugador no existe.';
    end if;
    if p_caster_nombre is null or trim(p_caster_nombre) = '' then
      raise exception 'El caster es obligatorio para un título entre jugadores.';
    end if;
    if p_caster_link is null or trim(p_caster_link) = '' then
      raise exception 'El link del caster es obligatorio para un título entre jugadores.';
    end if;
  end if;

  if v_retador_id = p_retado_id then
    raise exception 'No puedes retarte a ti mismo.';
  end if;

  insert into public.titulos_padre_hijo (
    tipo, retador_id, retado_id, duracion_dias, caster_nombre, caster_link
  ) values (
    p_tipo, v_retador_id, p_retado_id, p_duracion_dias,
    case when p_tipo = 'jugador' then p_caster_nombre else null end,
    case when p_tipo = 'jugador' then p_caster_link else null end
  );
end;
$$;

grant execute on function public.proponer_titulo_padre_hijo(text, uuid, integer, text, text) to authenticated;

create or replace function public.responder_titulo_padre_hijo(p_titulo_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo record;
  v_soy_retado boolean;
begin
  select * into v_titulo from public.titulos_padre_hijo where id = p_titulo_id for update;
  if v_titulo is null then
    raise exception 'Ese título no existe.';
  end if;

  if v_titulo.status <> 'pendiente' or v_titulo.aceptado then
    raise exception 'Este título ya fue respondido.';
  end if;

  if v_titulo.tipo = 'clan' then
    select exists (select 1 from public.teams where id = v_titulo.retado_id and owner_id = auth.uid())
      into v_soy_retado;
  else
    v_soy_retado := (v_titulo.retado_id = auth.uid());
  end if;

  if not v_soy_retado then
    raise exception 'Solo el retado puede responder este título.';
  end if;

  if p_aceptar then
    update public.titulos_padre_hijo set aceptado = true where id = p_titulo_id;
  else
    update public.titulos_padre_hijo set status = 'rechazado' where id = p_titulo_id;
  end if;
end;
$$;

grant execute on function public.responder_titulo_padre_hijo(uuid, boolean) to authenticated;

-- Cuando fecha_fin ya pasó, un título activo deja de mostrarse como
-- tal -- se evalúa al cargar el perfil o el equipo (mismo patrón que
-- restaurar_banca_rota_perfil()/_equipo()), no hace falta un proceso
-- en segundo plano.
create or replace function public.expirar_titulos_vencidos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.titulos_padre_hijo
    set status = 'expirado'
    where status = 'activo' and fecha_fin < now();
end;
$$;

grant execute on function public.expirar_titulos_vencidos() to authenticated;

-- Títulos activos de un equipo o jugador, para mostrar en su perfil
-- público -- se acumulan, no se reemplazan. A propósito NO usa la
-- política de RLS de arriba (esa es "solo los involucrados"): esto es
-- información pública.
create or replace function public.titulos_activos_de(p_tipo text, p_id uuid)
returns table (
  id uuid,
  otro_id uuid,
  soy_padre boolean,
  fecha_fin timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.id,
    case when t.retador_id = p_id then t.retado_id else t.retador_id end as otro_id,
    (t.ganador_id = p_id) as soy_padre,
    t.fecha_fin
  from public.titulos_padre_hijo t
  where t.tipo = p_tipo and t.status = 'activo' and (t.retador_id = p_id or t.retado_id = p_id);
$$;

grant execute on function public.titulos_activos_de(text, uuid) to anon, authenticated;

-- Sala de la Fama (migración 030): todos los títulos activos de un
-- tipo, de una sola vez -- pública, sin restricción de participante
-- (a diferencia de la RLS de la tabla base). El Muro de Campeones/
-- Jugadores y la Galería la usan para no pedir uno por uno.
create or replace function public.titulos_activos_todos(p_tipo text)
returns table (
  id uuid,
  retador_id uuid,
  retado_id uuid,
  ganador_id uuid,
  duracion_dias integer,
  fecha_inicio timestamptz,
  fecha_fin timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.retador_id, t.retado_id, t.ganador_id, t.duracion_dias, t.fecha_inicio, t.fecha_fin
  from public.titulos_padre_hijo t
  where t.tipo = p_tipo and t.status = 'activo';
$$;

grant execute on function public.titulos_activos_todos(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Clan Wars -- Fase 3 (migración 023): resultado, con ajuste real de
-- MMR para jugadores y para el equipo. Bonos de torneo y actividad
-- semanal quedan afuera a propósito -- dependen de cosas que todavía
-- no están diseñadas.
-- ------------------------------------------------------------

-- Partidas individuales de la guerra: los capitanes las van agregando
-- a medida que se juegan, sin un número fijo predefinido -- el
-- organizador decide cuándo hay suficientes para cerrar la CW.
create table public.clan_war_matches (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id),
  jugador_challenger_id uuid not null references public.profiles (id),
  jugador_challenged_id uuid not null references public.profiles (id),
  -- null hasta reportarse.
  ganador_id uuid references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'jugado')),
  created_at timestamptz not null default now(),
  check (jugador_challenger_id <> jugador_challenged_id),
  check (ganador_id is null or ganador_id in (jugador_challenger_id, jugador_challenged_id))
);

alter table public.clan_war_matches enable row level security;

-- Mismo criterio que clan_wars/clan_war_reportes: solo los capitanes
-- de los dos equipos de la guerra ven sus partidas.
create policy "clan_war_matches_select_propio"
  on public.clan_war_matches for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

grant select on public.clan_war_matches to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es agregar_partida_cw() y
-- reportar_partida_cw(), security definer.

-- Tabla de MMR apostado -- exacta, según la liga de quien gana y de
-- quien pierde. No es security definer ni necesita grant execute: es
-- puro cálculo, sin tocar ninguna tabla.
create or replace function public.calcular_ajuste_mmr(
  mmr_ganador integer,
  mmr_perdedor integer,
  out ajuste_ganador integer,
  out ajuste_perdedor integer
)
language plpgsql
immutable
as $$
declare
  v_liga_ganador text;
  v_liga_perdedor text;
begin
  v_liga_ganador := public.calcular_liga(mmr_ganador);
  v_liga_perdedor := public.calcular_liga(mmr_perdedor);

  if v_liga_ganador in ('Bronce 3', 'Bronce 2', 'Bronce 1', 'Banca Rota') then
    -- La "hazaña": el ganador está en Bronce (o banca rota, mismo
    -- piso) y el perdedor está en Platino o superior.
    if v_liga_perdedor in (
      'Platino 3', 'Platino 2', 'Platino 1',
      'Diamante 3', 'Diamante 2', 'Diamante 1',
      'Maestro 3', 'Maestro 2', 'Maestro 1',
      'Gran Maestro'
    ) then
      ajuste_ganador := 80;
    else
      ajuste_ganador := 48;
    end if;
    ajuste_perdedor := -12;

  elsif v_liga_ganador in ('Plata 3', 'Plata 2', 'Plata 1') then
    ajuste_ganador := 36;
    ajuste_perdedor := -16;

  elsif v_liga_ganador in ('Oro 3', 'Oro 2', 'Oro 1') then
    ajuste_ganador := 28;
    ajuste_perdedor := -20;

  else
    -- Platino, Diamante, Maestro o Gran Maestro: competitivo real,
    -- simétrico según quién tenía más MMR antes de jugar. Un empate
    -- exacto de MMR se trata como "el ganador era favorito" (>=).
    if mmr_ganador >= mmr_perdedor then
      ajuste_ganador := 24;
      ajuste_perdedor := -38;
    else
      ajuste_ganador := 38;
      ajuste_perdedor := -24;
    end if;
  end if;
end;
$$;

-- agregar_partida_cw(): cualquiera de los dos capitanes puede agregar
-- una partida, eligiendo un jugador de cada roster -- solo mientras
-- la guerra está 'en_curso' (recién ahí terminó el check-in).
create or replace function public.agregar_partida_cw(
  p_clan_war_id uuid,
  p_jugador_challenger_id uuid,
  p_jugador_challenged_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra todavía no está en curso.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenger_team_id and user_id = p_jugador_challenger_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiante.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenged_team_id and user_id = p_jugador_challenged_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiado.';
  end if;

  insert into public.clan_war_matches (clan_war_id, jugador_challenger_id, jugador_challenged_id)
  values (p_clan_war_id, p_jugador_challenger_id, p_jugador_challenged_id);
end;
$$;

grant execute on function public.agregar_partida_cw(uuid, uuid, uuid) to authenticated;

-- reportar_partida_cw(): ajusta mmr_equipos de los dos jugadores al
-- toque, no espera al cierre de la CW.
create or replace function public.reportar_partida_cw(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
begin
  select * into v_match from public.clan_war_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'pendiente' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;

  select * into v_reto from public.clan_wars where id = v_match.clan_war_id;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_match.jugador_challenger_id and p_ganador_id <> v_match.jugador_challenged_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  v_perdedor_id := case
    when p_ganador_id = v_match.jugador_challenger_id then v_match.jugador_challenged_id
    else v_match.jugador_challenger_id
  end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  -- greatest(500, ...) en vez de dejar que el check constraint de la
  -- columna lo rechace: acá se quiere recortar en el piso, no fallar
  -- con un error.
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  -- Valentía de jugador (migración 024): participar suma, sin
  -- importar quién ganó.
  update public.profiles
    set valentia_jugador = greatest(0, least(100, valentia_jugador + 1))
    where id in (v_match.jugador_challenger_id, v_match.jugador_challenged_id);

  -- Responsabilidad_cw: solo para el jugador cuyo capitán confirmó el
  -- check-in dentro de la ventana -- challenger_confirmado /
  -- challenged_confirmado solo pueden ser true si
  -- confirmar_alineacion() pasó ese chequeo (migración 022), así que
  -- basta con leerlos acá.
  if v_reto.challenger_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenger_id;
  end if;
  if v_reto.challenged_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenged_id;
  end if;

  update public.clan_war_matches
    set ganador_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;
end;
$$;

grant execute on function public.reportar_partida_cw(uuid, uuid) to authenticated;

-- cerrar_clan_war(): cualquiera de los dos capitanes la llama, pero
-- recién se cierra de verdad cuando los dos la llamaron. El equipo
-- con más partidas individuales ganadas gana la CW completa y ajusta
-- su MMR de clan una sola vez; empate en partidas ganadas deja la CW
-- 'empatada' sin tocar el MMR de ningún equipo (el MMR individual de
-- cada partida ya se movió al reportarse, eso no se revierte).
create or replace function public.cerrar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
  v_ganadas_challenger int;
  v_ganadas_challenged int;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_team_ganador_id uuid;
  v_team_perdedor_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    -- Falta que confirme el otro capitán -- todavía no se cierra.
    return;
  end if;

  select count(*) into v_ganadas_challenger
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

  select count(*) into v_ganadas_challenged
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

  if v_ganadas_challenger = v_ganadas_challenged then
    update public.clan_wars set status = 'empatada' where id = p_clan_war_id;
    return;
  end if;

  if v_ganadas_challenger > v_ganadas_challenged then
    v_team_ganador_id := v_reto.challenger_team_id;
    v_team_perdedor_id := v_reto.challenged_team_id;
  else
    v_team_ganador_id := v_reto.challenged_team_id;
    v_team_perdedor_id := v_reto.challenger_team_id;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;

  -- Títulos Padre/Hijo entre clanes (migración 026): si estos dos
  -- equipos tenían un título ya acordado (aceptado, todavía
  -- 'pendiente') entre ellos, esta CW lo resuelve con el mismo
  -- ganador. Un empate no resuelve ningún título -- no hay ganador
  -- real que transferir.
  update public.titulos_padre_hijo
    set status = 'activo',
        ganador_id = v_team_ganador_id,
        fecha_inicio = now(),
        fecha_fin = now() + (duracion_dias || ' days')::interval
    where tipo = 'clan'
      and aceptado = true
      and status = 'pendiente'
      and (
        (retador_id = v_reto.challenger_team_id and retado_id = v_reto.challenged_team_id)
        or (retador_id = v_reto.challenged_team_id and retado_id = v_reto.challenger_team_id)
      );
end;
$$;

grant execute on function public.cerrar_clan_war(uuid) to authenticated;

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

-- Banner del Perfil Público de Jugador (migración 032) -- mismo
-- patrón que team-banners.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-banners',
  'player-banners',
  true,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "player_banners_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'player-banners');

create policy "player_banners_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'player-banners'
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
  v_user1 uuid;
  v_user2 uuid;
  v_user_ganador uuid;
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

-- ------------------------------------------------------------
-- Torneos Históricos (migración 029): competencias jugadas antes de
-- que existiera RemorApp, con el flujo de consentimiento: solo se
-- confirman (y solo entonces dan el bono de cortesía de MMR) cuando
-- todos los clanes vinculados a un equipo real aceptan que quede
-- público. Se integra visualmente con la Sala de la Fama en una fase
-- aparte -- por ahora es una página simple.
-- ------------------------------------------------------------
create table public.historical_tournaments (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha_aproximada date not null,
  servidor text not null check (servidor in ('america', 'europe', 'asia')),
  primer_lugar_nombre text not null,
  -- Nullable: solo se vincula si ese clan está registrado hoy en
  -- RemorApp -- muchos torneos históricos son de clanes que ya no
  -- existen o nunca se registraron acá.
  primer_lugar_team_id uuid references public.teams (id),
  segundo_lugar_nombre text not null,
  segundo_lugar_team_id uuid references public.teams (id),
  creado_por uuid not null references public.profiles (id),
  estado text not null default 'pendiente_consentimiento'
    check (estado in ('pendiente_consentimiento', 'confirmado', 'referencia_historica')),
  created_at timestamptz not null default now()
);

alter table public.historical_tournaments enable row level security;

-- Público: la página /torneos-historicos lista todos, sin importar el
-- estado -- un registro rechazado sigue siendo "referencia histórica
-- visible", tal como se pidió.
create policy "historical_tournaments_select_publico"
  on public.historical_tournaments for select
  using (true);

grant select on public.historical_tournaments to anon, authenticated;

-- Roster completo del torneo (incluye 1° y 2° lugar, que también
-- aparecen resumidos arriba en historical_tournaments -- acá es donde
-- vive el consentimiento de cada uno). nombre_clan es siempre texto
-- libre; team_id solo si el creador lo vinculó a un equipo real.
create table public.historical_tournament_participants (
  id uuid primary key default gen_random_uuid(),
  historical_tournament_id uuid not null references public.historical_tournaments (id) on delete cascade,
  nombre_clan text not null,
  team_id uuid references public.teams (id),
  -- null hasta que responda (o para siempre, si no está vinculado --
  -- no hay a quién pedirle consentimiento).
  consentimiento boolean,
  created_at timestamptz not null default now()
);

alter table public.historical_tournament_participants enable row level security;

create policy "historical_tournament_participants_select_publico"
  on public.historical_tournament_participants for select
  using (true);

grant select on public.historical_tournament_participants to anon, authenticated;

-- Sin política de insert/update para authenticated en ninguna de las
-- dos tablas -- la única forma de escribir es
-- registrar_torneo_historico() y responder_consentimiento_historico(),
-- security definer.

-- registrar_torneo_historico(): cualquier usuario puede registrar uno.
-- p_participantes es un jsonb con el RESTO de los clanes (sin contar
-- 1° y 2° lugar, que van por sus propios parámetros) -- cada elemento
-- es {"nombre_clan": "...", "team_id": "..." o null}. Si no queda
-- ningún participante vinculado a un equipo real, no hay nadie a
-- quien pedirle consentimiento -- el torneo se confirma directo.
create or replace function public.registrar_torneo_historico(
  p_nombre text,
  p_fecha_aproximada date,
  p_servidor text,
  p_primer_lugar_nombre text,
  p_primer_lugar_team_id uuid,
  p_segundo_lugar_nombre text,
  p_segundo_lugar_team_id uuid,
  p_participantes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo_id uuid;
  v_participante jsonb;
  v_hay_vinculados boolean;
begin
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El torneo necesita un nombre.';
  end if;
  if p_servidor not in ('america', 'europe', 'asia') then
    raise exception 'Ese servidor no es válido.';
  end if;
  if p_primer_lugar_nombre is null or trim(p_primer_lugar_nombre) = '' then
    raise exception 'Falta el nombre del primer lugar.';
  end if;
  if p_segundo_lugar_nombre is null or trim(p_segundo_lugar_nombre) = '' then
    raise exception 'Falta el nombre del segundo lugar.';
  end if;

  insert into public.historical_tournaments (
    nombre, fecha_aproximada, servidor,
    primer_lugar_nombre, primer_lugar_team_id,
    segundo_lugar_nombre, segundo_lugar_team_id,
    creado_por
  ) values (
    trim(p_nombre), p_fecha_aproximada, p_servidor,
    trim(p_primer_lugar_nombre), p_primer_lugar_team_id,
    trim(p_segundo_lugar_nombre), p_segundo_lugar_team_id,
    auth.uid()
  ) returning id into v_torneo_id;

  insert into public.historical_tournament_participants (historical_tournament_id, nombre_clan, team_id)
  values
    (v_torneo_id, trim(p_primer_lugar_nombre), p_primer_lugar_team_id),
    (v_torneo_id, trim(p_segundo_lugar_nombre), p_segundo_lugar_team_id);

  for v_participante in select * from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb))
  loop
    if trim(coalesce(v_participante->>'nombre_clan', '')) = '' then
      continue;
    end if;
    insert into public.historical_tournament_participants (historical_tournament_id, nombre_clan, team_id)
    values (
      v_torneo_id,
      trim(v_participante->>'nombre_clan'),
      nullif(v_participante->>'team_id', '')::uuid
    );
  end loop;

  select exists (
    select 1 from public.historical_tournament_participants
    where historical_tournament_id = v_torneo_id and team_id is not null
  ) into v_hay_vinculados;

  if not v_hay_vinculados then
    update public.historical_tournaments set estado = 'confirmado' where id = v_torneo_id;
  end if;

  return v_torneo_id;
end;
$$;

grant execute on function public.registrar_torneo_historico(text, date, text, text, uuid, text, uuid, jsonb) to authenticated;

-- responder_consentimiento_historico(): solo el dueño del equipo
-- vinculado a ese participante puntual. Rechazar deja el torneo como
-- 'referencia_historica' para siempre -- ningún bono para nadie, pero
-- el registro sigue visible. Aceptar solo confirma (+ bono, si
-- corresponde) cuando TODOS los vinculados ya aceptaron.
create or replace function public.responder_consentimiento_historico(p_participant_id uuid, p_acepta boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
  v_total_vinculados int;
  v_total_aceptados int;
begin
  select * into v_participante
  from public.historical_tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Ese participante no existe.';
  end if;
  if v_participante.team_id is null then
    raise exception 'Este participante no está vinculado a ningún equipo.';
  end if;

  if not exists (
    select 1 from public.teams where id = v_participante.team_id and owner_id = auth.uid()
  ) then
    raise exception 'Solo el dueño del equipo vinculado puede responder esta solicitud.';
  end if;

  select * into v_torneo
  from public.historical_tournaments
  where id = v_participante.historical_tournament_id
  for update;

  if v_torneo.estado <> 'pendiente_consentimiento' then
    raise exception 'Este torneo histórico ya fue resuelto.';
  end if;

  if v_participante.consentimiento is not null then
    raise exception 'Ya respondiste esta solicitud.';
  end if;

  update public.historical_tournament_participants
    set consentimiento = p_acepta
    where id = p_participant_id;

  if not p_acepta then
    update public.historical_tournaments set estado = 'referencia_historica' where id = v_torneo.id;
    return;
  end if;

  select count(*) into v_total_vinculados
  from public.historical_tournament_participants
  where historical_tournament_id = v_torneo.id and team_id is not null;

  select count(*) into v_total_aceptados
  from public.historical_tournament_participants
  where historical_tournament_id = v_torneo.id and team_id is not null and consentimiento = true;

  if v_total_vinculados = v_total_aceptados then
    update public.historical_tournaments set estado = 'confirmado' where id = v_torneo.id;

    if v_torneo.primer_lugar_team_id is not null then
      update public.teams set mmr = mmr + 25 where id = v_torneo.primer_lugar_team_id;
    end if;
    if v_torneo.segundo_lugar_team_id is not null then
      update public.teams set mmr = mmr + 10 where id = v_torneo.segundo_lugar_team_id;
    end if;
  end if;
end;
$$;

grant execute on function public.responder_consentimiento_historico(uuid, boolean) to authenticated;

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

    -- Migración 028: si quien abandona es el propio organizador y el
    -- torneo queda sin NINGÚN participante, se borra por completo en
    -- vez de quedar vacío y visible -- tournament_maps,
    -- tournament_results, organizer_points y bracket_matches caen en
    -- cascada solos (todos con on delete cascade hacia tournaments).
    -- Si queda algún otro participante, el torneo sigue existiendo
    -- tal cual -- esto no cambia ese caso.
    if v_torneo.creador_id = auth.uid()
       and not exists (select 1 from public.tournament_participants where tournament_id = v_torneo.id)
    then
      delete from public.tournaments where id = v_torneo.id;
    end if;

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

-- ------------------------------------------------------------
-- Sistema de Valentía y Responsabilidad -- Fase 1 (migración 024),
-- conectado a las funciones de Clan Wars. La restricción de "la
-- valentía solo se mueve entre clanes de liga similar" queda para un
-- ajuste posterior. responsabilidad_torneos tiene su columna creada
-- pero sin ninguna lógica que la mueva todavía -- eso se conecta con
-- las reglas de asistencia a torneos, en otra fase.
--
-- poco_confiable es el nombre interno de la columna -- el texto
-- visible para el usuario siempre es "Poco Responsable", nunca
-- "confiable"/"confiabilidad".
-- ------------------------------------------------------------
alter table public.teams add column valentia integer not null default 50 check (valentia >= 0 and valentia <= 100);

alter table public.profiles add column valentia_jugador integer not null default 50
  check (valentia_jugador >= 0 and valentia_jugador <= 100);
alter table public.profiles add column responsabilidad_cw integer not null default 100
  check (responsabilidad_cw >= 0 and responsabilidad_cw <= 100);
alter table public.profiles add column responsabilidad_torneos integer not null default 100
  check (responsabilidad_torneos >= 0 and responsabilidad_torneos <= 100);
alter table public.profiles add column poco_confiable boolean not null default false;

-- Sala de la Fama (migración 030): cuándo llegó por primera vez a
-- Gran Maestro -- liga_1v1 es GENERATED, solo refleja el estado
-- actual, no guarda historia. Solo puede escribirse sola (no está en
-- ninguna lista de columnas de UPDATE): el trigger de más abajo la
-- llena la primera vez que liga_1v1 pasa a ser 'Gran Maestro', y
-- nunca se vuelve a tocar después.
alter table public.profiles add column gran_maestro_alcanzado_en timestamptz;

create or replace function public.registrar_gran_maestro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.liga_1v1 = 'Gran Maestro' and new.gran_maestro_alcanzado_en is null then
    update public.profiles set gran_maestro_alcanzado_en = now() where id = new.id;
  end if;
  return new;
end;
$$;

create trigger after_update_profiles_gran_maestro
  after update of mmr_1v1 on public.profiles
  for each row execute function public.registrar_gran_maestro();

-- Suspensión administrada (migración 028): quién suspendió, por qué,
-- y cuándo -- visible para cualquier administrador en /admin, no solo
-- quien la aplicó. No son públicas (no están en el grant select de
-- arriba): la única forma de leerlas es admin_listar_usuarios(), y la
-- única forma de escribirlas es admin_suspender_usuario() (más abajo).
alter table public.profiles add column suspendido_por uuid references public.profiles (id);
alter table public.profiles add column suspendido_motivo text;
alter table public.profiles add column suspendido_en timestamptz;

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

-- ------------------------------------------------------------
-- Migración 033: Apariencia del equipo (7 paletas fijas), Jugador
-- temporal, y Ayuda (sugerencias de líder + reportes al staff).
-- ------------------------------------------------------------

alter table public.teams
  add column tema_equipo text not null default 'cian'
    check (tema_equipo in ('cian', 'purpura', 'esmeralda', 'ambar', 'rosa', 'carmesi', 'azul'));

revoke update on public.teams from authenticated;

grant update (description, logo_url, banner_url, tema_equipo) on public.teams to authenticated;

create table public.team_temp_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  nick_temporal text not null check (nick_temporal ~ '^[A-Za-z0-9_Øø]{3,13}$'),
  creado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  reemplazado_por uuid references public.profiles (id)
);

alter table public.team_temp_players enable row level security;

create policy "team_temp_players_select_publico"
  on public.team_temp_players for select
  using (true);

grant select on public.team_temp_players to anon, authenticated;

create or replace function public.crear_jugador_temporal(p_team_id uuid, p_nick_temporal text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede crear un jugador temporal.';
  end if;

  if p_nick_temporal !~ '^[A-Za-z0-9_Øø]{3,13}$' then
    raise exception 'El nick temporal debe tener entre 3 y 13 caracteres: letras, números, guion bajo y Ø/ø.';
  end if;

  insert into public.team_temp_players (team_id, nick_temporal, creado_por)
  values (p_team_id, p_nick_temporal, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.crear_jugador_temporal(uuid, text) to authenticated;

create or replace function public.reemplazar_jugador_temporal(p_temp_id uuid, p_nick text, p_unique_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temp record;
  v_perfil_id uuid;
begin
  select * into v_temp from public.team_temp_players where id = p_temp_id for update;
  if v_temp is null then
    raise exception 'Ese jugador temporal no existe.';
  end if;
  if v_temp.reemplazado_por is not null then
    raise exception 'Ese jugador temporal ya fue reemplazado.';
  end if;

  if not public.es_capitan_o_dueno(v_temp.team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede reemplazar un jugador temporal.';
  end if;

  select id into v_perfil_id from public.profiles where nick = p_nick and unique_id = p_unique_id;
  if v_perfil_id is null then
    raise exception 'No encontré ningún jugador con ese Nick#ID.';
  end if;

  update public.team_temp_players set reemplazado_por = v_perfil_id where id = p_temp_id;
end;
$$;

grant execute on function public.reemplazar_jugador_temporal(uuid, text, text) to authenticated;

create table public.sugerencias_lider (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  autor_id uuid not null references public.profiles (id),
  texto text not null check (char_length(texto) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.sugerencias_lider enable row level security;

create policy "sugerencias_lider_select_admin"
  on public.sugerencias_lider for select
  to authenticated
  using (public.is_admin());

create policy "sugerencias_lider_insert_propio"
  on public.sugerencias_lider for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and exists (select 1 from public.teams where owner_id = auth.uid())
  );

grant select, insert on public.sugerencias_lider to authenticated;

create table public.reportes_staff (
  id uuid primary key default gen_random_uuid(),
  reportado_por uuid not null references public.profiles (id),
  asunto text not null check (char_length(asunto) between 1 and 150),
  descripcion text not null check (char_length(descripcion) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.reportes_staff enable row level security;

create policy "reportes_staff_select_admin"
  on public.reportes_staff for select
  to authenticated
  using (public.is_admin());

create policy "reportes_staff_insert_propio"
  on public.reportes_staff for insert
  to authenticated
  with check (reportado_por = auth.uid());

grant select, insert on public.reportes_staff to authenticated;

-- ------------------------------------------------------------
-- Migración 034: Perfiles de juego agnósticos (hoy solo StarCraft II,
-- estructura lista para más juegos sin rehacer nada -- ver el
-- comentario largo en la migración).
-- ------------------------------------------------------------

create table public.catalogo_juegos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true
);

alter table public.catalogo_juegos enable row level security;

create policy "catalogo_juegos_select_publico"
  on public.catalogo_juegos for select
  using (true);

grant select on public.catalogo_juegos to anon, authenticated;

insert into public.catalogo_juegos (nombre, activo) values ('StarCraft II', true);

create table public.perfiles_juego (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  juego_id uuid not null references public.catalogo_juegos (id),
  datos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, juego_id)
);

alter table public.perfiles_juego enable row level security;

create policy "perfiles_juego_select_publico"
  on public.perfiles_juego for select
  using (true);

create policy "perfiles_juego_insert_propio"
  on public.perfiles_juego for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "perfiles_juego_update_propio"
  on public.perfiles_juego for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.perfiles_juego to anon, authenticated;
grant insert, update on public.perfiles_juego to authenticated;

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
