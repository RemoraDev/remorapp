-- ============================================================
-- Migración 021: Clan Wars -- Fase 1 (proponer y responder retos
-- entre clanes). Sin check-in, sin ajuste de MMR, sin caster ni
-- transmisión todavía -- eso son fases siguientes.
--
-- La migración 020 ya había dejado dicho, en el comentario de
-- banca_rota, que "no puede retar por puntos" se aplicaría de verdad
-- en esta fase -- es lo que hace acá: un equipo en banca rota no
-- puede proponer ni ser desafiado a un reto.
--
-- Sobre fecha_hora_cet: se guarda como timestamptz (un instante
-- absoluto), no como una hora local "ingenua" fijada a CET. Es
-- deliberado, y más correcto que guardar un timestamp sin huso:
-- Europa cambia de CET (UTC+1) a CEST (UTC+2) con el horario de
-- verano, así que "la hora CET" de un instante concreto no es un
-- desplazamiento fijo todo el año. Guardando el instante real,
-- "convertir a CET para mostrarla" y "convertir a la hora local de
-- cada quien" son, en cualquier momento del año, una conversión de
-- huso horario correcta -- nunca se desincronizan entre sí, que es
-- justamente lo que se busca con "hora CET como referencia fija".
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create table public.clan_wars (
  id uuid primary key default gen_random_uuid(),
  challenger_team_id uuid not null references public.teams (id),
  challenged_team_id uuid not null references public.teams (id),
  fecha_hora_cet timestamptz not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
  motivo_rechazo text
    check (motivo_rechazo in (
      'Falta de jugadores', 'Conflicto de horario', 'Ya tenemos guerra ese día',
      'Roster incompleto', 'Otro'
    )),
  -- Solo tiene sentido (y solo puede estar lleno) cuando el motivo es
  -- 'Otro' -- en cualquier otro caso el motivo fijo ya lo dice todo.
  motivo_detalle text,
  created_at timestamptz not null default now(),
  check (challenger_team_id <> challenged_team_id),
  check (motivo_rechazo = 'Otro' or motivo_detalle is null),
  check (motivo_rechazo is distinct from 'Otro' or motivo_detalle is not null)
);

alter table public.clan_wars enable row level security;

-- Solo los dueños de los dos equipos involucrados ven el detalle de
-- un reto -- ni siquiera otro miembro del mismo equipo (pedido
-- explícito: "solo los owners... pueden... ver el detalle").
create policy "clan_wars_select_propio"
  on public.clan_wars for select
  to authenticated
  using (
    exists (select 1 from public.teams t where t.id = challenger_team_id and t.owner_id = auth.uid())
    or exists (select 1 from public.teams t where t.id = challenged_team_id and t.owner_id = auth.uid())
  );

grant select on public.clan_wars to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es proponer_clan_war() y
-- responder_clan_war(), security definer, mismo patrón que
-- reportar_resultado() y el resto de las mutaciones sensibles del
-- proyecto.
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
  select * into v_challenger from public.teams where owner_id = auth.uid();
  if v_challenger is null then
    raise exception 'No eres dueño de ningún equipo.';
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

  -- Cooldown de 7 días desde el último reto entre estos dos equipos,
  -- en cualquier dirección y sin importar el resultado (pendiente,
  -- aceptada, rechazada o cancelada cuentan igual).
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

grant execute on function public.proponer_clan_war(uuid, timestamptz) to authenticated;

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
end;
$$;

grant execute on function public.responder_clan_war(uuid, boolean, text, text) to authenticated;
