-- ============================================================
-- Migración 014: quién le dio XP al clan + apuestas de XP entre
-- clanes.
--
--   1) team_xp_log: registro de cada aporte de XP a un equipo (ya sea
--      por partida jugada -- Fase A -- o por una apuesta ganada/
--      perdida). Extiende otorgar_xp_participante() (no la duplica).
--   2) team_xp_wagers: apuestas de XP entre dos equipos, con el mismo
--      patrón de disputa que ya existe para partidas (reportar_resultado
--      -> en_disputa -> resolver desde /admin).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) team_xp_log
-- ------------------------------------------------------------
create table public.team_xp_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Quién generó este XP jugando -- null cuando el origen es una
  -- apuesta (ahí el XP es del equipo como tal, no de una persona).
  user_id uuid references public.profiles (id),
  cantidad integer not null,
  origen text not null check (origen in ('partida_ganada', 'partida_perdida', 'apuesta')),
  created_at timestamptz not null default now()
);

alter table public.team_xp_log enable row level security;

-- Solo el dueño del equipo ve su propio log -- es lo que alimenta
-- "Aporte de XP" en el Panel de control.
create policy "team_xp_log_select_propio"
  on public.team_xp_log for select
  to authenticated
  using (
    exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
  );

grant select on public.team_xp_log to authenticated;

-- ------------------------------------------------------------
-- 2) otorgar_xp_participante: se extiende (no se duplica) para que
--    además de sumar el XP, deje registro en team_xp_log -- una fila
--    por cada miembro que aporta (en un participante de equipo, cada
--    uno de los miembros cuenta como que "aportó" esa misma
--    cantidad, igual que ya reparte el XP mismo). Ahora recibe
--    p_origen para poder etiquetar cada fila del log correctamente.
-- ------------------------------------------------------------
-- Ojo: esto no es "reemplazar" la función de la migración 013 -- un
-- parámetro nuevo (p_origen) hace que sea una firma distinta, así que
-- create or replace por sí solo dejaría las DOS versiones conviviendo
-- (Postgres permite funciones con el mismo nombre y distinta
-- cantidad de parámetros). Hay que borrar la vieja a mano.
drop function if exists public.otorgar_xp_participante(uuid, int);

create or replace function public.otorgar_xp_participante(p_participant_id uuid, p_xp int, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_team_id uuid;
  v_miembro record;
begin
  select user_id, team_id into v_participante
  from public.tournament_participants
  where id = p_participant_id;

  if v_participante.user_id is not null then
    update public.profiles set xp = xp + p_xp where id = v_participante.user_id;

    select team_id into v_team_id from public.team_members where user_id = v_participante.user_id;
    if v_team_id is not null then
      update public.teams set xp = xp + p_xp where id = v_team_id;
      insert into public.team_xp_log (team_id, user_id, cantidad, origen)
      values (v_team_id, v_participante.user_id, p_xp, p_origen);
    end if;

  elsif v_participante.team_id is not null then
    for v_miembro in select user_id from public.team_members where team_id = v_participante.team_id loop
      update public.profiles set xp = xp + p_xp where id = v_miembro.user_id;
      insert into public.team_xp_log (team_id, user_id, cantidad, origen)
      values (v_participante.team_id, v_miembro.user_id, p_xp, p_origen);
    end loop;

    update public.teams
      set xp = xp + p_xp * (select count(*) from public.team_members where team_id = v_participante.team_id)
      where id = v_participante.team_id;
  end if;
end;
$$;

-- avanzar_ganador: mismo cuerpo de la migración 013, solo cambian los
-- dos "perform" para pasar el origen nuevo.
create or replace function public.avanzar_ganador(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_total_en_ronda int;
  v_target_match_number int;
  v_target record;
  v_es_impar boolean;
  v_perdedor_id uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    v_perdedor_id := case
      when v_match.winner_id = v_match.participant1_id then v_match.participant2_id
      else v_match.participant1_id
    end;

    perform public.otorgar_xp_participante(v_match.winner_id, public.xp_ganador_partida(), 'partida_ganada');
    perform public.otorgar_xp_participante(v_perdedor_id, public.xp_perdedor_partida(), 'partida_perdida');
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round;

  if v_total_en_ronda = 1 then
    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  v_target_match_number := ceil(v_match.match_number::numeric / 2);
  v_es_impar := (v_match.match_number % 2) = 1;

  select * into v_target
  from public.bracket_matches
  where tournament_id = v_match.tournament_id
    and round = v_match.round + 1
    and match_number = v_target_match_number
  for update;

  if not found then
    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, status
    )
    values (
      v_match.tournament_id,
      v_match.round + 1,
      v_target_match_number,
      case when v_es_impar then v_match.winner_id else null end,
      case when v_es_impar then null else v_match.winner_id end,
      'pendiente'
    );
  else
    if v_es_impar then
      update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
    else
      update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) team_xp_wagers: apuestas de XP entre dos equipos.
