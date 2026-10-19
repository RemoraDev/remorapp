update public.tournaments set fondo_bracket = 'ninguno'
  where fondo_bracket not in ('ninguno', 'estrellas', 'estrellado_2');

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
  check (fondo_bracket in ('ninguno', 'estrellas', 'estrellado_2'));

update public.tournaments set estilo_linea_bracket = 'laser'
  where estilo_linea_bracket not in ('ninguno', 'laser', 'dorado', 'matrix');

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.tournaments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%estilo_linea_bracket%'
  loop
    execute format('alter table public.tournaments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournaments add constraint tournaments_estilo_linea_bracket_check
  check (estilo_linea_bracket in ('ninguno', 'laser', 'dorado', 'matrix'));

alter table public.tournaments add column color_linea_bracket text;
alter table public.tournaments add constraint tournaments_color_linea_bracket_check
  check (color_linea_bracket is null or color_linea_bracket ~ '^#[0-9a-fA-F]{6}$');
