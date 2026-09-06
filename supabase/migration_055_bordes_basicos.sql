-- ------------------------------------------------------------
-- Migración 055: catálogo de bordes básicos de avatar -- 15 colores
-- lisos, sin ningún filtro ni animación, con grosor editable. A
-- diferencia de las skins de efectos (migraciones 052/054, exclusivas
-- del dueño de la plataforma), este catálogo es gratuito: cualquier
-- cuenta puede elegir uno desde ya.
--
-- Es independiente de las skins de efectos: un perfil puede tener las
-- dos columnas configuradas a la vez, pero solo una se ve -- si hay
-- una skin de efectos activa, esa tiene prioridad visual (se resuelve
-- en el frontend, AvatarSkin.tsx -- ver comentario ahí).
-- ------------------------------------------------------------

create table public.catalogo_bordes_basicos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  color_hex text not null
);

alter table public.catalogo_bordes_basicos enable row level security;

create policy "catalogo_bordes_basicos_select_publico"
  on public.catalogo_bordes_basicos for select
  using (true);

grant select on public.catalogo_bordes_basicos to anon, authenticated;

-- Paleta de 15: primarios, pasteles, oscuros y metálicos.
insert into public.catalogo_bordes_basicos (nombre, color_hex) values
  ('Rojo', '#ef4444'),
  ('Naranja', '#f97316'),
  ('Amarillo', '#eab308'),
  ('Verde', '#22c55e'),
  ('Azul', '#3b82f6'),
  ('Púrpura', '#a855f7'),
  ('Rosa pastel', '#fbcfe8'),
  ('Celeste pastel', '#bae6fd'),
  ('Menta pastel', '#bbf7d0'),
  ('Lavanda pastel', '#ddd6fe'),
  ('Negro', '#18181b'),
  ('Gris grafito', '#3f3f46'),
  ('Dorado', '#d4af37'),
  ('Plateado', '#c0c0c0'),
  ('Bronce', '#cd7f32');

alter table public.profiles
  add column borde_basico_activo uuid references public.catalogo_bordes_basicos (id) on delete set null;

alter table public.profiles
  add column borde_grosor integer not null default 3 check (borde_grosor between 1 and 8);

-- Públicas para cualquier cuenta (a diferencia de skin_avatar_activa,
-- que sigue siendo privada): este es el nivel gratuito de
-- personalización, se tiene que ver en cualquier perfil que lo elija.
grant select (borde_basico_activo, borde_grosor) on public.profiles to anon, authenticated;

-- Autoservicio directo, mismo patrón que avatar_forma: sin RPC, la
-- llave foránea y el check constraint ya validan todo lo que hace
-- falta.
grant update (borde_basico_activo, borde_grosor) on public.profiles to authenticated;
