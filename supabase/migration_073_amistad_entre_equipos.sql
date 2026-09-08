-- ------------------------------------------------------------
-- Migración 073: amistad entre equipos, y una vía rápida para que un
-- organizador invite a sus equipos amigos a un torneo por equipos --
-- a diferencia de organizador_inscribir_equipo() (que inscribe
-- directo, sin pedirle nada al equipo invitado, y sigue existiendo
-- igual que antes para cualquier equipo), esta es una invitación real
-- que el equipo invitado tiene que aceptar desde su Panel de control,
-- y solo puede mandarse a un equipo que ya sea amigo.
-- ------------------------------------------------------------

create table public.team_amistades (
  id uuid primary key default gen_random_uuid(),
  equipo_solicitante_id uuid not null references public.teams (id) on delete cascade,
  equipo_destinatario_id uuid not null references public.teams (id) on delete cascade,
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now(),
  respondida_en timestamptz,
  check (equipo_solicitante_id <> equipo_destinatario_id)
);

-- Como máximo una solicitud pendiente entre dos equipos, sin importar
-- quién la mandó primero -- least/greatest normaliza el par sin
-- importar el orden de las columnas.
create unique index team_amistades_pendiente_unica
  on public.team_amistades (least(equipo_solicitante_id, equipo_destinatario_id), greatest(equipo_solicitante_id, equipo_destinatario_id))
  where (status = 'pendiente');

alter table public.team_amistades enable row level security;

create policy "team_amistades_select"
  on public.team_amistades for select
  to authenticated
  using (
    public.es_capitan_o_dueno(equipo_solicitante_id) or public.es_capitan_o_dueno(equipo_destinatario_id)
  );

grant select on public.team_amistades to authenticated;

