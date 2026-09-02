-- ============================================================
-- Migración 038: rol de Capitán dentro de un equipo -- permisos
-- delegados por el dueño, revocables en cualquier momento.
--
-- 1) team_members.es_capitan: cualquier miembro (menos el dueño, que
--    ya tiene todo el permiso) puede marcarse como capitán. Sin
--    límite de cuántos capitanes puede haber a la vez.
-- 2) clan_wars.visto_bueno_dado_por_challenger/challenged: quién dio
--    realmente el visto bueno al lineup de cada lado -- no se asume
--    que fue el capitán que lo armó, puede haber sido otro capitán o
--    el propio dueño.
-- 3) es_capitan_o_dueno(): helper reusado en todas las políticas y
--    funciones de abajo -- centraliza la regla "dueño O capitán".
-- 4) asignar_capitan(): la única forma de asignar o quitar el rol,
--    exclusiva del dueño (ver excepciones más abajo).
-- 5) Las funciones que hoy solo dejan actuar al dueño (invitar,
--    quitar miembros, proponer/responder Clan War, armar lineup, dar
--    visto bueno, check-in, reportar partidas, cerrar la guerra,
--    crear/reemplazar jugador temporal) pasan a aceptar también a
--    cualquier capitán. Quedan EXCLUSIVOS del dueño, sin cambios:
--    transferir_liderazgo(), eliminar_equipo_definitivo(), y el
--    propio asignar_capitan(). quitar_miembro() ahora además bloquea
--    explícitamente que se pueda sacar al dueño por esta vía (antes
--    solo se bloqueaba sacarse a uno mismo) -- necesario porque ahora
--    un capitán, no solo el dueño, puede llamar a esta función.
--
--    También se delegan, aunque el pedido no las nombró una por una,
--    reportar_problema() y completar_datos_transmision(): las dos
--    viven en el mismo Gestor de eventos que ya se delegó por
--    completo, y dejarlas exclusivas del dueño habría dejado a un
--    capitán a mitad de camino -- pudiendo armar el lineup y dar el
--    visto bueno, pero sin poder completar los datos de transmisión
--    de una guerra que él mismo propuso, o reportar un problema
--    durante el check-in que él mismo está gestionando.
-- 6) Las políticas de SELECT de clan_wars, clan_war_lineup,
--    clan_war_matches y clan_war_reportes (hoy "el dueño de alguno de
--    los dos equipos ve esto") se actualizan igual, si no un capitán
--    no vería ni la Clan War que se supone que puede gestionar.
--
-- Fuera de alcance a propósito (quedan exclusivas del dueño, no se
-- tocan): investigar_jugador(), y los Títulos Padre/Hijo entre clanes
-- (proponer_titulo_padre_hijo/responder_titulo_padre_hijo) -- el
-- pedido no los mencionó y no son parte del flujo de lineup/CW.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
alter table public.team_members add column if not exists es_capitan boolean not null default false;

alter table public.clan_wars add column if not exists visto_bueno_dado_por_challenger uuid references public.profiles (id);
alter table public.clan_wars add column if not exists visto_bueno_dado_por_challenged uuid references public.profiles (id);

-- ------------------------------------------------------------
-- 2) Helper: ¿el usuario es dueño o capitán de este equipo?
-- ------------------------------------------------------------
create or replace function public.es_capitan_o_dueno(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams where id = p_team_id and owner_id = p_user_id
  ) or exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id and es_capitan
  );
$$;

grant execute on function public.es_capitan_o_dueno(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) asignar_capitan(): exclusiva del dueño. Sin límite de
--    capitanes; no se puede marcar/desmarcar a uno mismo (el dueño ya
--    tiene todo el permiso, no necesita el rol).
-- ------------------------------------------------------------
create or replace function public.asignar_capitan(p_team_id uuid, p_user_id uuid, p_es_capitan boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo puede asignar o quitar capitanes.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'El dueño no necesita marcarse como capitán.';
  end if;

  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id) then
    raise exception 'Ese jugador no es miembro de tu equipo.';
  end if;

  update public.team_members set es_capitan = p_es_capitan where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.asignar_capitan(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 4) Políticas de SELECT: dueño o capitán de alguno de los dos
