-- ------------------------------------------------------------
-- Migración 110: Race War -- efecto visual de brillo neón, elegible
-- por el organizador (aplicable a las 3 razas o solo a la que va
-- ganando, con 2-3 variantes de color). Se guarda en guerra_razas
-- mismo, no hace falta ninguna función nueva: la política de update ya
-- existente (guerra_razas_update_organizador, "creado_por = auth.uid()",
-- sin restricción de columna) ya cubre estas dos columnas nuevas, igual
-- que ya cubre puntos e imágenes.
-- ------------------------------------------------------------

alter table public.guerra_razas
  add column efecto_neon text not null default 'ninguno' check (efecto_neon in ('ninguno', 'ganador', 'todas')),
  add column efecto_neon_color text not null default 'cyan' check (efecto_neon_color in ('cyan', 'magenta', 'dorado'));
