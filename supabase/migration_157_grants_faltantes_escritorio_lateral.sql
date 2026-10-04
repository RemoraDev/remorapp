-- Migración 157: corrige permisos faltantes de las migraciones 154 y
-- 156. profiles usa grants por columna (no "grant select on
-- profiles" general) -- cada columna nueva necesita su propio grant
-- explícito, y se me pasó agregarlo para escritorio_lateral_url.
-- teams en cambio tiene el select general, pero el UPDATE sí es por
-- columna (ver la migración original) -- ahí se me pasaron DOS
-- columnas: foto_presentacion_url (migración 154) y
-- escritorio_lateral_url (migración 156), ninguna de las dos había
-- quedado en la lista de columnas actualizables.
grant select (escritorio_lateral_url) on public.profiles to anon, authenticated;
grant update (escritorio_lateral_url) on public.profiles to authenticated;

grant update (description, logo_url, banner_url, tema_equipo, foto_presentacion_url, escritorio_lateral_url)
  on public.teams to authenticated;
