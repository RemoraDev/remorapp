-- ============================================================
-- Migración 023: Clan Wars -- Fase 3 (resultado, con ajuste real de
-- MMR para jugadores y para el equipo). Bonos de torneo y actividad
-- semanal quedan afuera a propósito -- dependen de cosas que todavía
-- no están diseñadas (torneos de 5+ clanes, un conteo semanal).
--
-- clan_wars suma dos pares de columnas que el pedido no enumeró
-- explícitamente pero hacen falta para lo que sí pidió:
--   - challenger_cierre_confirmado / challenged_cierre_confirmado:
--     el mismo patrón de doble confirmación de challenger_confirmado
--     / challenged_confirmado (Fase 2, check-in), pero para el cierre
--     -- cualquiera de los dos capitanes puede llamar
--     cerrar_clan_war(), pero recién se cierra de verdad cuando los
--     dos la llamaron.
--   - ganador_team_id: qué equipo ganó, para no tener que
--     recalcularlo contando clan_war_matches cada vez que se
--     necesite mostrar el resultado.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.clan_wars add column challenger_cierre_confirmado boolean not null default false;
alter table public.clan_wars add column challenged_cierre_confirmado boolean not null default false;
alter table public.clan_wars add column ganador_team_id uuid references public.teams (id);

-- 'finalizada' (ganó un equipo) y 'empatada' (mismas partidas
-- ganadas de cada lado -- nadie gana ni pierde MMR de clan, aunque el
-- MMR individual de cada partida ya se haya movido) se suman a los
-- estados que ya existían.
alter table public.clan_wars drop constraint if exists clan_wars_status_check;
alter table public.clan_wars add constraint clan_wars_status_check
  check (status in ('pendiente', 'aceptada', 'rechazada', 'cancelada', 'en_curso', 'finalizada', 'empatada'));

-- Partidas individuales de la guerra: los capitanes las van agregando
-- a medida que se juegan, sin un número fijo predefinido -- el
-- organizador decide cuándo hay suficientes para cerrar la CW.
create table public.clan_war_matches (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id),
  jugador_challenger_id uuid not null references public.profiles (id),
  jugador_challenged_id uuid not null references public.profiles (id),
  -- null hasta reportarse.
  ganador_id uuid references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'jugado')),
  created_at timestamptz not null default now(),
  check (jugador_challenger_id <> jugador_challenged_id),
  check (ganador_id is null or ganador_id in (jugador_challenger_id, jugador_challenged_id))
);

alter table public.clan_war_matches enable row level security;

-- Mismo criterio que clan_wars/clan_war_reportes: solo los capitanes
-- de los dos equipos de la guerra ven sus partidas.
create policy "clan_war_matches_select_propio"
  on public.clan_war_matches for select
  to authenticated
  using (
    exists (
      select 1
      from public.clan_wars cw
      join public.teams t on t.id in (cw.challenger_team_id, cw.challenged_team_id)
      where cw.id = clan_war_id and t.owner_id = auth.uid()
    )
  );

grant select on public.clan_war_matches to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es agregar_partida_cw() y
-- reportar_partida_cw(), security definer.

-- ------------------------------------------------------------
-- Tabla de MMR apostado -- exacta, según la liga de quien gana y de
-- quien pierde. No es security definer ni necesita grant execute:
-- es puro cálculo, sin tocar ninguna tabla, se usa desde adentro de
-- reportar_partida_cw() y cerrar_clan_war().
-- ------------------------------------------------------------
create or replace function public.calcular_ajuste_mmr(
  mmr_ganador integer,
  mmr_perdedor integer,
  out ajuste_ganador integer,
  out ajuste_perdedor integer
)
language plpgsql
immutable
as $$
declare
  v_liga_ganador text;
  v_liga_perdedor text;
begin
  v_liga_ganador := public.calcular_liga(mmr_ganador);
  v_liga_perdedor := public.calcular_liga(mmr_perdedor);

  if v_liga_ganador in ('Bronce 3', 'Bronce 2', 'Bronce 1', 'Banca Rota') then
    -- La "hazaña": el ganador está en Bronce (o banca rota, mismo
    -- piso) y el perdedor está en Platino o superior.
    if v_liga_perdedor in (
      'Platino 3', 'Platino 2', 'Platino 1',
      'Diamante 3', 'Diamante 2', 'Diamante 1',
      'Maestro 3', 'Maestro 2', 'Maestro 1',
      'Gran Maestro'
    ) then
      ajuste_ganador := 80;
    else
      ajuste_ganador := 48;
    end if;
    ajuste_perdedor := -12;

  elsif v_liga_ganador in ('Plata 3', 'Plata 2', 'Plata 1') then
    ajuste_ganador := 36;
    ajuste_perdedor := -16;

  elsif v_liga_ganador in ('Oro 3', 'Oro 2', 'Oro 1') then
    ajuste_ganador := 28;
    ajuste_perdedor := -20;

  else
    -- Platino, Diamante, Maestro o Gran Maestro: competitivo real,
    -- simétrico según quién tenía más MMR antes de jugar. Un empate
    -- exacto de MMR se trata como "el ganador era favorito" (>=).
    if mmr_ganador >= mmr_perdedor then
      ajuste_ganador := 24;
      ajuste_perdedor := -38;
    else
      ajuste_ganador := 38;
      ajuste_perdedor := -24;
    end if;
  end if;
