-- ============================================================
-- Migración 037: Lineup de Clan War -- el paso que faltaba entre
-- aceptar el reto y el check-in ya existente.
--
-- Nota sobre el punto 4 del pedido: no encontré ningún botón
-- "Check-in" en el abanico (FanMenu.tsx) de ninguna sesión anterior --
-- hoy tiene Torneos inscritos, Mi equipo, Ayuda y Sugerencias. Lo
-- armo de cero en esta migración/estos cambios, no es una conexión a
-- algo que ya existía.
--
-- clan_wars.check_in_abierto ya existía en la tabla, pero el frontend
-- nunca lo leía (la ventana de check-in se calculaba solo comparando
-- fecha_hora_cet con la hora actual). A partir de ahora si se usa: se
-- prende en confirmar_lineup_cw() cuando los dos capitanes ya dieron
-- el visto bueno, y el frontend exige AMBAS condiciones (ventana de
-- tiempo Y check_in_abierto) antes de mostrar el check-in real.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

alter table public.clan_wars
  add column if not exists lineup_visto_bueno_challenger boolean not null default false;
alter table public.clan_wars
  add column if not exists lineup_visto_bueno_challenged boolean not null default false;

create table public.clan_war_lineup (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  -- Uno de los dos, nunca ambos -- mismo patrón que
  -- tournament_participants (jugador real o jugador temporal).
  jugador_id uuid references public.profiles (id),
  jugador_temporal_id uuid references public.team_temp_players (id),
  -- Evidencia opcional (ej. un link a sc2pulse.nephest.com) de que el
  -- jugador es quien dice ser.
  link_verificacion text,
  agregado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (
    (jugador_id is not null and jugador_temporal_id is null)
    or (jugador_id is null and jugador_temporal_id is not null)
  ),
  -- Un mismo jugador (real o temporal) no puede estar dos veces en el
  -- lineup de la misma guerra. Postgres no cuenta los NULL como
  -- duplicados, así que cada constraint solo aplica a las filas donde
  -- esa columna puntual no es null.
  unique (clan_war_id, jugador_id),
  unique (clan_war_id, jugador_temporal_id)
);

alter table public.clan_war_lineup enable row level security;

-- Mismo criterio que clan_war_reportes: solo los capitanes de los dos
-- equipos de esta guerra puntual ven el lineup (ni siquiera es
-- público -- a diferencia del roster general del equipo).
create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    exists (
      select 1
      from public.clan_wars cw
      join public.teams t on t.id in (cw.challenger_team_id, cw.challenged_team_id)
      where cw.id = clan_war_id and t.owner_id = auth.uid()
    )
  );

grant select on public.clan_war_lineup to authenticated;

-- Sin política de insert/update/delete para authenticated a
-- propósito -- la única forma de escribir acá es armar_lineup_cw(),
-- security definer.

-- Agrega o quita UNA fila del lineup del PROPIO equipo del capitán que
-- llama (nunca del rival). p_accion: 'agregar' o 'quitar'.
create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  select exists (
    select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()
  ) into v_soy_challenger;

  if v_soy_challenger then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif exists (
    select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid()
  ) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  if p_accion = 'agregar' then
    if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
      raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.team_members where team_id = v_mi_team_id and user_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de tu equipo.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de tu equipo.';
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por
    )
    values (p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid());

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de tu equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  -- Cambiar el propio lineup resetea SOLO el propio visto bueno -- el
  -- del rival no se toca. check_in_abierto también se apaga: si
  -- alguno de los dos vistos buenos deja de valer, la condición
  -- conjunta ya no se cumple.
  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false, check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false, check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid) to authenticated;

-- Da el visto bueno del PROPIO capitán al lineup completo (el suyo y
-- el del rival, tal como quedaron armados). Cuando los dos vistos
-- buenos ya están en true, recién ahí prende check_in_abierto.
create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  select exists (
    select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()
  ) into v_soy_challenger;

  if v_soy_challenger then
    update public.clan_wars set lineup_visto_bueno_challenger = true where id = p_clan_war_id;
  elsif exists (
    select 1 from public.teams where id = v_reto.challenged_team_id and owner_id = auth.uid()
  ) then
    update public.clan_wars set lineup_visto_bueno_challenged = true where id = p_clan_war_id;
  else
    raise exception 'Solo el capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

grant execute on function public.confirmar_lineup_cw(uuid) to authenticated;

-- confirmar_alineacion() (migración 022) ya exigía la ventana de
-- tiempo -- ahora también exige que el lineup ya esté aprobado por
-- los dos capitanes (check_in_abierto). Esto es lo que hace que el
-- check-in pase a ser el paso SIGUIENTE al lineup, no el primero --
-- y queda reforzado acá adentro, no solo escondido en el frontend.
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

  if not v_reto.lineup_visto_bueno_challenger or not v_reto.lineup_visto_bueno_challenged then
    raise exception 'Todavía falta que los dos capitanes den el visto bueno al lineup.';
  end if;

  -- La ventana se abre 15 minutos antes de fecha_hora_cet -- se
  -- recalcula acá mismo con el instante actual, no depende de ningún
  -- booleano guardado.
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
