-- ------------------------------------------------------------
-- Migración 060: liga_ranking (texto plano, migración 059) se
-- reemplaza por un modelo relacional real -- ligas y divisiones_liga,
-- para que el ranking pueda agruparse por división además de por
-- liga. Se elimina la columna liga_ranking y la función
-- ranking_clanes_liga(text): quedan reemplazadas enteras, no
-- conviven con lo nuevo.
-- ------------------------------------------------------------

create table public.ligas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

alter table public.ligas enable row level security;

create policy "ligas_select_publico"
  on public.ligas for select
  using (true);

grant select on public.ligas to anon, authenticated;

insert into public.ligas (nombre) values
  ('StarLeague Latam'),
  ('Berserker Team League (BTL)'),
  ('Vitality Team League (VTL)');

-- mmr_limite queda nullable a propósito: BTL todavía no tiene esos
-- números definidos, y VTL no se organiza en divisiones por MMR (ver
-- más abajo) -- se completa más adelante división por división, sin
-- necesitar otra migración para eso.
create table public.divisiones_liga (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas (id) on delete cascade,
  nombre text not null,
  mmr_limite integer,
  unique (liga_id, nombre)
);

alter table public.divisiones_liga enable row level security;

create policy "divisiones_liga_select_publico"
  on public.divisiones_liga for select
  using (true);

grant select on public.divisiones_liga to anon, authenticated;

insert into public.divisiones_liga (liga_id, nombre, mmr_limite)
select id, division.nombre, division.mmr_limite
from public.ligas,
  lateral (values
    ('Masters', 6000),
    ('Master 3', 4500),
    ('Diamond 1-2', 4000),
    ('Diamond 3', 3500)
  ) as division(nombre, mmr_limite)
where ligas.nombre = 'StarLeague Latam';

insert into public.divisiones_liga (liga_id, nombre, mmr_limite)
select id, division.nombre, null
from public.ligas,
  lateral (values ('Valkyrie'), ('Viking'), ('Loki'), ('Thor')) as division(nombre)
where ligas.nombre = 'Berserker Team League (BTL)';

-- VTL no se organiza en divisiones nombradas como las otras dos -- su
-- estructura de "sets" es sobre composición de partidas, no categorías
-- de equipo -- así que tiene una sola división genérica, solo para
-- que el modelo liga+división sea uniforme en las tres.
insert into public.divisiones_liga (liga_id, nombre, mmr_limite)
select id, 'General', null
from public.ligas
where ligas.nombre = 'Vitality Team League (VTL)';

-- ------------------------------------------------------------
-- tournaments: liga_id/division_id reemplazan a liga_ranking. Ambos
-- opcionales -- el organizador los elige solo para categorizar el
-- torneo en el ranking, sin forzar ninguna regla de elegibilidad de
-- MMR (eso ya existe aparte con rangos_mmr_por_posicion si el
-- organizador quiere usarlo).
-- ------------------------------------------------------------
alter table public.tournaments drop column if exists liga_ranking;

alter table public.tournaments
  add column liga_id uuid references public.ligas (id);

alter table public.tournaments
  add column division_id uuid references public.divisiones_liga (id);

-- Consistencia mínima: si se elige una división, tiene que pertenecer
-- a la liga elegida en el mismo torneo -- sin esto, un torneo podría
-- quedar categorizado en "StarLeague Latam" con la división "Viking"
-- (de BTL), lo que no tiene sentido para el ranking.
create or replace function public.validar_division_de_liga()
returns trigger
language plpgsql
as $$
begin
  if new.division_id is not null then
    if new.liga_id is null then
      raise exception 'No puedes elegir una división sin elegir primero su liga.';
    end if;
    if not exists (
      select 1 from public.divisiones_liga
      where id = new.division_id and liga_id = new.liga_id
    ) then
      raise exception 'Esa división no pertenece a la liga elegida.';
    end if;
  end if;
  return new;
end;
$$;

create trigger before_upsert_tournaments_validar_division
  before insert or update on public.tournaments
  for each row execute function public.validar_division_de_liga();

-- ------------------------------------------------------------
-- ranking_clanes_liga(text) (migración 059) queda reemplazada por
-- ranking_clanes(), sobre liga_id/division_id en vez de un código de
-- texto. p_liga_id null = "General" (suma las tres ligas, sin
-- distinguir división); p_liga_id dado y p_division_id null = todos
-- los torneos de esa liga, cualquier división; ambos dados = la
-- combinación específica que pide el ranking por categorías.
-- ------------------------------------------------------------
drop function if exists public.ranking_clanes_liga(text);

create or replace function public.ranking_clanes(p_liga_id uuid default null, p_division_id uuid default null)
returns table (
  team_id uuid,
  team_name text,
  team_tag text,
  logo_url text,
  torneos_ganados bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    t.name as team_name,
    t.tag as team_tag,
    t.logo_url,
    count(tn.id) as torneos_ganados
  from public.teams t
  join public.tournament_participants tp on tp.team_id = t.id
  join public.tournaments tn
    on tn.id = tp.tournament_id
    and tn.campeon_participant_id = tp.id
    and tn.estado = 'finalizado'
    and (
      (p_liga_id is null and tn.liga_id is not null)
      or (
        p_liga_id is not null
        and tn.liga_id = p_liga_id
        and (p_division_id is null or tn.division_id = p_division_id)
      )
    )
  where not t.disuelto
  group by t.id, t.name, t.tag, t.logo_url
  order by torneos_ganados desc, t.name asc;
$$;

grant execute on function public.ranking_clanes(uuid, uuid) to anon, authenticated;
