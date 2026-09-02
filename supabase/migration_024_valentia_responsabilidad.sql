-- ============================================================
-- Migración 024: sistema de Valentía y Responsabilidad -- Fase 1
-- (valentía de clan y de jugador, responsabilidad en Clan Wars),
-- conectado a las funciones de Clan Wars que ya existen. La
-- restricción de "la valentía solo se mueve entre clanes de liga
-- similar" queda para un ajuste posterior -- no se construye acá.
--
-- responsabilidad_torneos queda con su columna creada pero sin
-- ninguna lógica que la mueva todavía -- eso se conecta en otra fase,
-- con las reglas de asistencia a torneos.
--
-- poco_confiable es el nombre interno de la columna (para no romper
-- nada si algún día se junta con más señales de responsabilidad) --
-- el texto visible para el usuario es "Poco Responsable" en todos
-- lados, nunca "confiable"/"confiabilidad".
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.teams add column valentia integer not null default 50 check (valentia >= 0 and valentia <= 100);

alter table public.profiles add column valentia_jugador integer not null default 50
  check (valentia_jugador >= 0 and valentia_jugador <= 100);
alter table public.profiles add column responsabilidad_cw integer not null default 100
  check (responsabilidad_cw >= 0 and responsabilidad_cw <= 100);
alter table public.profiles add column responsabilidad_torneos integer not null default 100
  check (responsabilidad_torneos >= 0 and responsabilidad_torneos <= 100);
alter table public.profiles add column poco_confiable boolean not null default false;

-- ------------------------------------------------------------
-- Valentía de clan: se extiende responder_clan_war() (migración 021),
-- no se duplica. Aceptar sube la valentía del desafiado; rechazar
-- sube la del que propuso el reto y baja la del que rechazó -- las
-- dos cosas aplican siempre por ahora, sin mirar la liga de cada
-- equipo (eso es el ajuste posterior que se deja afuera).
-- ------------------------------------------------------------
create or replace function public.responder_clan_war(
  p_clan_war_id uuid,
  p_aceptar boolean,
  p_motivo_rechazo text default null,
  p_motivo_detalle text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_desafiado boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  select exists (
    select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid()
  ) into v_soy_desafiado;

  if not v_soy_desafiado then
    raise exception 'Solo el dueño del equipo desafiado puede responder este reto.';
  end if;

  if v_reto.status <> 'pendiente' then
    raise exception 'Este reto ya no está pendiente de respuesta.';
  end if;

  if p_aceptar then
    update public.clan_wars set status = 'aceptada' where id = p_clan_war_id;

    update public.teams
      set valentia = greatest(0, least(100, valentia + 2))
      where id = v_reto.challenged_team_id;
    return;
  end if;

  if p_motivo_rechazo is null then
    raise exception 'Tienes que elegir un motivo para rechazar el reto.';
  end if;
  if p_motivo_rechazo not in (
    'Falta de jugadores', 'Conflicto de horario', 'Ya tenemos guerra ese día',
    'Roster incompleto', 'Otro'
  ) then
    raise exception 'Ese motivo no es válido.';
  end if;
  if p_motivo_rechazo = 'Otro' and (p_motivo_detalle is null or trim(p_motivo_detalle) = '') then
    raise exception 'Tienes que escribir un detalle cuando el motivo es "Otro".';
  end if;

  update public.clan_wars
    set status = 'rechazada',
        motivo_rechazo = p_motivo_rechazo,
        motivo_detalle = case when p_motivo_rechazo = 'Otro' then p_motivo_detalle else null end
    where id = p_clan_war_id;

  update public.teams
    set valentia = greatest(0, least(100, valentia + 5))
    where id = v_reto.challenger_team_id;
  update public.teams
    set valentia = greatest(0, least(100, valentia - 5))
    where id = v_reto.challenged_team_id;
end;
$$;

grant execute on function public.responder_clan_war(uuid, boolean, text, text) to authenticated;

-- ------------------------------------------------------------
-- Valentía de jugador y responsabilidad en Clan War: se extiende
-- reportar_partida_cw() (migración 023), no se duplica.
--
--   - Participar (ganar o perder, da igual) suma +1% de valentía de
--     jugador para los dos.
--   - Responsabilidad_cw sube +1% para cada jugador cuyo capitán
--     confirmó el check-in dentro de la ventana -- challenger_confirmado
--     / challenged_confirmado en clan_wars ya SOLO pueden ser true si
--     confirmar_alineacion() pasó el chequeo de la ventana (migración
--     022), así que basta con leerlos acá.
-- ------------------------------------------------------------
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

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  -- Valentía de jugador: participar suma, sin importar quién ganó.
  update public.profiles
    set valentia_jugador = greatest(0, least(100, valentia_jugador + 1))
    where id in (v_match.jugador_challenger_id, v_match.jugador_challenged_id);

  -- Responsabilidad_cw: solo para el jugador cuyo capitán confirmó el
  -- check-in dentro de la ventana.
  if v_reto.challenger_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenger_id;
  end if;
  if v_reto.challenged_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenged_id;
  end if;

  update public.clan_war_matches
    set ganador_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;
end;
$$;

grant execute on function public.reportar_partida_cw(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- Responsabilidad por no presentarse: se extiende reportar_problema()
-- (migración 022), no se duplica. Un reporte de 'no_se_presento' baja
-- responsabilidad_cw y valentia_jugador del jugador reportado en el
-- mismo momento; acumular 3 reportes de ese motivo en los últimos 30
-- días marca poco_confiable = true.
-- ------------------------------------------------------------
create or replace function public.reportar_problema(
  p_clan_war_id uuid,
  p_jugador_afectado_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_rival_team_id uuid;
  v_reportes_recientes int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif exists (select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid()) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'No eres capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'Este reto no está en un estado que permita reportar un problema.';
  end if;

  if p_motivo not in ('cuenta_no_coincide', 'sospecha_smurf', 'no_se_presento') then
    raise exception 'Ese motivo no es válido.';
  end if;

  if not exists (
    select 1 from public.team_members where team_id = v_rival_team_id and user_id = p_jugador_afectado_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo rival.';
  end if;

  insert into public.clan_war_reportes (clan_war_id, reportado_por, jugador_afectado_id, motivo)
  values (p_clan_war_id, v_mi_team_id, p_jugador_afectado_id, p_motivo);

  if p_motivo = 'no_se_presento' then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw - 15)),
          valentia_jugador = greatest(0, least(100, valentia_jugador - 10))
      where id = p_jugador_afectado_id;

    select count(*) into v_reportes_recientes
    from public.clan_war_reportes
    where jugador_afectado_id = p_jugador_afectado_id
      and motivo = 'no_se_presento'
      and created_at >= now() - interval '30 days';

    if v_reportes_recientes >= 3 then
      update public.profiles set poco_confiable = true where id = p_jugador_afectado_id;
    end if;
  end if;
end;
$$;

grant execute on function public.reportar_problema(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------
-- Columnas nuevas de profiles: se agregan a la lista explícita de
-- SELECT (migración 017/020) -- visibles para cualquiera, igual que
-- el MMR y la liga.
-- ------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos,
  valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable
) on public.profiles to anon, authenticated;
