-- ============================================================
-- Migración 004: panel de administración
-- (suspensión de cuentas, cambio de rol por admin, listado de
-- usuarios con correo, confirmar torneos desde /admin).
--
-- profiles ya tiene datos reales — igual que en la migración 003,
-- esto agrega columnas a una tabla existente sin romper filas.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) suspendido: false por defecto, no rompe filas existentes.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists suspendido boolean not null default false;

-- ------------------------------------------------------------
-- 2) email: no vivía en profiles (vive en auth.users, que no es
--    consultable desde el cliente). Se agrega acá solo para que
--    el panel de admin pueda mostrarlo — ver el candado de acceso
--    en el punto 3, porque por defecto cualquier columna nueva de
--    una tabla con "select using (true)" quedaría visible para
--    cualquiera, y el correo no debería.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists email text;

-- Backfill para las cuentas que ya existen (esto sí puede leer
-- auth.users porque corre con privilegios de este editor, no como
-- un usuario común de la API).
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- A partir de ahora, cada cuenta nueva guarda su email también acá.
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

  insert into public.profiles (id, nombre, perfil_tipo, unique_id, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'perfil_tipo',
    v_unique_id,
    new.email
  );
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Candado del correo: profiles sigue siendo legible por
--    cualquiera (nick, país, etc. son públicos a propósito), pero
--    la columna email específicamente se le saca el permiso a
--    anon/authenticated a nivel de columna (esto es distinto de
--    RLS, que es por fila: esto es Postgres bloqueando la columna
--    entera, sin importar qué política de RLS diga). Nadie puede
--    hacer profiles.select('email') desde el cliente después de
--    esto — ni siquiera un admin: para eso está la función de
--    abajo, que sí puede leerlo porque corre como security definer.
-- ------------------------------------------------------------
revoke select (email) on public.profiles from anon, authenticated;

-- ------------------------------------------------------------
-- 4) Función para el listado de /admin: junta todo lo que
--    necesita la pestaña de Usuarios (incluido el correo) y
--    verifica que quien llama sea admin ANTES de devolver nada.
--    Como es security definer, puede leer email aunque el rol
--    que llama no tenga permiso directo sobre esa columna.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5) Un admin puede actualizar el perfil de cualquiera (cambiar
--    perfil_tipo, suspender). es_admin y unique_id siguen
--    protegidos por los triggers que ya existían (proteger_es_admin
--    y proteger_unique_id): esta política nueva no los toca, sigue
--    sin ser posible cambiarlos desde la app aunque seas admin.
-- ------------------------------------------------------------
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 6) Una cuenta suspendida no puede crear torneos ni inscribirse
--    a ninguno — bloqueado acá, a nivel de base de datos, no solo
--    escondiendo el botón en la app.
-- ------------------------------------------------------------
create or replace function public.esta_suspendido()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select suspendido from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "tournaments_insert_propio" on public.tournaments;
create policy "tournaments_insert_propio"
  on public.tournaments for insert
  to authenticated
  with check (creador_id = auth.uid() and not public.esta_suspendido());

drop policy if exists "tournament_participants_insert_propio" on public.tournament_participants;
create policy "tournament_participants_insert_propio"
  on public.tournament_participants for insert
  to authenticated
  with check (user_id = auth.uid() and not public.esta_suspendido());
