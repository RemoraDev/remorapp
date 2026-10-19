alter table public.tournaments
  add column estructura_bracket text not null default 'clasico'
  check (estructura_bracket in ('clasico', 'vertical', 'embudo', 'compacta'));
