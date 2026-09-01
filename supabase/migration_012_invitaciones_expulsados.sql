-- ============================================================
-- Migración 012: invitaciones reales a equipo + historial de
-- expulsados, dentro del Panel de control.
--
--   1) team_invitations: el dueño busca un jugador por Nick#ID y le
--      manda invitación. El jugador la ve en su cuenta y la acepta o
--      la rechaza. Aceptar usa el MISMO camino que unirse por código
--      (mismo insert en team_members, misma restricción "un jugador,
--      un equipo" -- user_id es la primary key de esa tabla).
--   2) team_kicks_log: extiende quitar_miembro() (no la duplica) para
--      que además de sacar al jugador, quede el registro.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) team_invitations
-- ------------------------------------------------------------
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  invited_user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now()
);

-- Mientras una invitación de ESTE equipo a ESTE jugador siga
-- pendiente, no se puede mandar otra -- pero sí se puede volver a
-- invitar más adelante si la rechazó o si en algún momento dejó el
-- equipo (por eso el índice único es solo sobre las pendientes, no
-- sobre toda la tabla).
create unique index team_invitations_pendiente_unica
  on public.team_invitations (team_id, invited_user_id)
  where (status = 'pendiente');

alter table public.team_invitations enable row level security;

-- El dueño ve las invitaciones que mandó su equipo; el jugador
-- invitado ve las que le mandaron a él. Nadie más ve nada de esta
-- tabla.
create policy "team_invitations_select"
  on public.team_invitations for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or exists (
      select 1 from public.teams t
      where t.id = team_id and t.owner_id = auth.uid()
    )
  );

-- A propósito NO hay política INSERT/UPDATE para authenticated:
-- invitar_jugador(), aceptar_invitacion() y rechazar_invitacion() (más
-- abajo) son la única puerta -- mismo patrón que quitar_miembro().
grant select on public.team_invitations to authenticated;

-- ------------------------------------------------------------
-- 2) team_kicks_log
-- ------------------------------------------------------------
create table public.team_kicks_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  kicked_by uuid not null references public.profiles (id),
  kicked_at timestamptz not null default now()
);

alter table public.team_kicks_log enable row level security;

-- Solo el dueño del equipo ve su propio historial de expulsados.
create policy "team_kicks_log_select_propio"
  on public.team_kicks_log for select
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = team_id and t.owner_id = auth.uid()
    )
  );

-- Sin política INSERT para authenticated: solo quitar_miembro() (más
-- abajo) escribe acá, nunca directo desde el frontend.
grant select on public.team_kicks_log to authenticated;

-- ------------------------------------------------------------
-- 3) invitar_jugador: el dueño manda una invitación real. Bloquea si
--    el jugador ya tiene equipo o si ya hay una invitación pendiente
--    de este mismo equipo para él.
-- ------------------------------------------------------------
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
    select 1 from public.teams where id = p_team_id and owner_id = auth.uid()
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

-- ------------------------------------------------------------
-- 4) aceptar_invitacion: mismo insert en team_members que unirse por
--    código (misma tabla, mismo rol 'jugador'), y la primary key de
--    team_members se sigue encargando sola de "un jugador, un
--    equipo" -- si ya está en otro, esto falla igual que fallaría el
--    código de invitación.
-- ------------------------------------------------------------
create or replace function public.aceptar_invitacion(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
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
  -- team_members_insert_propio (la política normal) exige esto mismo
  -- -- como acá se entra por security definer y esa política no se
  -- aplica, se repite el chequeo a mano.
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  insert into public.team_members (team_id, user_id, roles)
  values (v_invitacion.team_id, auth.uid(), array['jugador']::text[]);

  update public.team_invitations set status = 'aceptada' where id = p_invitation_id;
end;
$$;

grant execute on function public.aceptar_invitacion(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) rechazar_invitacion: queda en 'rechazada' para siempre -- no hay
--    forma de "volver a aceptar" una ya rechazada (el chequeo de
--    status <> 'pendiente' de aceptar_invitacion() ya lo impide solo).
-- ------------------------------------------------------------
create or replace function public.rechazar_invitacion(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitacion record;
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

  update public.team_invitations set status = 'rechazada' where id = p_invitation_id;
end;
$$;

grant execute on function public.rechazar_invitacion(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6) quitar_miembro: se extiende (no se duplica) para que deje
--    registro en team_kicks_log antes de borrar la fila.
-- ------------------------------------------------------------
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
    raise exception 'Solo el dueño del equipo puede sacar miembros wn.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by)
  values (p_team_id, p_user_id, auth.uid());

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;
