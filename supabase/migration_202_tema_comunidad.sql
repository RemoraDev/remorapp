alter table public.comunidades
  add column tema_comunidad text not null default 'celeste'
    check (tema_comunidad in ('celeste', 'verde_claro', 'violeta', 'rosa', 'cyan'));
