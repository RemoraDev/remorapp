-- ============================================================
-- Migración 007: Fotos de perfil, banners de equipo y panel de
-- líder — hace que /perfil y /equipos/:tag se sientan más vivos.
--
-- No toca nada de lo que ya existe, solo agrega:
--   1) banner_url a teams.
--   2) Buckets de Storage: avatars y team-banners.
--   3) Política UPDATE para que el dueño edite su equipo (con un
--      trigger que bloquea tocar name/tag por esta vía, a propósito:
--      no se reabre la validación de unicidad de tag por ahora).
--   4) RPC quitar_miembro(): solo el dueño puede sacar gente de su
--      propio equipo, y no puede sacarse a sí mismo. Sin política
--      DELETE en team_members -- la única puerta es esta función,
--      mismo patrón que reportar_resultado() en la migración 006.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) banner_url en teams
-- ------------------------------------------------------------
alter table public.teams add column banner_url text;

-- ------------------------------------------------------------
-- 2) El dueño puede editar SU equipo (descripción, logo, banner).
--    name y tag quedan afuera a propósito: cambiarlos reabriría la
--    validación de unicidad de tag por servidor, que por ahora no
--    está pensada para revalidarse en una edición. El trigger de
--    abajo lo hace imposible aunque alguien arme el request a mano --
--    no basta con no mostrar el campo en el formulario.
-- ------------------------------------------------------------
create policy "teams_update_propio"
  on public.teams for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant update on public.teams to authenticated;

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
-- 3) quitar_miembro(): sacar a alguien del equipo. Solo el dueño,
--    solo de su propio equipo, y no puede sacarse a sí mismo (para
--    eso tendría que traspasar el liderazgo primero, algo que no
--    existe todavía). A propósito NO hay política DELETE en
--    team_members para authenticated -- la única forma de borrar una
--    fila es por acá, mismo patrón que reportar_resultado().
-- ------------------------------------------------------------
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
    raise exception 'Solo el dueño del equipo puede sacar miembros wn.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.quitar_miembro(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Storage: bucket para fotos de perfil (avatars) y para banners
--    de equipo (team-banners). Mismo patrón que team-logos: lectura
--    pública, subida solo a la carpeta propia (<user_id>/...).
-- ------------------------------------------------------------
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
