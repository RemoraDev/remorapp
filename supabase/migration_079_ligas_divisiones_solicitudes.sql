-- ------------------------------------------------------------
-- Migración 079: rediseño del flujo de creación de torneos -- dos
-- piezas del lado de la base.
--
-- 1) Divisiones de StarLeague Latam: se reemplazan las que había
--    (Diamond 1-2, Diamond 3, Master 3, Masters) por las 5 pedidas
--    (Diamante 3, Diamante 2, Diamante 1, Master, Master a GM). Los
--    límites de MMR usan exactamente los mismos cortes que ya usa
--    calcular_liga() en toda la app (Diamante 3 termina en 3493,
--    Diamante 2 en 3867, Diamante 1 en 4240, Master cubre Maestro
--    3/2/1 hasta 4960, y "Master a GM" queda sin límite superior --
--    de ahí para arriba, incluido Gran Maestro).
--
-- 2) Solicitud de ingreso a un torneo por equipos: hasta ahora un
--    equipo solo podía entrar por inscripción libre (sin pedir nada)
--    o por invitación del organizador. Se agrega una tercera vía --
--    el equipo pide entrar, y el organizador la acepta o rechaza --
--    pensada para torneos de liga, donde la inscripción libre queda
--    deshabilitada del lado del cliente (ver TournamentDetailPage).
-- ------------------------------------------------------------

do $$
declare
  v_liga_id uuid;
begin
  select id into v_liga_id from public.ligas where nombre = 'StarLeague Latam';

  if v_liga_id is not null then
    -- Algunos torneos ya existentes usan las divisiones viejas
    -- (division_id no tiene "on delete cascade/set null") -- hay que
    -- desvincularlos antes de poder borrar esas filas. Quedan sin
    -- división asignada, nada más se pierde.
    update public.tournaments
      set division_id = null
      where division_id in (select id from public.divisiones_liga where liga_id = v_liga_id);

    delete from public.divisiones_liga where liga_id = v_liga_id;

    insert into public.divisiones_liga (liga_id, nombre, mmr_limite) values
      (v_liga_id, 'Diamante 3', 3493),
      (v_liga_id, 'Diamante 2', 3867),
      (v_liga_id, 'Diamante 1', 4240),
      (v_liga_id, 'Master', 4960),
      (v_liga_id, 'Master a GM', null);
  end if;
end;
$$;

create table public.torneo_solicitudes_equipo (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  equipo_id uuid not null references public.teams (id) on delete cascade,
  solicitado_por uuid not null references public.profiles (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now(),
  respondida_en timestamptz
);

create unique index torneo_solicitudes_equipo_pendiente_unica
  on public.torneo_solicitudes_equipo (tournament_id, equipo_id)
  where (status = 'pendiente');

alter table public.torneo_solicitudes_equipo enable row level security;

create policy "torneo_solicitudes_equipo_select"
  on public.torneo_solicitudes_equipo for select
  to authenticated
  using (
    public.es_capitan_o_dueno(equipo_id)
    or exists (select 1 from public.tournaments t where t.id = tournament_id and t.creador_id = auth.uid())
  );

grant select on public.torneo_solicitudes_equipo to authenticated;

create or replace function public.solicitar_ingreso_torneo(p_tournament_id uuid, p_equipo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_miembros int;
  v_minimo int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.formato not in ('2v2', '3v3', '4v4') then
    raise exception 'Este torneo no es por equipos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if not public.es_capitan_o_dueno(p_equipo_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede solicitar el ingreso.';
  end if;
  if exists (
    select 1 from public.tournament_participants where tournament_id = p_tournament_id and team_id = p_equipo_id
  ) then
    raise exception 'Tu equipo ya está inscrito en este torneo.';
  end if;

  select count(*) into v_miembros from public.team_members where team_id = p_equipo_id;
  v_minimo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
  end;
  if v_miembros < v_minimo then
    raise exception 'Tu equipo necesita al menos % miembros para un torneo %, y tiene %.',
      v_minimo, v_torneo.formato, v_miembros;
  end if;

  insert into public.torneo_solicitudes_equipo (tournament_id, equipo_id, solicitado_por)
  values (p_tournament_id, p_equipo_id, auth.uid());
end;
$$;

grant execute on function public.solicitar_ingreso_torneo(uuid, uuid) to authenticated;

create or replace function public.responder_solicitud_torneo(p_solicitud_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_torneo record;
begin
  select * into v_solicitud from public.torneo_solicitudes_equipo where id = p_solicitud_id for update;

  if v_solicitud is null then
    raise exception 'Esa solicitud no existe.';
  end if;
  if v_solicitud.status <> 'pendiente' then
    raise exception 'Esa solicitud ya fue respondida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_solicitud.tournament_id for update;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede responder esta solicitud.';
  end if;

  if not p_aceptar then
    update public.torneo_solicitudes_equipo set status = 'rechazada', respondida_en = now() where id = p_solicitud_id;
    return;
  end if;

  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no acepta inscripciones.';
  end if;
  if v_torneo.cupos_ocupados >= v_torneo.cupos_totales then
    raise exception 'Este torneo ya no tiene cupos disponibles.';
  end if;
  if exists (
    select 1 from public.tournament_participants where tournament_id = v_torneo.id and team_id = v_solicitud.equipo_id
  ) then
    raise exception 'Ese equipo ya está inscrito en este torneo.';
  end if;

  insert into public.tournament_participants (tournament_id, team_id) values (v_torneo.id, v_solicitud.equipo_id);

  update public.torneo_solicitudes_equipo set status = 'aceptada', respondida_en = now() where id = p_solicitud_id;
end;
$$;

grant execute on function public.responder_solicitud_torneo(uuid, boolean) to authenticated;
