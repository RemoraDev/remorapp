-- ============================================================
-- Migración 029: Torneos Históricos -- competencias jugadas antes de
-- que existiera RemorApp, con el flujo de consentimiento: solo se
-- confirman (y solo entonces dan el bono de cortesía de MMR) cuando
-- todos los clanes vinculados a un equipo real aceptan que quede
-- público. Se integra visualmente con la Sala de la Fama en una fase
-- aparte -- por ahora es una página simple.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create table public.historical_tournaments (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha_aproximada date not null,
  servidor text not null check (servidor in ('america', 'europe', 'asia')),
  primer_lugar_nombre text not null,
  -- Nullable: solo se vincula si ese clan está registrado hoy en
  -- RemorApp -- muchos torneos históricos son de clanes que ya no
  -- existen o nunca se registraron acá.
  primer_lugar_team_id uuid references public.teams (id),
  segundo_lugar_nombre text not null,
  segundo_lugar_team_id uuid references public.teams (id),
  creado_por uuid not null references public.profiles (id),
  estado text not null default 'pendiente_consentimiento'
    check (estado in ('pendiente_consentimiento', 'confirmado', 'referencia_historica')),
  created_at timestamptz not null default now()
);

alter table public.historical_tournaments enable row level security;

-- Público: la página /torneos-historicos lista todos, sin importar el
-- estado -- un registro rechazado sigue siendo "referencia histórica
-- visible", tal como se pidió.
create policy "historical_tournaments_select_publico"
  on public.historical_tournaments for select
  using (true);

grant select on public.historical_tournaments to anon, authenticated;

-- Sin política de insert para authenticated a propósito -- la única
-- forma de escribir acá es registrar_torneo_historico(), security
-- definer.

-- Roster completo del torneo (incluye 1° y 2° lugar, que también
-- aparecen resumidos arriba en historical_tournaments -- acá es donde
-- vive el consentimiento de cada uno). nombre_clan es siempre texto
-- libre; team_id solo si el creador lo vinculó a un equipo real.
create table public.historical_tournament_participants (
  id uuid primary key default gen_random_uuid(),
  historical_tournament_id uuid not null references public.historical_tournaments (id) on delete cascade,
  nombre_clan text not null,
  team_id uuid references public.teams (id),
  -- null hasta que responda (o para siempre, si no está vinculado --
  -- no hay a quién pedirle consentimiento).
  consentimiento boolean,
  created_at timestamptz not null default now()
);

alter table public.historical_tournament_participants enable row level security;

create policy "historical_tournament_participants_select_publico"
  on public.historical_tournament_participants for select
  using (true);

grant select on public.historical_tournament_participants to anon, authenticated;

-- Sin política de insert/update para authenticated -- la única forma
-- de escribir acá es registrar_torneo_historico() y
-- responder_consentimiento_historico(), security definer.

-- registrar_torneo_historico(): cualquier usuario puede registrar uno.
-- p_participantes es un jsonb con el RESTO de los clanes (sin contar
-- 1° y 2° lugar, que van por sus propios parámetros) -- cada elemento
-- es {"nombre_clan": "...", "team_id": "..." o null}. Si no queda
-- ningún participante vinculado a un equipo real, no hay nadie a
-- quien pedirle consentimiento -- el torneo se confirma directo.
create or replace function public.registrar_torneo_historico(
  p_nombre text,
  p_fecha_aproximada date,
  p_servidor text,
  p_primer_lugar_nombre text,
  p_primer_lugar_team_id uuid,
  p_segundo_lugar_nombre text,
  p_segundo_lugar_team_id uuid,
  p_participantes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo_id uuid;
  v_participante jsonb;
  v_hay_vinculados boolean;
begin
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El torneo necesita un nombre.';
  end if;
  if p_servidor not in ('america', 'europe', 'asia') then
    raise exception 'Ese servidor no es válido.';
  end if;
  if p_primer_lugar_nombre is null or trim(p_primer_lugar_nombre) = '' then
    raise exception 'Falta el nombre del primer lugar.';
  end if;
  if p_segundo_lugar_nombre is null or trim(p_segundo_lugar_nombre) = '' then
    raise exception 'Falta el nombre del segundo lugar.';
  end if;

  insert into public.historical_tournaments (
    nombre, fecha_aproximada, servidor,
    primer_lugar_nombre, primer_lugar_team_id,
    segundo_lugar_nombre, segundo_lugar_team_id,
    creado_por
  ) values (
    trim(p_nombre), p_fecha_aproximada, p_servidor,
    trim(p_primer_lugar_nombre), p_primer_lugar_team_id,
    trim(p_segundo_lugar_nombre), p_segundo_lugar_team_id,
    auth.uid()
  ) returning id into v_torneo_id;

  insert into public.historical_tournament_participants (historical_tournament_id, nombre_clan, team_id)
  values
    (v_torneo_id, trim(p_primer_lugar_nombre), p_primer_lugar_team_id),
    (v_torneo_id, trim(p_segundo_lugar_nombre), p_segundo_lugar_team_id);

  for v_participante in select * from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb))
  loop
    if trim(coalesce(v_participante->>'nombre_clan', '')) = '' then
      continue;
    end if;
    insert into public.historical_tournament_participants (historical_tournament_id, nombre_clan, team_id)
    values (
      v_torneo_id,
      trim(v_participante->>'nombre_clan'),
      nullif(v_participante->>'team_id', '')::uuid
    );
  end loop;

  select exists (
    select 1 from public.historical_tournament_participants
    where historical_tournament_id = v_torneo_id and team_id is not null
  ) into v_hay_vinculados;

  if not v_hay_vinculados then
    update public.historical_tournaments set estado = 'confirmado' where id = v_torneo_id;
  end if;

  return v_torneo_id;
