-- ------------------------------------------------------------
-- Migración 054: reemplaza el catálogo de 10 skins de avatar por 8
-- nuevas ("Electric"), todas construidas sobre la misma base técnica
-- corregida de "Fuego con electricidad" (feTurbulence + feOffset
-- animado con <animate> nativo + feComposite + feBlend +
-- feDisplacementMap, contenida exactamente en el grosor del anillo,
-- sin tocar la foto ni escaparse hacia afuera -- ver AvatarSkin.tsx).
-- Las 10 anteriores no vuelven: se reemplazan del todo, no se agregan
-- al lado.
-- ------------------------------------------------------------

-- Cualquier cuenta que ya tuviera una skin vieja activada queda sin
-- skin (null) en vez de con una referencia rota -- había que
-- resetearlo ANTES de borrar las filas viejas del catálogo, porque la
-- referencia todavía no tenía "on delete set null" (se agrega abajo).
update public.profiles set skin_avatar_activa = null where skin_avatar_activa is not null;

delete from public.catalogo_skins_avatar;

insert into public.catalogo_skins_avatar (clave, nombre, descripcion) values
  ('electric', 'Electric', 'Arco eléctrico naranja con núcleo azul -- distorsión real de turbulencia SVG.'),
  ('violet_electric', 'Violet Electric', 'La misma turbulencia eléctrica en violeta, con núcleo blanco brillante.'),
  ('cyan_electric', 'Cyan Electric', 'Turbulencia eléctrica en cian intenso, con núcleo blanco para no confundirse con el acento del sitio.'),
  ('fire', 'Fire', 'Turbulencia rápida y caótica en rojo, naranja y amarillo -- llamas reales.'),
  ('blue_fire', 'Blue Fire', 'La misma turbulencia rápida de Fire, en azul y blanco -- fuego frío.'),
  ('niebla', 'Niebla', 'Turbulencia lenta y de baja frecuencia, casi imperceptible, en blancos y grises translúcidos.'),
  ('frost', 'Frost', 'Turbulencia lenta con más definición que Niebla, celeste y blanco con un matiz cristalino.'),
  ('solar', 'Solar', 'Turbulencia media en dorado y blanco intenso, mezclada en modo screen para un resplandor solar real.');

-- Para que un futuro cambio de catálogo (como este mismo) no vuelva a
-- exigir el reseteo manual de arriba: de ahora en adelante, si se
-- borra una skin del catálogo, cualquier perfil que la tuviera activa
-- simplemente queda sin skin en vez de bloquear el borrado.
alter table public.profiles drop constraint if exists profiles_skin_avatar_activa_fkey;
alter table public.profiles
  add constraint profiles_skin_avatar_activa_fkey
  foreign key (skin_avatar_activa) references public.catalogo_skins_avatar (id) on delete set null;
