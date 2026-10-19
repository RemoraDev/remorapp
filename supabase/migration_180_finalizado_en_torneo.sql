alter table public.tournaments add column finalizado_en timestamptz;

create or replace function public.set_finalizado_en_torneo()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'finalizado' and old.estado is distinct from 'finalizado' then
    new.finalizado_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_tournaments_finalizado_en on public.tournaments;
create trigger before_update_tournaments_finalizado_en
  before update on public.tournaments
  for each row execute function public.set_finalizado_en_torneo();
