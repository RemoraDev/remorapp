-- ============================================================
-- Migración 035: tres correcciones y una función nueva.
--
--   1) y 2) son solo de frontend (reorganizar Títulos en el Panel de
--      control, ocultar "Crear cuenta" con sesión iniciada) -- no
--      necesitan nada acá.
--   3) profiles.links_transmision: jsonb con un array de objetos
--      {plataforma, url}, para que el jugador liste varios canales
--      (Twitch, YouTube, Kick, etc.). Sin check constraint de forma,
--      mismo criterio que perfiles_juego -- lo valida el frontend.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.profiles
  add column if not exists links_transmision jsonb not null default '[]'::jsonb;

revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, avatar_forma,
  banner_url, bio, links_transmision,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

revoke update on public.profiles from authenticated;

grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, avatar_forma, banner_url, bio, links_transmision
) on public.profiles to authenticated;
