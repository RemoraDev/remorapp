-- ------------------------------------------------------------
-- Migración 081: las solicitudes de amistad entre equipos pasan a ser
-- exclusivas del dueño del equipo (quien lo creó), no "dueño o
-- capitán" -- mismo criterio que ya usa proponer_alianza(): es una
-- decisión de fondo del equipo, no una tarea operativa que se pueda
-- delegar a un capitán. Afecta enviar, responder Y ver las
-- solicitudes (la política de select también usaba
-- es_capitan_o_dueno()).
-- ------------------------------------------------------------

drop policy if exists "team_amistades_select" on public.team_amistades;

create policy "team_amistades_select"
  on public.team_amistades for select
  to authenticated
  using (
    exists (select 1 from public.teams where id = equipo_solicitante_id and owner_id = auth.uid())
    or exists (select 1 from public.teams where id = equipo_destinatario_id and owner_id = auth.uid())
  );

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
  if not exists (select 1 from public.teams where id = v_equipo_propio_id and owner_id = auth.uid()) then
    raise exception 'Solo el dueño del equipo puede enviar solicitudes de amistad.';
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
  if not exists (select 1 from public.teams where id = v_amistad.equipo_destinatario_id and owner_id = auth.uid()) then
    raise exception 'Solo el dueño del equipo que recibió la solicitud puede responderla.';
  end if;

  update public.team_amistades
    set status = case when p_aceptar then 'aceptada' else 'rechazada' end,
        respondida_en = now()
    where id = p_amistad_id;
end;
$$;
