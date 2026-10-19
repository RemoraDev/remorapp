update public.tournaments set estilo_bracket = 'esports' where estilo_bracket <> 'esports';
alter table public.tournaments alter column estilo_bracket set default 'esports';
