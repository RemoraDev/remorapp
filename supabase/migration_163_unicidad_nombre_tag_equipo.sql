-- Migración 163: nombres y tags de clan no se pueden repetir -- a
-- pedido del usuario. Case-insensitive para el nombre (evita
-- "OldSchool" y "oldschool" coexistiendo, que se confunden en
-- cualquier buscador) -- el tag ya se normaliza a mayúsculas por el
-- check existente (tag ~ '^[A-Z]{3,6}$'), así que ahí alcanza con un
-- índice único directo. Ambos excluyen los equipos disueltos (where
-- not disuelto): un clan disuelto libera su nombre/tag para que otro
-- los pueda volver a usar, no se queda bloqueándolos para siempre.
--
-- ADVERTENCIA: al momento de escribir esto ya existen DOS equipos
-- activos (no disueltos) llamados "Gran Kefka" (tag TGTGGG, dueño
-- GodKefka#29378; y tag GODKEF, dueño Kefka#97964). El índice de
-- nombre de abajo va a fallar con un error de Postgres señalando
-- exactamente ese conflicto hasta que uno de los dos cambie de
-- nombre -- no hay forma de "forzar" la regla con datos que ya la
-- violan. El índice de tag no tiene este problema (no hay tags
-- repetidos hoy).
create unique index teams_tag_unico
  on public.teams (tag)
  where not disuelto;

create unique index teams_nombre_unico_ci
  on public.teams (lower(name))
  where not disuelto;
