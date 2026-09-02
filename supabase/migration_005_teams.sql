-- ============================================================
-- Migración 005: Equipos (Fase 2 del módulo de Equipos/Clanes)
-- — crear equipo, buscar/unirse, perfil público del equipo.
--
-- No toca nada de lo que ya existe (profiles, tournaments, etc.),
-- solo agrega tablas nuevas.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) teams
-- ------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 20),
  -- 3-4 letras mayúsculas, sin números ni símbolos.
  tag text not null check (tag ~ '^[A-Z]{3,4}$'),
  -- En qué servidores participa el equipo (puede ser más de uno).
  -- El check de abajo obliga a que tenga al menos 1 y que cada valor
  -- sea uno de los 3 servidores válidos (mismos que profiles.sc2_region).
  sc2_regions text[] not null check (
    cardinality(sc2_regions) >= 1
    and sc2_regions <@ array['america', 'europe', 'asia']::text[]
  ),
  description text,
  logo_url text,
  is_public boolean not null default true,
  -- 6 caracteres, se genera solo (ver trigger más abajo) si no se manda.
  invite_code text unique,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;

-- Cualquiera puede leer un equipo por id/tag exacto (mismo modelo que
-- los torneos privados: "solo por link directo"). El listado de
-- búsqueda de /equipos filtra is_public = true en el propio query del
-- frontend, no acá.
create policy "teams_select_publico"
  on public.teams for select
  using (true);

-- Para crear un equipo hace falta: ser el dueño que se está mandando
-- a sí mismo, tener el perfil validado, y no estar suspendido. Los
-- dos primeros ya se piden en pantalla, pero quedan reforzados acá
-- para que no sea posible saltárselos.
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

-- Genera el invite_code (6 caracteres, sin 0/O/1/I/L para que no se
-- confundan al escribirlo a mano) si no viene desde la app, y
-- verifica que no se repita con ninguno ya asignado.
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

-- Validación crítica: el tag tiene que ser único POR SERVIDOR, no en
-- general -- "TL" puede existir en america y también (otro equipo) en
-- europe, pero no dos equipos con "TL" ambos en america. Se revisa la
-- intersección real de arrays (sc2_regions && new.sc2_regions), no una
-- restricción simple de columna, que no podría expresar esto. Esto es
-- el respaldo a nivel de base -- el frontend hace el mismo chequeo
-- antes para mostrar el mensaje "Ese tag ya está en uso en
-- [servidor]" al toque, pero esto es lo que de verdad lo hace
-- imposible aunque dos personas manden la misma petición al mismo
-- tiempo.
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
    raise exception 'Ese tag ya está pillado en uno de esos servidores wn, prueba otro.';
  end if;

  return new;
end;
$$;

create trigger before_upsert_teams_validar_tag
  before insert or update of tag, sc2_regions on public.teams
  for each row execute function public.validar_tag_unico_por_servidor();

-- ------------------------------------------------------------
-- 2) team_members
--
-- user_id es la PRIMARY KEY (no team_id+user_id): así "un jugador
-- pertenece a un solo equipo" queda garantizado por el esquema mismo,
-- no por una regla que alguien podría saltarse -- una segunda fila
-- para el mismo usuario, en el equipo que sea, choca con la PK y
-- Postgres la rechaza sola.
-- ------------------------------------------------------------
create table public.team_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Por ahora solo 'owner' o 'jugador' -- el resto de roles llegan en
  -- la Fase 3.
  roles text[] not null default array['jugador']::text[] check (
    roles <@ array['owner', 'jugador']::text[]
  ),
  joined_at timestamptz not null default now()
);

alter table public.team_members enable row level security;

-- Público: hace falta para mostrar la lista de miembros en el perfil
-- del equipo.
create policy "team_members_select_publico"
  on public.team_members for select
  using (true);

-- Unirse uno mismo como 'jugador' (por búsqueda o por código). El rol
-- 'owner' nunca se puede pedir por acá -- lo pone solo el trigger de
-- abajo cuando se crea el equipo, no es algo que el propio usuario
-- pueda mandar en la petición.
create policy "team_members_insert_propio"
  on public.team_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and roles = array['jugador']::text[]
    and not public.esta_suspendido()
  );

-- Al crear un equipo, mete solo (sin que la app tenga que hacer una
-- segunda petición aparte, que podría fallar y dejar el equipo sin
-- dueño en team_members) la fila del dueño con rol 'owner'. security
-- definer porque el rol 'owner' está afuera de lo que
-- team_members_insert_propio deja mandar a un usuario común.
create or replace function public.crear_membresia_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, roles)
  values (new.id, new.owner_id, array['owner']::text[]);
  return new;
end;
$$;

create trigger after_insert_teams_owner
  after insert on public.teams
  for each row execute function public.crear_membresia_owner();

-- ------------------------------------------------------------
-- 3) Privilegios base (ver por qué en la migración 001: activar RLS
--    y las políticas no alcanza, Postgres también exige el permiso a
--    nivel de tabla antes de evaluar cualquier política).
-- ------------------------------------------------------------
grant select on public.teams to anon, authenticated;
grant insert on public.teams to authenticated;

grant select on public.team_members to anon, authenticated;
grant insert on public.team_members to authenticated;

-- ------------------------------------------------------------
-- 4) Storage: bucket para los logos de equipo.
--
-- file_size_limit en bytes (2 MB) y allowed_mime_types quedan
-- reforzados acá también -- no solo validados en el input del
-- formulario. Cada archivo se sube a la carpeta <user_id>/... propia:
-- la política de subida exige que el primer segmento de la ruta sea
-- el uid de quien sube, así nadie puede escribir en la carpeta de
-- otro.
-- ------------------------------------------------------------
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
