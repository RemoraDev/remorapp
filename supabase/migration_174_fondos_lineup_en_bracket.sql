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
