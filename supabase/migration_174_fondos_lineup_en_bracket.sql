-- Migración 174, a pedido del usuario: suma el catálogo de fondos de
-- lineup (estrellas/estrellado/estrellado_2/nova/planeta/viaje/fuego,
-- ver FONDO_LINEUP_OPTIONS en types/teams.ts) a los que ya tenía la
-- llave de torneo (tournaments.fondo_bracket). El CSS ya comparte las
-- mismas animaciones bajo data-fondo-bracket (ver halcon.css, junto a
-- cada data-fondo-lineup) -- esto solo relaja el constraint para que
-- la base acepte los valores nuevos.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.tournaments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fondo_bracket%'
  loop
    execute format('alter table public.tournaments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournaments add constraint tournaments_fondo_bracket_check
  check (fondo_bracket in (
    'ninguno', 'campo_estrellas', 'nebulosa', 'constelacion', 'vortice',
    'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego'
  ));
