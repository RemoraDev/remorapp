-- ============================================================
-- Parche 002: permite que cada usuario edite su propia fila en
-- profiles (nombre, perfil_tipo) desde /perfil.
--
-- Hasta ahora profiles no tenía ninguna política de UPDATE: la
-- idea original era que es_admin solo se tocara a mano desde el
-- SQL Editor. Con "Mi Perfil" los usuarios necesitan poder
-- guardar su propio perfil_tipo, así que se agrega una política
-- de UPDATE acotada a la propia fila, más un trigger que impide
-- que ese mismo camino (la API, no el SQL Editor) toque es_admin.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

grant update on public.profiles to authenticated;

create policy "profiles_update_propio"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- current_setting('request.jwt.claims', true) solo existe cuando la
-- consulta llega a través de la API de Supabase (con sesión anon o
-- authenticated); es null cuando se corre directo en el SQL Editor.
-- Así, este trigger bloquea cambios a es_admin que vengan de la app,
-- pero no interfiere con activarlo a mano como se hizo al principio.
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
