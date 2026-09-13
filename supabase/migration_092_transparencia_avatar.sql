-- ------------------------------------------------------------
-- Migración 092: transparencia real en las subidas de imagen.
--
-- 1) El recorte interactivo (react-easy-crop + canvas, ver
--    src/lib/imageCrop.ts) ya exportaba PNG cuando el archivo
--    original era PNG -- lo único que perdía la transparencia real
--    era un archivo WebP con canal alfa, que se aplanaba a JPEG.
--    Ahora WebP también se conserva en su propio formato. Este cambio
--    es puramente de frontend, no necesita nada nuevo acá en la base.
-- 2) profiles.avatar_transparente (esta migración): marca si el
--    avatar ACTUAL del usuario quedó con transparencia real (se
--    calcula en el navegador al recortar, leyendo el canal alfa del
--    canvas -- ver recortarImagenDesdeArea() en imageCrop.ts). El
--    frontend la usa para apagar automáticamente el borde de color/
--    skin de efectos (los que ya existen en Mi perfil) mientras el
--    avatar activo sea transparente, para no rodear una forma
--    transparente con un anillo sólido.
-- ------------------------------------------------------------

alter table public.profiles
  add column avatar_transparente boolean not null default false;

-- profiles usa permisos acotados por columna (mismo patrón que
-- borde_basico_activo/borde_grosor/borde_header): toda columna nueva
-- necesita su propio grant explícito, si no ninguna lectura que la
-- incluya funciona.
grant select (avatar_transparente) on public.profiles to anon, authenticated;
grant update (avatar_transparente) on public.profiles to authenticated;