--    equipos involucrados, en vez de solo el dueño.
-- ------------------------------------------------------------
drop policy if exists "clan_wars_select_propio" on public.clan_wars;
create policy "clan_wars_select_propio"
  on public.clan_wars for select
  to authenticated
  using (
    public.es_capitan_o_dueno(challenger_team_id) or public.es_capitan_o_dueno(challenged_team_id)
  );

drop policy if exists "clan_war_lineup_select_propio" on public.clan_war_lineup;
create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

drop policy if exists "clan_war_matches_select_propio" on public.clan_war_matches;
create policy "clan_war_matches_select_propio"
  on public.clan_war_matches for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

drop policy if exists "clan_war_reportes_select_propio" on public.clan_war_reportes;
create policy "clan_war_reportes_select_propio"
  on public.clan_war_reportes for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

-- ------------------------------------------------------------
-- 5) Funciones delegadas a capitanes
-- ------------------------------------------------------------

create or replace function public.invitar_jugador(p_team_id uuid, p_invited_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.teams where id = p_team_id and not disuelto) then
    raise exception 'Ese equipo no existe.';
  end if;

  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede invitar jugadores.';
  end if;

  if not exists (select 1 from public.profiles where id = p_invited_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  if exists (select 1 from public.team_members where user_id = p_invited_user_id) then
    raise exception 'Ese jugador ya pertenece a un equipo.';
  end if;

  if exists (
    select 1 from public.team_invitations
    where team_id = p_team_id and invited_user_id = p_invited_user_id and status = 'pendiente'
  ) then
    raise exception 'Ya le mandaste una invitación a ese jugador, todavía está pendiente.';
  end if;

  insert into public.team_invitations (team_id, invited_user_id, invited_by)
  values (p_team_id, p_invited_user_id, auth.uid());
end;
$$;

-- quitar_miembro: ahora también un capitán, pero ni el capitán ni
-- nadie más puede sacar al dueño por esta vía (antes solo se
-- bloqueaba sacarse a uno mismo -- con el dueño como único llamador
-- posible, sacar al dueño era imposible por construcción; ahora que
-- un capitán también puede llamar a esta función, hace falta el
-- chequeo explícito).
create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_entrada_en timestamptz;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  if p_user_id = v_owner_id then
    raise exception 'No se puede quitar al dueño del equipo.';
  end if;

  select joined_at into v_entrada_en
  from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
  values (p_team_id, p_user_id, auth.uid(), 'expulsado', v_entrada_en);

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

create or replace function public.proponer_clan_war(p_challenged_team_id uuid, p_fecha_hora_cet timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
begin
  -- Migración 038: ya no solo el dueño -- cualquier miembro que sea
  -- dueño o capitán de su equipo. team_members.user_id es primary key,
  -- así que solo puede pertenecer a un equipo a la vez.
  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
  end if;

  if v_challenger.disuelto then
    raise exception 'Tu equipo está disuelto.';
  end if;
  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
  end if;
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet);
end;
$$;

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
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo desafiado puede responder este reto.';
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

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  if p_accion = 'agregar' then
    if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
      raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.team_members where team_id = v_mi_team_id and user_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de tu equipo.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de tu equipo.';
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por
    )
    values (p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid());

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de tu equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  -- Cualquier cambio en el lineup resetea el visto bueno (y quién lo
  -- dio) del lado que lo cambió -- hay que volver a confirmarlo.
  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

-- confirmar_lineup_cw(): el visto bueno lo puede dar CUALQUIER
-- capitán o el dueño de ese equipo -- no tiene que ser
-- específicamente quien armó el lineup originalmente (ver
-- clan_war_lineup.agregado_por, que sí registra a esa persona puntual
-- y no cambia). Queda guardado en visto_bueno_dado_por_challenger/
-- challenged quién dio el visto bueno de verdad.
create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    update public.clan_wars
      set lineup_visto_bueno_challenger = true, visto_bueno_dado_por_challenger = auth.uid()
      where id = p_clan_war_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    update public.clan_wars
      set lineup_visto_bueno_challenged = true, visto_bueno_dado_por_challenged = auth.uid()
      where id = p_clan_war_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

