alter table public.tournaments add column fuente_texto text;

alter table public.tournaments add column tamano_fuente_titulo integer;
alter table public.tournaments add constraint tournaments_tamano_fuente_titulo_check
  check (tamano_fuente_titulo is null or tamano_fuente_titulo between 10 and 60);
