-- ============================================================
-- Migración 040: catálogo de estilos de bracket + fondos, con
-- preview antes de elegir.
--
-- 1) tournaments.estilo_bracket: layout de cajas y líneas
--    ('clasico' / 'esports' / 'starcraft_oficial'). El resto (colores,
--    líneas, franja, tipografía) es CSS puro, ver halcon.css.
-- 2) tournaments.fondo_bracket: fondo "galáctico" detrás de la llave,
--    independiente del estilo ('ninguno' / 'campo_estrellas' /
--    'nebulosa' / 'constelacion' / 'vortice'). Todos estáticos, sin
--    animación en bucle ni imágenes pesadas -- ver el comentario en
--    halcon.css junto a cada uno.
--
-- Sin cambios de grants: "grant update on public.tournaments to
-- authenticated" ya es un grant de tabla completa (no por columna,
-- a diferencia de profiles/teams), así que ya cubre estas dos
-- columnas nuevas -- la política "tournaments_update_organizador"
-- (creador_id = auth.uid()) sigue siendo la que de verdad limita
-- quién puede tocarlas.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.tournaments
  add column if not exists estilo_bracket text not null default 'clasico'
    check (estilo_bracket in ('clasico', 'esports', 'starcraft_oficial'));

alter table public.tournaments
  add column if not exists fondo_bracket text not null default 'ninguno'
    check (fondo_bracket in ('ninguno', 'campo_estrellas', 'nebulosa', 'constelacion', 'vortice'));
