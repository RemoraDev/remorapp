alter table public.tournaments
  add column estilo_linea_bracket text not null default 'laser'
  check (estilo_linea_bracket in ('ninguno', 'laser', 'pulso', 'electrico', 'arcoiris', 'dorado', 'matrix'));

update public.tournaments set estilo_linea_bracket = 'ninguno' where estilo_bracket = 'clasico';