end;
$$;

grant execute on function public.registrar_torneo_historico(text, date, text, text, uuid, text, uuid, jsonb) to authenticated;

-- responder_consentimiento_historico(): solo el dueño del equipo
-- vinculado a ese participante puntual. Rechazar deja el torneo como
-- 'referencia_historica' para siempre -- ningún bono para nadie, pero
-- el registro sigue visible. Aceptar solo confirma (+ bono, si
-- corresponde) cuando TODOS los vinculados ya aceptaron.
create or replace function public.responder_consentimiento_historico(p_participant_id uuid, p_acepta boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
  v_total_vinculados int;
  v_total_aceptados int;
begin
  select * into v_participante
  from public.historical_tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Ese participante no existe.';
  end if;
  if v_participante.team_id is null then
    raise exception 'Este participante no está vinculado a ningún equipo.';
  end if;

  if not exists (
    select 1 from public.teams where id = v_participante.team_id and owner_id = auth.uid()
  ) then
    raise exception 'Solo el dueño del equipo vinculado puede responder esta solicitud.';
  end if;

  select * into v_torneo
  from public.historical_tournaments
  where id = v_participante.historical_tournament_id
  for update;

  if v_torneo.estado <> 'pendiente_consentimiento' then
    raise exception 'Este torneo histórico ya fue resuelto.';
  end if;

  if v_participante.consentimiento is not null then
    raise exception 'Ya respondiste esta solicitud.';
  end if;

  update public.historical_tournament_participants
    set consentimiento = p_acepta
    where id = p_participant_id;

  if not p_acepta then
    update public.historical_tournaments set estado = 'referencia_historica' where id = v_torneo.id;
    return;
  end if;

  select count(*) into v_total_vinculados
  from public.historical_tournament_participants
  where historical_tournament_id = v_torneo.id and team_id is not null;

  select count(*) into v_total_aceptados
  from public.historical_tournament_participants
  where historical_tournament_id = v_torneo.id and team_id is not null and consentimiento = true;

  if v_total_vinculados = v_total_aceptados then
    update public.historical_tournaments set estado = 'confirmado' where id = v_torneo.id;

    -- Bono de cortesía -- solo si ese lugar específico tiene equipo
    -- real vinculado. Si el 1° o 2° puesto no está registrado en
    -- RemorApp, simplemente no recibe nada; el torneo se confirma
    -- igual para el resto.
    if v_torneo.primer_lugar_team_id is not null then
      update public.teams set mmr = mmr + 25 where id = v_torneo.primer_lugar_team_id;
    end if;
    if v_torneo.segundo_lugar_team_id is not null then
      update public.teams set mmr = mmr + 10 where id = v_torneo.segundo_lugar_team_id;
    end if;
  end if;
end;
$$;

grant execute on function public.responder_consentimiento_historico(uuid, boolean) to authenticated;
