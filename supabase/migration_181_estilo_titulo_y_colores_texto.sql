alter table public.tournaments
  add column estilo_titulo_bracket text not null default 'diagonal'
  check (estilo_titulo_bracket in (
    'diagonal', 'hexagonal', 'chevron', 'subrayado', 'marco', 'cinta',
    'glitch', 'placa', 'gradiente', 'minimal', 'neon_doble'
  ));

alter table public.tournaments add column color_texto_bracket text;
alter table public.tournaments add constraint tournaments_color_texto_bracket_check
  check (color_texto_bracket is null or color_texto_bracket ~ '^#[0-9a-fA-F]{6}$');

alter table public.tournaments add column color_texto_titulo_bracket text;
alter table public.tournaments add constraint tournaments_color_texto_titulo_bracket_check
  check (color_texto_titulo_bracket is null or color_texto_titulo_bracket ~ '^#[0-9a-fA-F]{6}$');
