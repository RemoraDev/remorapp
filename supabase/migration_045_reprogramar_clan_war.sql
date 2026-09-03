-- ============================================================
-- Migración 045: reprogramar una Clan War ya aceptada, en vez de solo
-- poder abandonarla.
--
-- 1) clan_war_reschedules: una fila por cada solicitud de cambio de
--    fecha. clan_wars.reprogramaciones_usadas cuenta cuántas veces YA
--    se aceptó un cambio -- una solicitud rechazada no cuenta para el
--    límite de 2, solo las aceptadas (así un capitán que rechaza de
--    mala fe no le "gasta" el límite al otro equipo).
-- 2) solicitar_reprogramacion_cw(): dueño o capitán de cualquiera de
--    los dos equipos, solo con la CW en 'aceptada' (todavía no llegó
--    a check-in -- en 'en_curso' ya no tiene sentido reprogramar).
--    Además de las 2 reprogramaciones máximo, se agregó un chequeo no
--    pedido explícitamente pero necesario: no se puede proponer una
--    fecha nueva si ya hay otra solicitud pendiente de respuesta --
--    sin esto, un capitán podría acumular varias propuestas sueltas
--    antes de que el rival responda ninguna.
-- 3) responder_reprogramacion_cw(): exclusivo del capitán/dueño del
--    OTRO equipo (no quien la propuso) -- ver el chequeo explícito
--    adentro. Aceptar mueve fecha_hora_cet y suma
--    reprogramaciones_usadas; rechazar no toca la fecha.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.clan_wars add column if not exists reprogramaciones_usadas integer not null default 0;

create table public.clan_war_reschedules (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id) on delete cascade,
  propuesto_por uuid not null references public.teams (id),
  nueva_fecha_hora_cet timestamptz not null,
  motivo text,
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now()
);

alter table public.clan_war_reschedules enable row level security;

-- Mismo criterio que clan_war_lineup: solo el dueño o un capitán de
-- alguno de los dos equipos de la Clan War en cuestión.
create policy "clan_war_reschedules_select_propio"
  on public.clan_war_reschedules for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es solicitar_reprogramacion_cw() y
-- responder_reprogramacion_cw(), security definer.
grant select on public.clan_war_reschedules to authenticated;

create or replace function public.solicitar_reprogramacion_cw(
  p_clan_war_id uuid,
  p_nueva_fecha_hora_cet timestamptz,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Solo se puede reprogramar una Clan War aceptada, antes de llegar al check-in.';
  end if;

  if v_reto.reprogramaciones_usadas >= 2 then
    raise exception 'Ya se usaron las 2 reprogramaciones permitidas para esta Clan War.';
  end if;

  if exists (
    select 1 from public.clan_war_reschedules where clan_war_id = p_clan_war_id and status = 'pendiente'
  ) then
    raise exception 'Ya hay una solicitud de cambio de fecha pendiente de respuesta.';
  end if;

  if p_nueva_fecha_hora_cet <= now() then
    raise exception 'La nueva fecha y hora debe ser en el futuro.';
  end if;

  insert into public.clan_war_reschedules (clan_war_id, propuesto_por, nueva_fecha_hora_cet, motivo)
  values (p_clan_war_id, v_mi_team_id, p_nueva_fecha_hora_cet, nullif(trim(coalesce(p_motivo, '')), ''));
end;
$$;

grant execute on function public.solicitar_reprogramacion_cw(uuid, timestamptz, text) to authenticated;

create or replace function public.responder_reprogramacion_cw(p_reschedule_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_reto record;
  v_mi_team_id uuid;
begin
  select * into v_solicitud from public.clan_war_reschedules where id = p_reschedule_id for update;
  if v_solicitud is null then
    raise exception 'Esa solicitud no existe.';
  end if;
  if v_solicitud.status <> 'pendiente' then
    raise exception 'Esta solicitud ya fue respondida.';
  end if;

  select * into v_reto from public.clan_wars where id = v_solicitud.clan_war_id for update;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_mi_team_id = v_solicitud.propuesto_por then
    raise exception 'No puedes responder tu propia solicitud de reprogramación -- le toca al otro equipo.';
  end if;

  if p_aceptar then
    update public.clan_wars
      set fecha_hora_cet = v_solicitud.nueva_fecha_hora_cet,
          reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = v_reto.id;
    update public.clan_war_reschedules set status = 'aceptada' where id = p_reschedule_id;
  else
    update public.clan_war_reschedules set status = 'rechazada' where id = p_reschedule_id;
  end if;
end;
$$;

grant execute on function public.responder_reprogramacion_cw(uuid, boolean) to authenticated;