-- ------------------------------------------------------------
create table public.team_xp_wagers (
  id uuid primary key default gen_random_uuid(),
  challenger_team_id uuid not null references public.teams (id) on delete cascade,
  challenged_team_id uuid not null references public.teams (id) on delete cascade,
  monto integer not null check (monto > 0),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aceptada', 'rechazada', 'resuelta', 'en_disputa')),
  -- Qué equipo dice cada líder que ganó -- tiene que ser uno de los
  -- dos equipos de la apuesta, nunca otro.
  reporte_challenger uuid references public.teams (id),
  reporte_challenged uuid references public.teams (id),
  ganador_final uuid references public.teams (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (challenger_team_id <> challenged_team_id),
  check (reporte_challenger is null or reporte_challenger in (challenger_team_id, challenged_team_id)),
  check (reporte_challenged is null or reporte_challenged in (challenger_team_id, challenged_team_id)),
  check (ganador_final is null or ganador_final in (challenger_team_id, challenged_team_id))
);

alter table public.team_xp_wagers enable row level security;

-- Los dueños de los dos equipos involucrados ven la apuesta; un admin
-- también, para poder resolver las que quedan en_disputa desde
-- /admin (esta tabla no es pública como bracket_matches).
create policy "team_xp_wagers_select"
  on public.team_xp_wagers for select
  to authenticated
  using (
    exists (select 1 from public.teams t where t.id = challenger_team_id and t.owner_id = auth.uid())
    or exists (select 1 from public.teams t where t.id = challenged_team_id and t.owner_id = auth.uid())
    or public.is_admin()
  );

grant select on public.team_xp_wagers to authenticated;

-- ------------------------------------------------------------
-- 4) proponer_apuesta: solo el dueño de un equipo, contra otro
--    equipo que exista. El monto no puede superar el XP actual del
--    equipo que propone -- así nunca puede terminar en negativo si
--    pierde (greatest(0, ...) en resolver_apuesta_interno es un
--    segundo respaldo, no la única barrera).
-- ------------------------------------------------------------
create or replace function public.proponer_apuesta(p_challenged_team_id uuid, p_monto int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger_team_id uuid;
  v_challenger_xp int;
  v_id uuid;
begin
  select team_id into v_challenger_team_id
  from public.team_members
  where user_id = auth.uid() and roles @> array['owner']::text[];

  if v_challenger_team_id is null then
    raise exception 'Tienes que ser dueño de un equipo para proponer una apuesta.';
  end if;

  if v_challenger_team_id = p_challenged_team_id then
    raise exception 'No puedes desafiar a tu propio equipo wn.';
  end if;

  if not exists (select 1 from public.teams where id = p_challenged_team_id) then
    raise exception 'Ese equipo no existe.';
  end if;

  if p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a 0.';
  end if;

  select xp into v_challenger_xp from public.teams where id = v_challenger_team_id;
  if p_monto > v_challenger_xp then
    raise exception 'No puedes apostar más XP del que tiene tu equipo (tiene %).', v_challenger_xp;
  end if;

  insert into public.team_xp_wagers (challenger_team_id, challenged_team_id, monto)
  values (v_challenger_team_id, p_challenged_team_id, p_monto)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.proponer_apuesta(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- 5) responder_apuesta: solo el dueño del equipo desafiado.
-- ------------------------------------------------------------
create or replace function public.responder_apuesta(p_wager_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apuesta record;
  v_es_owner boolean;
begin
  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id for update;

  if v_apuesta is null then
    raise exception 'Esa apuesta no existe.';
  end if;
  if v_apuesta.status <> 'pendiente' then
    raise exception 'Esta apuesta ya no está pendiente de respuesta.';
  end if;

  select exists (
    select 1 from public.teams where id = v_apuesta.challenged_team_id and owner_id = auth.uid()
  ) into v_es_owner;

  if not v_es_owner then
    raise exception 'Solo el dueño del equipo desafiado puede responder esta apuesta.';
  end if;

  update public.team_xp_wagers
    set status = case when p_aceptar then 'aceptada' else 'rechazada' end
    where id = p_wager_id;
end;
$$;

grant execute on function public.responder_apuesta(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6) resolver_apuesta_interno: mueve el XP de verdad, deja el
--    registro en team_xp_log (con origen 'apuesta', user_id null
--    porque el XP acá es del equipo, no de una persona jugando) y
--    cierra la apuesta como 'resuelta'. La usan tanto
--    reportar_resultado_apuesta() (cuando los dos líderes coinciden)
--    como resolver_disputa_apuesta() (cuando un admin la destraba) --
--    un solo lugar con la lógica real, nada de duplicarla.
-- ------------------------------------------------------------
create or replace function public.resolver_apuesta_interno(p_wager_id uuid, p_ganador_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apuesta record;
  v_perdedor_team_id uuid;
begin
  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id for update;

  v_perdedor_team_id := case
    when p_ganador_team_id = v_apuesta.challenger_team_id then v_apuesta.challenged_team_id
    else v_apuesta.challenger_team_id
  end;

  update public.teams set xp = xp + v_apuesta.monto where id = p_ganador_team_id;
  update public.teams set xp = greatest(0, xp - v_apuesta.monto) where id = v_perdedor_team_id;

  insert into public.team_xp_log (team_id, user_id, cantidad, origen)
  values (p_ganador_team_id, null, v_apuesta.monto, 'apuesta');

  insert into public.team_xp_log (team_id, user_id, cantidad, origen)
  values (v_perdedor_team_id, null, -v_apuesta.monto, 'apuesta');

  update public.team_xp_wagers
    set status = 'resuelta', ganador_final = p_ganador_team_id, resolved_at = now()
    where id = p_wager_id;
end;
$$;

-- ------------------------------------------------------------
-- 7) reportar_resultado_apuesta: cualquiera de los dos líderes
--    reporta. Si coinciden, se resuelve sola; si no, en_disputa.
-- ------------------------------------------------------------
create or replace function public.reportar_resultado_apuesta(p_wager_id uuid, p_ganador_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apuesta record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
begin
  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id for update;

  if v_apuesta is null then
    raise exception 'Esa apuesta no existe.';
  end if;
  if v_apuesta.status <> 'aceptada' then
    raise exception 'Esta apuesta no está activa.';
  end if;
  if p_ganador_team_id <> v_apuesta.challenger_team_id and p_ganador_team_id <> v_apuesta.challenged_team_id then
    raise exception 'Ese equipo no participa en esta apuesta.';
  end if;

  select exists (
    select 1 from public.teams where id = v_apuesta.challenger_team_id and owner_id = auth.uid()
  ) into v_soy_challenger;
  select exists (
    select 1 from public.teams where id = v_apuesta.challenged_team_id and owner_id = auth.uid()
  ) into v_soy_challenged;

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño de ninguno de los dos equipos de esta apuesta.';
  end if;

  if v_soy_challenger then
    update public.team_xp_wagers set reporte_challenger = p_ganador_team_id where id = p_wager_id;
  else
    update public.team_xp_wagers set reporte_challenged = p_ganador_team_id where id = p_wager_id;
  end if;

  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id;

  if v_apuesta.reporte_challenger is not null and v_apuesta.reporte_challenged is not null then
    if v_apuesta.reporte_challenger = v_apuesta.reporte_challenged then
      perform public.resolver_apuesta_interno(p_wager_id, v_apuesta.reporte_challenger);
    else
      update public.team_xp_wagers set status = 'en_disputa' where id = p_wager_id;
    end if;
  end if;
end;
$$;

grant execute on function public.reportar_resultado_apuesta(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 8) resolver_disputa_apuesta: solo un admin, mismo patrón que
--    resolver_disputa() para partidas.
-- ------------------------------------------------------------
create or replace function public.resolver_disputa_apuesta(p_wager_id uuid, p_ganador_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apuesta record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver una disputa de apuesta.';
  end if;

  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id for update;

  if v_apuesta is null then
    raise exception 'Esa apuesta no existe.';
  end if;
  if v_apuesta.status <> 'en_disputa' then
    raise exception 'Esta apuesta no está en disputa.';
  end if;
  if p_ganador_team_id <> v_apuesta.challenger_team_id and p_ganador_team_id <> v_apuesta.challenged_team_id then
    raise exception 'Ese equipo no participa en esta apuesta.';
  end if;

  perform public.resolver_apuesta_interno(p_wager_id, p_ganador_team_id);
end;
$$;

grant execute on function public.resolver_disputa_apuesta(uuid, uuid) to authenticated;
