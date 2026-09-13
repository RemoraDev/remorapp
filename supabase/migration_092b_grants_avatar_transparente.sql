-- ------------------------------------------------------------
-- Corrección sobre la migración 092: profiles usa permisos acotados
-- por columna (cada columna nueva necesita su propio grant explícito,
-- ver borde_basico_activo/borde_grosor/borde_header como ejemplo) --
-- la migración 092 agregó avatar_transparente pero se olvidó de
-- otorgarle permisos, lo que rompía CUALQUIER lectura de profiles que
-- incluyera esa columna (permission denied for table profiles).
-- ------------------------------------------------------------

grant select (avatar_transparente) on public.profiles to anon, authenticated;
grant update (avatar_transparente) on public.profiles to authenticated;
