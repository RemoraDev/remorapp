-- ============================================================
-- Migración 022: Clan Wars -- Fase 2 (check-in antes de la guerra).
-- Sin ajuste de MMR ni reporte de resultado todavía -- eso es la fase
-- siguiente, con las tablas de ganancia/pérdida de MMR.
--
-- Sobre check_in_abierto: la columna existe, pero NO es la fuente de
-- verdad de si la ventana de check-in está abierta. Esa ventana se
-- calcula comparando fecha_hora_cet con el instante actual (15
-- minutos antes) -- tanto en el frontend como, por las dudas, adentro
-- de confirmar_alineacion() -- porque mantenerla sincronizada como un
-- booleano guardado exigiría un proceso en segundo plano que la
-- prendiera sola llegado el momento, y el pedido fue explícito:
-- "no hace falta un proceso en segundo plano". La columna queda
-- creada para uso futuro (por ejemplo, si más adelante un admin
-- necesita forzar la apertura), pero ninguna función de esta
-- migración la lee ni la escribe.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.clan_wars add column check_in_abierto boolean not null default false;
alter table public.clan_wars add column challenger_confirmado boolean not null default false;
alter table public.clan_wars add column challenged_confirmado boolean not null default false;
alter table public.clan_wars add column caster_nombre text;
alter table public.clan_wars add column caster_link text;
-- Nullable a propósito: es obligatorio definirlo ANTES de que la
-- guerra pueda pasar a 'en_curso' (ver intentar_iniciar_clan_war()
-- más abajo), pero al proponerse el reto todavía no se sabe.
alter table public.clan_wars add column tiene_delay boolean;

-- 'en_curso' se suma a los estados que ya existían (migración 021).
-- No se puede "alterar" un check constraint en Postgres -- hay que
-- sacarlo y volver a crearlo con la lista completa.
alter table public.clan_wars drop constraint if exists clan_wars_status_check;
alter table public.clan_wars add constraint clan_wars_status_check
  check (status in ('pendiente', 'aceptada', 'rechazada', 'cancelada', 'en_curso'));

-- Reportes durante el check-in: cualquiera de los dos capitanes puede
-- reportar un problema sobre un jugador del roster RIVAL (nunca del
-- propio). 'no_se_presento' queda registrado acá nada más por ahora
-- -- bajarle la confiabilidad a ese jugador es una fase aparte,
-- todavía no construida.
create table public.clan_war_reportes (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id),
  reportado_por uuid not null references public.teams (id),
  jugador_afectado_id uuid not null references public.profiles (id),
  motivo text not null check (motivo in ('cuenta_no_coincide', 'sospecha_smurf', 'no_se_presento')),
  created_at timestamptz not null default now()
);

alter table public.clan_war_reportes enable row level security;

-- Mismo criterio que clan_wars: solo los capitanes de los dos equipos
-- del reto en cuestión ven sus reportes.
create policy "clan_war_reportes_select_propio"
  on public.clan_war_reportes for select
  to authenticated
  using (
    exists (
      select 1
      from public.clan_wars cw
      join public.teams t on t.id in (cw.challenger_team_id, cw.challenged_team_id)
      where cw.id = clan_war_id and t.owner_id = auth.uid()
    )
  );

grant select on public.clan_war_reportes to authenticated;

-- Sin política de insert para authenticated a propósito -- la única
-- forma de escribir acá es reportar_problema(), security definer,
-- mismo patrón que el resto de las mutaciones sensibles del proyecto.

-- Helper interno: se llama desde confirmar_alineacion() y
-- completar_datos_transmision() después de cada cambio, porque
-- cualquiera de las dos puede ser la pieza que faltaba para arrancar
-- la guerra. No tiene grant execute para authenticated -- no hace
-- falta, nunca se llama directo desde el cliente, mismo patrón que
-- avanzar_ganador() con generar_llave()/reportar_resultado().
create or replace function public.intentar_iniciar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;

  if v_reto.status = 'aceptada'
     and v_reto.challenger_confirmado
     and v_reto.challenged_confirmado
     and v_reto.tiene_delay is not null
  then
    update public.clan_wars set status = 'en_curso' where id = p_clan_war_id;
  end if;
end;
$$;

-- confirmar_alineacion(): el capitán verificó por su cuenta, fuera de
-- la plataforma (en el lobby de SC2), que las cuentas del roster
-- rival coinciden con lo declarado -- esto no valida nada contra
-- Battle.net, es una confirmación manual de que ya lo revisó.
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

  select exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid())
    into v_soy_challenger;
  select exists (select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid())
    into v_soy_challenged;

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres capitán de ninguno de los dos equipos de este reto.';
  end if;

  -- La ventana se abre 15 minutos antes de fecha_hora_cet -- se
  -- recalcula acá mismo con el instante actual, no depende de ningún
  -- booleano guardado (ver la explicación larga al principio del
  -- archivo).
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

grant execute on function public.confirmar_alineacion(uuid) to authenticated;

-- reportar_problema(): siempre sobre un jugador del roster RIVAL,
-- nunca del propio equipo.
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
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif exists (select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid()) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'No eres capitán de ninguno de los dos equipos de este reto.';
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
end;
$$;

grant execute on function public.reportar_problema(uuid, uuid, text) to authenticated;

-- completar_datos_transmision(): solo el organizador (quien propuso
-- el reto, challenger_team_id). caster_nombre y caster_link son
-- opcionales -- si llegan vacíos se guardan como null. tiene_delay es
-- obligatorio (true o false, nunca queda sin definir).
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

  if not exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()) then
    raise exception 'Solo el organizador (quien propuso el reto) puede completar los datos de transmisión.';
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

grant execute on function public.completar_datos_transmision(uuid, text, text, boolean) to authenticated;
