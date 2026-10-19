alter table public.tournaments
  add column estilo_celebracion text not null default 'dorado'
  check (estilo_celebracion in (
    'dorado', 'victory_royale', 'pentakill', 'ace', 'rank_up',
    'aegis', 'gg_wp', 'neon_arcade', 'holografico', 'minimalista'
  ));
