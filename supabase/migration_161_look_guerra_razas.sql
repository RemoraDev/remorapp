-- Migración 161: "Look" para Guerra de Razas -- mismo catálogo de
-- fondos clásicos + imágenes subidas que ya usa la sala de lineup de
-- Clan War (catalogo_fondos_lineup), más un efecto de clima nuevo
-- (rayos/lluvia/soleado/nevado) que se superpone sobre el fondo
-- elegido. Solo Fondo y Efectos -- a diferencia de Clan War, acá no
-- hay Estructura ni Dimensión. guerra_razas ya tiene grant de update
-- de tabla completa (no por columna, ver "grant insert, update on
-- public.guerra_razas"), así que estas columnas nuevas no necesitan
-- un grant aparte -- y la RLS existente (creado_por = auth.uid())
-- ya resuelve "Look solo lo ve/edita el creador".
alter table public.guerra_razas
  add column fondo_lineup text not null default 'ninguno'
    check (fondo_lineup in ('ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego')),
  add column fondo_lineup_imagen_id uuid references public.catalogo_fondos_lineup (id) on delete set null,
  add column efecto_clima text not null default 'ninguno'
    check (efecto_clima in ('ninguno', 'rayos', 'lluvia', 'soleado', 'nevado'));
