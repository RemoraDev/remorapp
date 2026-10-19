update public.tournaments set estructura_bracket = 'escalera'
  where estructura_bracket = 'compacta';

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.tournaments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%estructura_bracket%'
  loop
    execute format('alter table public.tournaments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournaments add constraint tournaments_estructura_bracket_check
  check (estructura_bracket in ('clasico', 'vertical', 'embudo', 'escalera'));
