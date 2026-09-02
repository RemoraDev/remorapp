-- ============================================================
-- Migración 019: abandonar torneo, salir de equipo, transferir
-- liderazgo.
--
--   1) abandonar_torneo(): saca a un participante de un torneo
--      'abierto', o -- si el torneo ya está 'en_curso' y ese
--      participante todavía tiene una partida pendiente por jugar --
--      lo trata como un abandono: su rival avanza automáticamente,
--      reutilizando avanzar_ganador() tal cual, con el mismo reparto
--      de XP que un partido jugado de verdad.
--   2) salir_equipo(): un miembro común deja el equipo por su cuenta
--      (mismo efecto que quitar_miembro(), pero iniciado por el propio
--      jugador). team_kicks_log ahora distingue el origen con una
--      columna motivo: 'expulsado' (quitar_miembro) vs 'renuncia'
--      (salir_equipo).
--   3) transferir_liderazgo(): el dueño de un equipo con más de un
--      miembro le pasa el liderazgo a otro miembro -- perfil_tipo se
--      actualiza en ambos con el mismo criterio que ya usa
--      crear_membresia_owner() (nuevo dueño pasa a lider_clan, el
--      anterior vuelve a jugador -- siempre puede volver a jugador sin
--      chequear si lidera otro equipo, porque team_members.user_id es
--      primary key: nadie pertenece a más de un equipo a la vez).
--   4) Si el dueño es el ÚNICO miembro, salir_equipo() SÍ lo deja
--      salir directo -- el equipo queda disuelto (teams.disuelto)
--      en vez de borrado, y deja de aparecer en el buscador público
--      (filtrado en el frontend). Para que "disuelto" signifique algo
--      de verdad, también se bloquea invitar o unirse a un equipo
--      disuelto -- si no, el mismo ex-dueño podría "revivirlo" a mano
--      invitando gente de nuevo, porque teams.owner_id no cambia solo
--      porque el equipo se disolvió.
--
-- Como en el resto del proyecto, cada acción sensible pasa por una
-- función security definer que verifica el permiso puertas adentro
-- (auth.uid()) en vez de depender de una política de RLS de
-- INSERT/UPDATE/DELETE directa -- estos flujos (abandonar según el
-- estado del torneo, disolver solo si sos el único miembro, mover el
-- rol de dos personas a la vez al transferir) tienen ramas que una
-- política sola no puede expresar. Es el mismo patrón que ya usan
-- quitar_miembro(), invitar_jugador() y reportar_resultado() -- la
-- protección real está acá, no en esconder el botón en la app.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Abandonar un torneo.
-- ------------------------------------------------------------

-- Simétrico a incrementar_cupos_ocupados() (migración 006): cuando un
-- participante se borra de tournament_participants (torneo todavía
-- 'abierto'), el cupo se libera solo.
create or replace function public.decrementar_cupos_ocupados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tournaments
     set cupos_ocupados = cupos_ocupados - 1
   where id = old.tournament_id;
  return old;
end;
$$;

create trigger after_delete_participant
  after delete on public.tournament_participants
  for each row execute function public.decrementar_cupos_ocupados();

create or replace function public.abandonar_torneo(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
  v_match record;
  v_rival_id uuid;
begin
  select * into v_participante
  from public.tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Esa inscripción no existe.';
  end if;

  -- es_dueno_del_participante() (migración 009) ya cubre tanto un
  -- jugador individual como el dueño de un equipo inscrito.
  if not public.es_dueno_del_participante(p_participant_id) then
    raise exception 'No tienes permiso para abandonar esta inscripción.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id for update;

  if v_torneo.estado = 'abierto' then
    delete from public.tournament_participants where id = p_participant_id;
    return;
  end if;

  if v_torneo.estado = 'finalizado' then
    raise exception 'Este torneo ya terminó, no puedes abandonarlo.';
  end if;

  -- estado = 'en_curso': busca la partida pendiente donde participa.
  -- Si ya perdió (su última partida quedó 'jugado' sin ser el
  -- ganador) o el torneo todavía no le asignó rival, no hay nada que
  -- abandonar.
  select * into v_match
  from public.bracket_matches
  where tournament_id = v_torneo.id
    and (participant1_id = p_participant_id or participant2_id = p_participant_id)
    and status = 'pendiente'
  for update
  limit 1;

  if v_match is null then
    raise exception 'No tienes ninguna partida pendiente en este torneo para abandonar.';
  end if;

  if v_match.participant1_id is null or v_match.participant2_id is null then
    raise exception 'Esta partida todavía no tiene rival asignado.';
  end if;

  v_rival_id := case
    when v_match.participant1_id = p_participant_id then v_match.participant2_id
    else v_match.participant1_id
  end;

  -- Mismo camino que un resultado jugado normal: se marca ganador al
  -- rival y avanzar_ganador() hace exactamente lo mismo que si hubiera
  -- ganado en cancha -- reparte XP, avanza de ronda o corona campeón.
  update public.bracket_matches
    set winner_id = v_rival_id, status = 'jugado'
    where id = v_match.id;

  perform public.avanzar_ganador(v_match.id);
end;
$$;

grant execute on function public.abandonar_torneo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2) Equipos: disuelto, motivo del historial, salir por cuenta
--    propia, transferir liderazgo.
-- ------------------------------------------------------------
alter table public.teams add column disuelto boolean not null default false;

alter table public.team_kicks_log
  add column motivo text not null default 'expulsado' check (motivo in ('expulsado', 'renuncia'));

