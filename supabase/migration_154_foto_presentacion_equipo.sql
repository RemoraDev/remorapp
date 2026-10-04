-- Migración 154: foto de presentación (vertical, 9:16) también para
-- equipos -- a pedido del usuario, mismo campo que ya tiene profiles
-- (foto_presentacion_url), ahora en teams. Se sube igual que logo_url/
-- banner_url (storage, update directo desde el cliente) -- las mismas
-- políticas RLS de teams que ya dejan a dueño/capitán actualizar logo
-- y banner alcanzan para esta columna nueva también, sin tocar nada
-- más.
alter table public.teams add column foto_presentacion_url text;
