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
  perfil_tipo text check (perfil_tipo in ('jugador', 'caster', 'lider_clan')),
  es_admin boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cualquiera puede leer perfiles (nombre, tipo, si es admin);
-- no hay datos sensibles acá.
create policy "profiles_select_publico"
  on public.profiles for select
  using (true);

-- Cada usuario puede editar su propia fila (nombre, perfil_tipo,
-- elegido en /perfil). es_admin queda protegido aparte por el
-- trigger de abajo: sigue activándose solo a mano en este editor.
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
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
  end if;
  return new;
end;
$$;

create trigger before_update_profiles_proteger_admin
  before update on public.profiles
  for each row execute function public.proteger_es_admin();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, perfil_tipo)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'perfil_tipo'
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

create policy "tournaments_insert_propio"
  on public.tournaments for insert
  to authenticated
  with check (creador_id = auth.uid());

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
  user_id uuid not null references auth.users (id),
  inscrito_en timestamptz not null default now(),
  unique (tournament_id, user_id)
);

alter table public.tournament_participants enable row level security;

create policy "tournament_participants_select_publico"
  on public.tournament_participants for select
  using (true);

create policy "tournament_participants_insert_propio"
  on public.tournament_participants for insert
  to authenticated
  with check (user_id = auth.uid());

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

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;
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

-- ============================================================
-- Después de correr todo lo de arriba, activa tu propio usuario
-- como administrador (cambia el email):
--
--   update public.profiles set es_admin = true
--   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
-- ============================================================
