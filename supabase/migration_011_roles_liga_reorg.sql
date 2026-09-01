-- ============================================================
-- Migración 011: ajustes de perfil y equipo.
--
--   1) Nick: 3-16 -> 3-13 caracteres, agregando Ø/ø como válidos.
--   2) Tag de equipo: 3-4 -> 3-6 caracteres.
--   3) perfil_tipo deja de elegirse a mano: por defecto 'jugador',
--      y pasa solo a 'lider_clan' cuando alguien crea un equipo
--      (extiende crear_membresia_owner(), no crea nada nuevo).
--      'caster' sale del todo de perfil_tipo -- ahora es la columna
--      independiente es_caster (alguien puede ser líder de clan Y
--      caster al mismo tiempo, no son excluyentes).
--   4) liga: nueva columna opcional en profiles.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Nick: 3-13 caracteres, agrega Ø/ø. Se busca y elimina el check
--    constraint existente por su definición (no por nombre fijo,
--    para no depender de cómo Postgres lo haya nombrado solo).
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%nick%'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;

-- Nicks que ya existían y superan los 13 caracteres (o usan algo fuera
-- del formato viejo) quedarían rotos por este constraint nuevo -- si
-- eso pasa, este ALTER falla con un error de Postgres bien claro
-- (constraint violation) en vez de aplicarse a medias.
alter table public.profiles add constraint profiles_nick_check
  check (nick is null or nick ~ '^[A-Za-z0-9_Øø]{3,13}$');

-- ------------------------------------------------------------
-- 2) Tag de equipo: 3-6 caracteres (letras mayúsculas).
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.teams'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tag%'
  loop
    execute format('alter table public.teams drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.teams add constraint teams_tag_check
  check (tag ~ '^[A-Z]{3,6}$');

-- ------------------------------------------------------------
-- 3) perfil_tipo: 'jugador' por defecto, 'caster' deja de ser un
--    valor válido (pasa a ser la columna es_caster, independiente).
-- ------------------------------------------------------------

-- Nadie pierde su estado de caster por este cambio: si ya tenían
-- perfil_tipo = 'caster', quedan con es_caster = true y perfil_tipo
-- vuelve a 'jugador' (el valor por defecto de ahora en más).
alter table public.profiles add column es_caster boolean not null default false;

update public.profiles set es_caster = true where perfil_tipo = 'caster';
update public.profiles set perfil_tipo = 'jugador' where perfil_tipo = 'caster' or perfil_tipo is null;

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%perfil_tipo%'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.profiles alter column perfil_tipo set default 'jugador';
alter table public.profiles alter column perfil_tipo set not null;
alter table public.profiles add constraint profiles_perfil_tipo_check
  check (perfil_tipo in ('jugador', 'lider_clan'));

-- handle_new_user() ya no lee perfil_tipo de los metadatos del
-- registro -- nadie lo manda desde /register, así que el default de
-- la columna ('jugador') se encarga solo.
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

-- Crear un equipo te vuelve líder de clan automáticamente -- mismo
-- trigger que ya existía para meter la fila de 'owner' en
-- team_members, extendido con esta única línea nueva. No toca
-- es_caster: son independientes.
create or replace function public.crear_membresia_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, roles)
  values (new.id, new.owner_id, array['owner']::text[]);

  update public.profiles set perfil_tipo = 'lider_clan' where id = new.owner_id;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 4) liga: rango competitivo del jugador, opcional.
-- ------------------------------------------------------------
alter table public.profiles add column liga text
  check (liga is null or liga in (
    'Bronce 3', 'Bronce 2', 'Bronce 1',
    'Plata 3', 'Plata 2', 'Plata 1',
    'Oro 3', 'Oro 2', 'Oro 1',
    'Platino 3', 'Platino 2', 'Platino 1',
    'Diamante 3', 'Diamante 2', 'Diamante 1',
    'Master 3', 'Master 2', 'Master 1',
    'Gran Maestro'
  ));
