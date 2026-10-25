-- ============================================================
-- Migración 217: skins de llaves
--
-- A pedido del usuario: la llave "se ve simple" y la app la van a usar
-- streamers, así que necesita diseños que luzcan sin costar frames.
-- Suma 3 valores nuevos a estilo_bracket, que es la dimensión que ya
-- existía para el aspecto de las cajas (migración 040) y que estaba
-- en la base pero sin selector en la interfaz:
--
--   tactico  -- HUD militar: esquinas biseladas, rieles de acento
--   neon     -- VS de juego de pelea: negro profundo y filo encendido
--   cristal  -- vidrio esmerilado con labio de luz arriba
--
-- Los 3 se pintan una sola vez (sin animación por frame) justamente
-- para no robarle rendimiento a quien esté transmitiendo con el juego,
-- OBS y Discord abiertos al mismo tiempo.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- El check de la migración 040 se declaró en línea, así que Postgres le
-- puso un nombre automático. En vez de adivinarlo, se busca cualquier
-- check de la tabla que mencione la columna y se lo borra -- así esto
-- funciona igual si el nombre cambió o si ya se corrió antes.
do $$
declare
  nombre_constraint text;
begin
  for nombre_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tournaments'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%estilo_bracket%'
  loop
    execute format('alter table public.tournaments drop constraint %I', nombre_constraint);
  end loop;
end $$;

alter table public.tournaments
  add constraint tournaments_estilo_bracket_check
  check (estilo_bracket in (
    'clasico',
    'esports',
    'starcraft_oficial',
    'tactico',
    'neon',
    'cristal'
  ));
