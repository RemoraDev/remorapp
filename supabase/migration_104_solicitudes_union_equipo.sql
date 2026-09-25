-- ------------------------------------------------------------
-- Migración 104: solicitudes de unión a un equipo -- hasta ahora la
-- única forma de sumarse a un clan era que el líder invitara a un
-- jugador puntual, o que el jugador ya tuviera el código de
-- invitación de memoria. Esto agrega el camino inverso: cualquier
-- jugador sin equipo puede pedir unirse desde la ficha pública de
-- cualquier clan, quedando pendiente de que el dueño o un capitán lo
-- acepte o lo rechace -- mismo espíritu que team_invitations, pero
-- iniciado por el jugador en vez de por el equipo.
-- ------------------------------------------------------------

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  solicitante_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now()
);

-- Mientras tenga una solicitud pendiente a ESTE equipo, no puede
-- mandar otra -- igual que team_invitations_pendiente_unica, pero
-- puede volver a pedir más adelante si esta se rechaza.
create unique index team_join_requests_pendiente_unica
  on public.team_join_requests (team_id, solicitante_id)
  where (status = 'pendiente');

alter table public.team_join_requests enable row level security;

-- A diferencia de team_invitations_select (que solo deja ver al
-- owner), acá también puede verlas cualquier capitán -- así lo pidió
-- el organizador para esta función nueva.
create policy "team_join_requests_select"
  on public.team_join_requests for select
  to authenticated
  using (
    solicitante_id = auth.uid()
    or public.es_capitan_o_dueno(team_id)
  );

grant select on public.team_join_requests to authenticated;

-- Sin política de insert/update para authenticated a propósito --
-- igual que team_invitations, toda escritura pasa por las tres
-- funciones de abajo, security definer.

create or replace function public.solicitar_union_equipo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  if not public.cuenta_validada_ok() then
    raise exception 'Tu cuenta todavía no está validada -- completa nick, país, región y Battle.net en tu perfil.';
  end if;

  if not exists (select 1 from public.teams where id = p_team_id and not disuelto) then
    raise exception 'Ese equipo no existe.';
  end if;

  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a un equipo.';
  end if;

  if exists (
    select 1 from public.team_join_requests
    where team_id = p_team_id and solicitante_id = auth.uid() and status = 'pendiente'
  ) then
    raise exception 'Ya tienes una solicitud pendiente para este equipo.';
  end if;

  insert into public.team_join_requests (team_id, solicitante_id)
  values (p_team_id, auth.uid());
end;
$$;

grant execute on function public.solicitar_union_equipo(uuid) to authenticated;

create or replace function public.aceptar_solicitud_union(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_disuelto boolean;
begin
  select * into v_solicitud from public.team_join_requests where id = p_request_id for update;

  if v_solicitud is null then
    raise exception 'Esa solicitud no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_solicitud.team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede aceptar esta solicitud.';
  end if;

  if v_solicitud.status <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente.';
  end if;

  select disuelto into v_disuelto from public.teams where id = v_solicitud.team_id;
  if v_disuelto then
    raise exception 'Ese equipo ya no existe.';
  end if;

  begin
    insert into public.team_members (team_id, user_id, roles)
    values (v_solicitud.team_id, v_solicitud.solicitante_id, array['jugador']::text[]);
  exception
    when unique_violation then
      raise exception 'Ese jugador ya pertenece a un equipo.';
  end;

  update public.team_join_requests set status = 'aceptada' where id = p_request_id;
end;
$$;

grant execute on function public.aceptar_solicitud_union(uuid) to authenticated;

create or replace function public.rechazar_solicitud_union(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
begin
  select * into v_solicitud from public.team_join_requests where id = p_request_id for update;

  if v_solicitud is null then
    raise exception 'Esa solicitud no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_solicitud.team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede rechazar esta solicitud.';
  end if;

  if v_solicitud.status <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente.';
  end if;

  update public.team_join_requests set status = 'rechazada' where id = p_request_id;
end;
$$;

grant execute on function public.rechazar_solicitud_union(uuid) to authenticated;

-- ------------------------------------------------------------
-- Contador de notificaciones (migración 096): se agrega el término de
-- solicitudes de unión pendientes para cualquier equipo del que sea
-- dueño o capitán -- mismo criterio que el resto de los términos, solo
-- cuenta lo que espera MI acción.
-- ------------------------------------------------------------
create or replace function public.notificaciones_pendientes_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::integer from public.team_invitations
      where invited_user_id = auth.uid() and status = 'pendiente'
    )
    +
    (
      select count(*)::integer from public.torneo_invitaciones_equipo ti
      where ti.status = 'pendiente' and public.es_capitan_o_dueno(ti.equipo_id)
    )
    +
    public.retos_clan_war_pendientes_count()
    +
    (
      select count(*)::integer
      from public.clan_war_reschedules r
      join public.clan_wars cw on cw.id = r.clan_war_id
      where r.status = 'pendiente'
        and (
          (cw.challenger_team_id = r.propuesto_por and public.es_capitan_o_dueno(cw.challenged_team_id))
          or (cw.challenged_team_id = r.propuesto_por and public.es_capitan_o_dueno(cw.challenger_team_id))
        )
    )
    +
    (
      select count(*)::integer from public.titulos_padre_hijo
      where status = 'pendiente' and tipo = 'jugador' and retado_id = auth.uid()
    )
    +
    (
      select count(*)::integer from public.titulos_padre_hijo
      where status = 'pendiente' and tipo = 'clan' and public.es_capitan_o_dueno(retado_id)
    )
    +
    (
      select count(*)::integer from public.team_join_requests
      where status = 'pendiente' and public.es_capitan_o_dueno(team_id)
    );
$$;

grant execute on function public.notificaciones_pendientes_count() to authenticated;
