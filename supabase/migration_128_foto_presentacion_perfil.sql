-- Migración 128: la tarjeta de presentación de la vitrina de jugador
-- en escritorio (migración 124) usaba por error avatar_url -- el mismo
-- avatar que se ve en el header y en todo el resto de la app. La foto
-- que se sube con el lápiz de esa tarjeta es otra cosa: una "foto de
-- presentación" propia de esta página, sin relación con el avatar
-- (que sigue viviendo, sin cambios, junto al banner y editable solo
-- desde Configuración). Null hasta que el usuario suba una -- mientras
-- tanto la tarjeta simplemente muestra el avatar normal como respaldo.

alter table public.profiles
  add column foto_presentacion_url text;

grant select (foto_presentacion_url) on public.profiles to anon, authenticated;
grant update (foto_presentacion_url) on public.profiles to authenticated;
