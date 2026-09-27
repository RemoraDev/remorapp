-- Migración 122: a estado_presencia (migración 121) le faltó el grant
-- de SELECT -- una columna agregada con ALTER TABLE no hereda el grant
-- de select ya existente sobre la tabla, hace falta uno explícito por
-- columna (mismo motivo por el que ya existen grants sueltos para
-- borde_header, avatar_transparente, skin_avatar_activa, etc. más
-- arriba en este archivo). Sin esto, cualquier select que la mencione
-- fallaba con "permission denied for table profiles".

grant select (estado_presencia) on public.profiles to anon, authenticated;
