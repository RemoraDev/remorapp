-- Migración 158: links de Stream para equipos -- a pedido del usuario,
-- reemplaza la caja de "foto de presentación" del clan (migración 154,
-- "creada por error") por una tarjeta de Stream igual a la que ya
-- tiene Mi perfil (profiles.links_transmision), ahora en teams. Mismo
-- tipo de columna, mismo criterio de edición rápida (3 plataformas
-- fijas: Twitch/Discord/YouTube).
alter table public.teams
  add column links_transmision jsonb not null default '[]'::jsonb;

-- teams tiene SELECT general (no por columna, ver migración 157) -- el
-- UPDATE sí es por columna, así que esta sí necesita su propio grant.
grant update (links_transmision) on public.teams to authenticated;