-- quitar_miembro(): mismo comportamiento de siempre, ahora deja
-- explícito en el registro que fue una expulsión (no dependía del
-- default de la columna nueva para que quede claro en el propio
-- código, no solo en el esquema).
create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
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
    raise exception 'Solo el dueño del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
  values (p_team_id, p_user_id, auth.uid(), 'expulsado');

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.quitar_miembro(uuid, uuid) to authenticated;

-- salir_equipo(): la contraparte de quitar_miembro(), iniciada por el
-- propio jugador. Un miembro común sale sin más trámite. El dueño
-- solo puede usar esta misma función si es el ÚNICO miembro que
-- queda -- en ese caso el equipo no se borra, queda marcado disuelto
-- (así el historial, las apuestas resueltas, etc. no quedan
-- huérfanos) y perfil_tipo del ahora ex-dueño vuelve a 'jugador'. Si
-- el equipo tiene más gente, el dueño tiene que transferir el
-- liderazgo primero (transferir_liderazgo(), más abajo) -- después de
-- eso ya no es dueño y puede usar esta misma función sin problema.
create or replace function public.salir_equipo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_roles text[];
  v_total_miembros int;
begin
  select tm.team_id, tm.roles into v_team_id, v_roles
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'No perteneces a ningún equipo.';
  end if;

  perform 1 from public.teams where id = v_team_id for update;

  if v_roles @> array['owner']::text[] then
    select count(*) into v_total_miembros from public.team_members where team_id = v_team_id;

    if v_total_miembros > 1 then
      raise exception 'Como dueño del equipo, primero debes transferir el liderazgo a otro miembro antes de salir.';
    end if;

    insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
    values (v_team_id, auth.uid(), auth.uid(), 'renuncia');

    delete from public.team_members where user_id = auth.uid();
    update public.teams set disuelto = true where id = v_team_id;
    update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
    return;
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo)
  values (v_team_id, auth.uid(), auth.uid(), 'renuncia');

  delete from public.team_members where user_id = auth.uid();
end;
$$;

grant execute on function public.salir_equipo() to authenticated;

-- transferir_liderazgo(): mismo criterio de perfil_tipo que
-- crear_membresia_owner() (migración 011) -- crear un equipo o
-- recibir su liderazgo son las dos únicas formas de volverse
-- lider_clan, siempre a mano vía estas funciones, nunca eligiéndolo
-- directo.
create or replace function public.transferir_liderazgo(p_nuevo_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_es_miembro boolean;
begin
  select * into v_team from public.teams where owner_id = auth.uid() for update;

  if v_team is null then
    raise exception 'No eres dueño de ningún equipo.';
  end if;

  if v_team.disuelto then
    raise exception 'Este equipo ya fue disuelto.';
  end if;

  if p_nuevo_owner_id = auth.uid() then
    raise exception 'Ya eres el dueño de este equipo.';
  end if;

  select exists (
    select 1 from public.team_members where team_id = v_team.id and user_id = p_nuevo_owner_id
  ) into v_es_miembro;

  if not v_es_miembro then
    raise exception 'Ese jugador no pertenece a tu equipo.';
  end if;

  update public.team_members set roles = array['owner']::text[]
    where team_id = v_team.id and user_id = p_nuevo_owner_id;
  update public.team_members set roles = array['jugador']::text[]
    where team_id = v_team.id and user_id = auth.uid();

  update public.teams set owner_id = p_nuevo_owner_id where id = v_team.id;

  update public.profiles set perfil_tipo = 'lider_clan' where id = p_nuevo_owner_id;
  update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
end;
$$;

grant execute on function public.transferir_liderazgo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) Que "disuelto" signifique algo: bloquea las tres formas de
--    volver a sumar gente a un equipo disuelto (unirse con el código
--    de invitación, que el ex-dueño invite, aceptar una invitación
--    vieja que haya quedado pendiente).
-- ------------------------------------------------------------
drop policy if exists "team_members_insert_propio" on public.team_members;
create policy "team_members_insert_propio"
  on public.team_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and roles = array['jugador']::text[]
    and not public.esta_suspendido()
    and exists (select 1 from public.teams t where t.id = team_id and not t.disuelto)
  );

create or replace function public.invitar_jugador(p_team_id uuid, p_invited_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_owner boolean;
begin
  select exists (
    select 1 from public.teams where id = p_team_id and owner_id = auth.uid() and not disuelto
  ) into v_es_owner;

  if not v_es_owner then
    raise exception 'Solo el dueño del equipo puede invitar jugadores.';
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

grant execute on function public.invitar_jugador(uuid, uuid) to authenticated;

create or replace function public.aceptar_invitacion(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
  v_disuelto boolean;
begin
  select * into v_invitacion from public.team_invitations where id = p_invitation_id for update;

  if v_invitacion is null then
    raise exception 'Esa invitación no existe.';
  end if;
  if v_invitacion.invited_user_id <> auth.uid() then
    raise exception 'Esta invitación no es tuya.';
  end if;
  if v_invitacion.status <> 'pendiente' then
    raise exception 'Esta invitación ya no está pendiente.';
  end if;
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  select disuelto into v_disuelto from public.teams where id = v_invitacion.team_id;
  if v_disuelto then
    raise exception 'Ese equipo ya no existe.';
  end if;

  insert into public.team_members (team_id, user_id, roles)
  values (v_invitacion.team_id, auth.uid(), array['jugador']::text[]);

  update public.team_invitations set status = 'aceptada' where id = p_invitation_id;
end;
$$;

grant execute on function public.aceptar_invitacion(uuid) to authenticated;
