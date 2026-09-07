-- ------------------------------------------------------------
-- Migración 068: 3 nuevos marcos de prestigio (Diamante/Master/Gran
-- Master), en las dos versiones -- simple (catalogo_bordes_basicos,
-- gratis para cualquier cuenta) y con efectos (catalogo_skins_avatar,
-- misma técnica "Electric" de la migración 054, con la estrella en la
-- esquina como marca distintiva -- ver AvatarSkin.tsx). También se
-- agrega la posibilidad de que el dueño/admin renombre cualquier
-- entrada de los dos catálogos desde el Panel de Administración -- no
-- existía ninguna política de update para ninguno de los dos hasta
-- ahora.
-- ------------------------------------------------------------
insert into public.catalogo_bordes_basicos (nombre, color_hex) values
  ('Marco Diamante', '#38bdf8'),
  ('Marco Master', '#c026d3'),
  ('Marco Gran Master', '#f97316');

-- clave en inglés/snake_case (mismo criterio que las 8 anteriores),
-- coincide 1 a 1 con SkinAvatarClave y CONFIG_ELECTRICO en
-- AvatarSkin.tsx -- no alcanza con insertar la fila sola, el frontend
-- necesita su propia entrada para saber cómo dibujarla.
insert into public.catalogo_skins_avatar (clave, nombre, descripcion) values
  ('diamante', 'Marco Diamante', 'Turbulencia eléctrica celeste, con una estrella en la esquina -- rango Diamante.'),
  ('master', 'Marco Master', 'Turbulencia eléctrica magenta, con una estrella en la esquina -- rango Master.'),
  ('gran_master', 'Marco Gran Master', 'Turbulencia eléctrica naranja intensa en modo screen, con estrella -- rango Gran Master.');

create policy "catalogo_bordes_basicos_update_admin"
  on public.catalogo_bordes_basicos for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update (nombre) on public.catalogo_bordes_basicos to authenticated;

create policy "catalogo_skins_avatar_update_admin"
  on public.catalogo_skins_avatar for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update (nombre) on public.catalogo_skins_avatar to authenticated;