-- confirmar_alineacion(): el check-in real, paso siguiente al visto
-- bueno del lineup -- se delega igual, si no un capitán podría dar el
-- visto bueno pero no completar el check-in.
create or replace function public.confirmar_alineacion(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya empezó.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de este reto.';
  end if;

  if not v_reto.lineup_visto_bueno_challenger or not v_reto.lineup_visto_bueno_challenged then
    raise exception 'Todavía falta que los dos equipos den el visto bueno al lineup.';
  end if;

  if now() < v_reto.fecha_hora_cet - interval '15 minutes' then
    raise exception 'Todavía no se abrió la ventana de check-in (se abre 15 minutos antes de la hora del reto).';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_confirmado = true where id = p_clan_war_id;
  end if;

  perform public.intentar_iniciar_clan_war(p_clan_war_id);
end;
$$;

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

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
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

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
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

  update public.profiles
    set valentia_jugador = greatest(0, least(100, valentia_jugador + 1))
    where id in (v_match.jugador_challenger_id, v_match.jugador_challenged_id);

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

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
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

  update public.titulos_padre_hijo
    set status = 'activo',
        ganador_id = v_team_ganador_id,
        fecha_inicio = now(),
        fecha_fin = now() + (duracion_dias || ' days')::interval
    where status = 'pendiente'
      and (
        (retador_id = v_reto.challenger_team_id and retado_id = v_reto.challenged_team_id)
        or (retador_id = v_reto.challenged_team_id and retado_id = v_reto.challenger_team_id)
      );
end;
$$;

create or replace function public.crear_jugador_temporal(p_team_id uuid, p_nick_temporal text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede crear un jugador temporal.';
  end if;

  if p_nick_temporal !~ '^[A-Za-z0-9_Øø]{3,13}$' then
    raise exception 'El nick temporal debe tener entre 3 y 13 caracteres: letras, números, guion bajo y Ø/ø.';
  end if;

  insert into public.team_temp_players (team_id, nick_temporal, creado_por)
  values (p_team_id, p_nick_temporal, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reemplazar_jugador_temporal(p_temp_id uuid, p_nick text, p_unique_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temp record;
  v_perfil_id uuid;
begin
  select * into v_temp from public.team_temp_players where id = p_temp_id for update;
  if v_temp is null then
    raise exception 'Ese jugador temporal no existe.';
  end if;
  if v_temp.reemplazado_por is not null then
    raise exception 'Ese jugador temporal ya fue reemplazado.';
  end if;

  if not public.es_capitan_o_dueno(v_temp.team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede reemplazar un jugador temporal.';
  end if;

  select id into v_perfil_id from public.profiles where nick = p_nick and unique_id = p_unique_id;
  if v_perfil_id is null then
    raise exception 'No encontré ningún jugador con ese Nick#ID.';
  end if;

  update public.team_temp_players set reemplazado_por = v_perfil_id where id = p_temp_id;
end;
$$;

-- reportar_problema(): parte del mismo Gestor de eventos ya delegado
-- -- un capitán que hace check-in tiene que poder reportar un
-- problema con el roster rival igual que el dueño.
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

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de este reto.';
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

-- completar_datos_transmision(): solo del lado que propuso el reto
-- (challenger_team_id) -- ahora dueño o capitán de ese lado, no
-- necesariamente quien propuso el reto en persona.
create or replace function public.completar_datos_transmision(
  p_clan_war_id uuid,
  p_caster_nombre text,
  p_caster_link text,
  p_tiene_delay boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo organizador puede completar los datos de transmisión.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya empezó.';
  end if;

  if p_tiene_delay is null then
    raise exception 'Tienes que definir si la transmisión tiene delay o no.';
  end if;

  update public.clan_wars
    set caster_nombre = nullif(trim(p_caster_nombre), ''),
        caster_link = nullif(trim(p_caster_link), ''),
        tiene_delay = p_tiene_delay
    where id = p_clan_war_id;

  perform public.intentar_iniciar_clan_war(p_clan_war_id);
end;
$$;