end;
$$;

-- agregar_partida_cw(): cualquiera de los dos capitanes puede agregar
-- una partida, eligiendo un jugador de cada roster -- solo mientras
-- la guerra está 'en_curso' (recién ahí terminó el check-in).
create or replace function public.agregar_partida_cw(
  p_clan_war_id uuid,
  p_jugador_challenger_id uuid,
  p_jugador_challenged_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if not exists (
    select 1 from public.teams
    where (id = v_reto.challenger_team_id or id = v_reto.challenged_team_id) and owner_id = auth.uid()
  ) then
    raise exception 'No eres capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra todavía no está en curso.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenger_team_id and user_id = p_jugador_challenger_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiante.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenged_team_id and user_id = p_jugador_challenged_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiado.';
  end if;

  insert into public.clan_war_matches (clan_war_id, jugador_challenger_id, jugador_challenged_id)
  values (p_clan_war_id, p_jugador_challenger_id, p_jugador_challenged_id);
end;
$$;

grant execute on function public.agregar_partida_cw(uuid, uuid, uuid) to authenticated;

-- reportar_partida_cw(): ajusta mmr_equipos de los dos jugadores al
-- toque, no espera al cierre de la CW.
create or replace function public.reportar_partida_cw(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
begin
  select * into v_match from public.clan_war_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'pendiente' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;

  select * into v_reto from public.clan_wars where id = v_match.clan_war_id;

  if not exists (
    select 1 from public.teams
    where (id = v_reto.challenger_team_id or id = v_reto.challenged_team_id) and owner_id = auth.uid()
  ) then
    raise exception 'No eres capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_match.jugador_challenger_id and p_ganador_id <> v_match.jugador_challenged_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  v_perdedor_id := case
    when p_ganador_id = v_match.jugador_challenger_id then v_match.jugador_challenged_id
    else v_match.jugador_challenger_id
  end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  -- greatest(500, ...) en vez de dejar que el check constraint de la
  -- columna lo rechace: acá se quiere recortar en el piso, no fallar
  -- con un error.
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  update public.clan_war_matches
    set ganador_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;
end;
$$;

grant execute on function public.reportar_partida_cw(uuid, uuid) to authenticated;

-- cerrar_clan_war(): cualquiera de los dos capitanes la llama, pero
-- recién se cierra de verdad cuando los dos la llamaron (mismo
-- patrón de doble confirmación que challenger_confirmado /
-- challenged_confirmado en el check-in). El equipo con más partidas
-- individuales ganadas gana la CW completa y ajusta su MMR de clan
-- una sola vez; empate en partidas ganadas dejan la CW 'empatada' sin
-- tocar el MMR de ningún equipo (el MMR individual de cada partida ya
-- se movió al reportarse, eso no se revierte).
create or replace function public.cerrar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
  v_ganadas_challenger int;
  v_ganadas_challenged int;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_team_ganador_id uuid;
  v_team_perdedor_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  select exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid())
    into v_soy_challenger;
  select exists (select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid())
    into v_soy_challenged;

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    -- Falta que confirme el otro capitán -- todavía no se cierra.
    return;
  end if;

  select count(*) into v_ganadas_challenger
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

  select count(*) into v_ganadas_challenged
  from public.clan_war_matches
  where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

  if v_ganadas_challenger = v_ganadas_challenged then
    update public.clan_wars set status = 'empatada' where id = p_clan_war_id;
    return;
  end if;

  if v_ganadas_challenger > v_ganadas_challenged then
    v_team_ganador_id := v_reto.challenger_team_id;
    v_team_perdedor_id := v_reto.challenged_team_id;
  else
    v_team_ganador_id := v_reto.challenged_team_id;
    v_team_perdedor_id := v_reto.challenger_team_id;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;
end;
$$;

grant execute on function public.cerrar_clan_war(uuid) to authenticated;