create or replace function public.solicitar_amistad_equipo(p_equipo_destinatario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipo_propio_id uuid;
begin
  select team_id into v_equipo_propio_id from public.team_members where user_id = auth.uid();

  if v_equipo_propio_id is null then
    raise exception 'Necesitas pertenecer a un equipo para enviar una solicitud de amistad.';
  end if;
  if not public.es_capitan_o_dueno(v_equipo_propio_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede enviar solicitudes de amistad.';
  end if;
  if v_equipo_propio_id = p_equipo_destinatario_id then
    raise exception 'Un equipo no puede enviarse una solicitud de amistad a sí mismo.';
  end if;
  if not exists (select 1 from public.teams where id = p_equipo_destinatario_id and not disuelto) then
    raise exception 'Ese equipo no existe o está disuelto.';
  end if;
  if exists (
    select 1 from public.team_amistades
    where status in ('pendiente', 'aceptada')
      and (
        (equipo_solicitante_id = v_equipo_propio_id and equipo_destinatario_id = p_equipo_destinatario_id)
        or (equipo_solicitante_id = p_equipo_destinatario_id and equipo_destinatario_id = v_equipo_propio_id)
      )
  ) then
    raise exception 'Ya existe una solicitud o amistad entre estos dos equipos.';
  end if;

  insert into public.team_amistades (equipo_solicitante_id, equipo_destinatario_id)
  values (v_equipo_propio_id, p_equipo_destinatario_id);
end;
$$;

grant execute on function public.solicitar_amistad_equipo(uuid) to authenticated;

create or replace function public.responder_amistad_equipo(p_amistad_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amistad record;
begin
  select * into v_amistad from public.team_amistades where id = p_amistad_id for update;

  if v_amistad is null then
    raise exception 'Esa solicitud no existe.';
  end if;
  if v_amistad.status <> 'pendiente' then
    raise exception 'Esa solicitud ya fue respondida.';
  end if;
  -- Solo el equipo que RECIBIÓ la solicitud puede responderla -- el
  -- que la mandó no puede autoaceptarse.
  if not public.es_capitan_o_dueno(v_amistad.equipo_destinatario_id) then
    raise exception 'Solo el equipo que recibió la solicitud puede responderla.';
  end if;

  update public.team_amistades
    set status = case when p_aceptar then 'aceptada' else 'rechazada' end,
        respondida_en = now()
    where id = p_amistad_id;
end;
$$;

grant execute on function public.responder_amistad_equipo(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- Invitación de un equipo amigo a un torneo por equipos, con
-- aceptación real -- ver el comentario del encabezado.
-- ------------------------------------------------------------

create table public.torneo_invitaciones_equipo (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  equipo_id uuid not null references public.teams (id) on delete cascade,
  invitado_por uuid not null references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now(),
  respondida_en timestamptz
);

create unique index torneo_invitaciones_equipo_pendiente_unica
  on public.torneo_invitaciones_equipo (tournament_id, equipo_id)
  where (status = 'pendiente');

alter table public.torneo_invitaciones_equipo enable row level security;

create policy "torneo_invitaciones_equipo_select"
  on public.torneo_invitaciones_equipo for select
  to authenticated
  using (
    public.es_capitan_o_dueno(equipo_id)
    or exists (select 1 from public.tournaments t where t.id = tournament_id and t.creador_id = auth.uid())
  );

grant select on public.torneo_invitaciones_equipo to authenticated;

create or replace function public.invitar_equipo_amigo_torneo(p_tournament_id uuid, p_equipo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_equipo_organizador_id uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador del torneo puede invitar equipos.';
  end if;
  if v_torneo.formato not in ('2v2', '3v3', '4v4') then
    raise exception 'Este torneo no es por equipos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;

  select team_id into v_equipo_organizador_id from public.team_members where user_id = auth.uid();

  if v_equipo_organizador_id is null then
    raise exception 'Necesitas pertenecer a un equipo para invitar equipos amigos.';
  end if;

  if not exists (
    select 1 from public.team_amistades
    where status = 'aceptada'
      and (
        (equipo_solicitante_id = v_equipo_organizador_id and equipo_destinatario_id = p_equipo_id)
        or (equipo_solicitante_id = p_equipo_id and equipo_destinatario_id = v_equipo_organizador_id)
      )
  ) then
    raise exception 'Ese equipo no es amigo de tu equipo.';
  end if;

  if exists (select 1 from public.tournament_participants where tournament_id = p_tournament_id and team_id = p_equipo_id) then
    raise exception 'Ese equipo ya está inscrito en este torneo.';
  end if;

  insert into public.torneo_invitaciones_equipo (tournament_id, equipo_id, invitado_por)
  values (p_tournament_id, p_equipo_id, auth.uid());
end;
$$;

grant execute on function public.invitar_equipo_amigo_torneo(uuid, uuid) to authenticated;

create or replace function public.responder_invitacion_torneo_equipo(p_invitacion_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
  v_torneo record;
  v_miembros int;
  v_minimo int;
begin
  select * into v_invitacion from public.torneo_invitaciones_equipo where id = p_invitacion_id for update;

  if v_invitacion is null then
    raise exception 'Esa invitación no existe.';
  end if;
  if v_invitacion.status <> 'pendiente' then
    raise exception 'Esa invitación ya fue respondida.';
  end if;
  if not public.es_capitan_o_dueno(v_invitacion.equipo_id) then
    raise exception 'Solo el dueño o un capitán del equipo invitado puede responder.';
  end if;

  if not p_aceptar then
    update public.torneo_invitaciones_equipo set status = 'rechazada', respondida_en = now() where id = p_invitacion_id;
    return;
  end if;

  select * into v_torneo from public.tournaments where id = v_invitacion.tournament_id for update;

  if v_torneo is null or v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;
  if exists (select 1 from public.tournament_participants where tournament_id = v_torneo.id and team_id = v_invitacion.equipo_id) then
    raise exception 'Tu equipo ya está inscrito en este torneo.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = v_invitacion.equipo_id;
  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
  end;
  if v_miembros < v_minimo then
    raise exception 'Tu equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  insert into public.tournament_participants (tournament_id, team_id) values (v_torneo.id, v_invitacion.equipo_id);

  update public.torneo_invitaciones_equipo set status = 'aceptada', respondida_en = now() where id = p_invitacion_id;
end;
$$;

grant execute on function public.responder_invitacion_torneo_equipo(uuid, boolean) to authenticated;
