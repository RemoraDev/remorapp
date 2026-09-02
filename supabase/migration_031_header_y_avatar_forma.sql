-- ============================================================
-- Migración 031: simplificación del header (menú desplegable del
-- avatar) y forma de avatar configurable.
--
-- El menú desplegable en sí es puramente de frontend (no necesita
-- nada nuevo en la base: ya expone todo lo que muestra). Lo único que
-- agrega esta migración es la preferencia de forma de avatar:
--
--   avatar_forma: 'cuadrado' o 'redondo', default 'cuadrado'. El
--   avatar del usuario (header, listas de participantes, miembros de
--   equipo, /perfil) respeta esta preferencia -- los logos de equipo
--   NO se ven afectados, son un concepto aparte.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.profiles
  add column if not exists avatar_forma text not null default 'cuadrado'
    check (avatar_forma in ('cuadrado', 'redondo'));

-- Se suma a la lista pública de SELECT -- hace falta para que el
-- avatar de OTROS jugadores (miembros de equipo, participantes de
-- torneo) se muestre con la forma que ellos eligieron, no la propia.
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, avatar_forma, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable,
  gran_maestro_alcanzado_en
) on public.profiles to anon, authenticated;

-- El usuario puede cambiar su propia forma de avatar igual que el
-- resto de sus datos de identidad -- mismo grant de columnas editables
-- de la migración 028, sumando avatar_forma.
revoke update on public.profiles from authenticated;

grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, avatar_forma
) on public.profiles to authenticated;
