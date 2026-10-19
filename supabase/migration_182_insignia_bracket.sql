alter table public.tournaments
  add column insignia_bracket text not null default 'logo_personal'
  check (insignia_bracket in ('ninguno', 'bandera', 'banner_clan', 'logo_personal'));
