-- ============================================================
-- Migración 032: Perfil Público de Jugador (/jugador/:nick/:uniqueId).
--
-- Separa dos conceptos que hoy viven mezclados en una sola pantalla:
-- "editar mis datos" (formulario privado, sigue en /perfil) y "perfil
-- público" (vitrina de lectura, nueva página, visible para cualquiera
-- con o sin sesión). Lo único que hacía falta agregar en la base es el
-- banner del jugador -- todo lo demás que muestra la página nueva
-- (bio, liga/mmr/nivel, valentía/responsabilidad, títulos, equipo
-- actual) ya era público de antes.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.profiles add column if not exists banner_url text;

-- Mismo patrón que team-banners (migración de Equipos): bucket
-- público de solo lectura, subida restringida a la propia carpeta
-- (auth.uid()) del usuario dueño del archivo.
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

-- banner_url se suma a la lista pública de SELECT y a la de columnas
-- editables por el propio dueño (mismo grant de columnas editables de
-- la migración 031, sumando banner_url).
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, avatar_forma,
  banner_url, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

revoke update on public.profiles from authenticated;

grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, avatar_forma, banner_url, bio
) on public.profiles to authenticated;
