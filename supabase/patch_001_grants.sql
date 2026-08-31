-- ============================================================
-- Parche 001: privilegios base sobre las tablas de torneos.
--
-- Por qué hace falta: activar RLS y crear políticas no alcanza.
-- En Postgres, antes de evaluar cualquier política, el rol que
-- hace la consulta (anon o authenticated) necesita el permiso
-- base sobre la tabla (GRANT). Al crear las tablas desde el SQL
-- Editor, Supabase no las hereda automáticamente. Las políticas
-- de RLS siguen filtrando qué filas se ven/escriben; esto solo
-- abre la puerta para que esas políticas se lleguen a evaluar.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant select on public.maps to anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant insert, update on public.tournaments to authenticated;

grant select on public.tournament_maps to anon, authenticated;
grant insert on public.tournament_maps to authenticated;

grant select on public.tournament_participants to anon, authenticated;
grant insert on public.tournament_participants to authenticated;

grant select on public.tournament_results to anon, authenticated;
grant insert on public.tournament_results to authenticated;

-- organizer_points no lleva grant de insert para nadie: la única
-- forma de escribir ahí es el trigger generar_puntos_organizador,
-- que corre como security definer y no necesita este permiso.
grant select on public.organizer_points to authenticated;
