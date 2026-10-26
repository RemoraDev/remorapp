-- ============================================================
-- Migración 224: suma el fondo "elfos"
--
-- Ashenvale de noche: el bosque de los elfos nocturnos de Warcraft III.
-- Lo identifican dos cosas -- que es el único bosque que no es verde
-- (turquesa y violeta, iluminado por la luna) y el POZO LUNAR, esa
-- piscina que brilla desde adentro. Ver src/components/fondos/elfos.ts.
--
-- Hay CUATRO lugares que filtran el valor, no uno: los checks de las
-- tres tablas con columna de fondo, más la lista blanca que la función
-- cambiar_fondo_lineup_cw() lleva hardcodeada adentro.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ---------- 1. tournaments.fondo_bracket ----------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.tournaments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fondo_bracket%'
  loop
    execute format('alter table public.tournaments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournaments add constraint tournaments_fondo_bracket_check
  check (fondo_bracket in (
    'ninguno', 'estrellas', 'estrellado_2',
    'nebulosa', 'campo_estelar', 'aurora', 'supernova', 'infierno',
    'bosque_elfico',
    'tormenta',
    'navidad',
    'halloween',
    'no_muertos',
    'orcos',
    'humanos',
    'elfos'
  ));

-- ---------- 2. clan_wars.fondo_lineup ----------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.clan_wars'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fondo_lineup%'
  loop
    execute format('alter table public.clan_wars drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.clan_wars add constraint clan_wars_fondo_lineup_check
  check (fondo_lineup in (
    'ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego',
    'nebulosa', 'campo_estelar', 'aurora', 'supernova', 'infierno',
    'bosque_elfico',
    'tormenta',
    'navidad',
    'halloween',
    'no_muertos',
    'orcos',
    'humanos',
    'elfos'
  ));

-- ---------- 3. guerra_razas.fondo_lineup ----------
-- "Look" de Guerra de Razas (migración 161) tiene su PROPIA columna
-- fondo_lineup, con su propio check -- mismo catálogo, columna distinta.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.guerra_razas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%fondo_lineup%'
  loop
    execute format('alter table public.guerra_razas drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.guerra_razas add constraint guerra_razas_fondo_lineup_check
  check (fondo_lineup in (
    'ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego',
    'nebulosa', 'campo_estelar', 'aurora', 'supernova', 'infierno',
    'bosque_elfico',
    'tormenta',
    'navidad',
    'halloween',
    'no_muertos',
    'orcos',
    'humanos',
    'elfos'
  ));

-- ---------- 4. La lista blanca de adentro del RPC ----------
-- Se reescribe la función COMPLETA desde su definición vigente (no un
-- parche): así este archivo es la verdad de qué hace la función después
-- de correrlo, sin tener que reconstruirla leyendo migraciones viejas.
drop function if exists public.cambiar_fondo_lineup_cw(uuid, text);

create or replace function public.cambiar_fondo_lineup_cw(p_clan_war_id uuid, p_fondo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_fondo not in (
    'ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego',
    'nebulosa', 'campo_estelar', 'aurora', 'supernova', 'infierno',
    'bosque_elfico',
    'tormenta',
    'navidad',
    'halloween',
    'no_muertos',
    'orcos',
    'humanos',
    'elfos'
  ) then
    raise exception 'Ese fondo no es válido.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar el fondo.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El fondo de la sala de lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set fondo_lineup = p_fondo, fondo_lineup_imagen_id = null where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_fondo_lineup_cw(uuid, text) to authenticated;
