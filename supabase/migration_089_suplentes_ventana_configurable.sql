-- ------------------------------------------------------------
-- Migración 089: jugadores suplentes, reemplazo por desacuerdo, y
-- ventana de revelación configurable.
--
-- 1) tournaments.ventana_revelacion_minutos (default 30): el plazo de
--    edición/revelación del lineup de cada Clan War (antes fijo en 30
--    minutos, migración 066) ahora se calcula con este valor cuando la
--    Clan War salió del fixture de un torneo (generar_todos_contra_todos(),
--    migración 083/087). Una Clan War propuesta a mano entre dos
--    clanes, sin torneo detrás, sigue usando 30 minutos por default --
--    no hay ningún torneo del que sacar el valor.
-- 2) clan_war_lineup.es_suplente (default false): un suplente se
--    anota igual que un titular, sin ocupar una de las posiciones que
--    se van a jugar (posicion queda en null incluso en formato WTL).
-- 3) armar_lineup_cw() acepta un suplente adicional (p_es_suplente) --
--    sin límite de cantidad, sin pedir posición.
-- 4) reemplazar_jugador_lineup(): si el rival reportó un problema
--    sobre un jugador puntual (clan_war_reportes, migración 022), el
--    capitán/dueño del equipo de ESE jugador puede reemplazarlo por
--    uno de sus propios suplentes ya anotados, mientras la Clan War
--    siga 'aceptada' (antes de que se cierre el check-in). El jugador
--    reportado sale del lineup, el suplente pasa a ocupar su posición
--    y deja de estar marcado como suplente. Resetea el visto bueno
--    del propio equipo, igual que cualquier otro cambio de lineup.
-- ------------------------------------------------------------

alter table public.tournaments
  add column ventana_revelacion_minutos integer not null default 30
  check (ventana_revelacion_minutos > 0);

alter table public.clan_war_lineup
  add column es_suplente boolean not null default false;

-- plazo_edicion_lineup_cw(): mismo criterio de siempre (fecha_hora_cet
-- menos la ventana, o el plazo extendido si hay uno aprobado) -- la
-- única novedad es de dónde sale la cantidad de minutos.
create or replace function public.plazo_edicion_lineup_cw(p_clan_war_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    cw.lineup_plazo_extendido_hasta,
    cw.fecha_hora_cet - (
      coalesce(
        (
          select t.ventana_revelacion_minutos
          from public.tournament_group_matches gm
          join public.tournament_groups g on g.id = gm.group_id
          join public.tournaments t on t.id = g.tournament_id
          where gm.clan_war_id = cw.id
          limit 1
        ),
        30
      ) * interval '1 minute'
    )
  )
  from public.clan_wars cw
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.plazo_edicion_lineup_cw(uuid) to authenticated;

drop function if exists public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid);

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null,
  p_team_id_como_admin uuid default null,
  p_es_suplente boolean default false
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
  v_rangos jsonb;
  v_rango record;
  v_mmr_jugador int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede intervenir el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    v_soy_challenger := (p_team_id_como_admin = v_reto.challenger_team_id);
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text || ' accion=' || p_accion
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  -- Plazo de edición (migración 066, ahora configurable por torneo --
  -- migración 089): no aplica cuando actúa el dueño de la plataforma.
  if p_team_id_como_admin is null and now() >= public.plazo_edicion_lineup_cw(p_clan_war_id) then
    raise exception 'El plazo para editar el lineup ya venció. Pídele al staff una extensión, o solicítasela al equipo rival desde el panel de control.';
  end if;

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' and not p_es_suplente then
      if p_jugador_id is null or p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;
      if p_posicion is null or p_posicion not in (1, 2, 3) then
        raise exception 'En formato WTL hay que indicar la posición (1, 2 o 3) de cada jugador.';
      end if;
      if exists (
        select 1 from public.clan_war_lineup
        where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion = p_posicion
      ) then
        raise exception 'Ya asignaste esa posición a otro jugador.';
      end if;
    elsif v_reto.formato = 'wtl' and p_es_suplente then
      -- Suplente en WTL: jugador real (no temporal, mismo criterio que
      -- un titular), pero sin posición -- no ocupa ninguno de los 3
      -- sets que se van a jugar.
      if p_jugador_id is null or p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;
    else
      if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
        raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
      end if;
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) where jugador_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de ese equipo, ni su mercenario, ni miembro de un equipo aliado para esta temporada.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de ese equipo.';
    end if;

    -- El rango de MMR por posición solo tiene sentido para un titular
    -- WTL (que sí ocupa una posición) -- un suplente no juega ningún
    -- set todavía, así que no se le exige.
    if v_reto.formato = 'wtl' and not p_es_suplente and v_reto.temporada_id is not null and p_jugador_id is not null then
      select rangos_mmr_por_posicion into v_rangos from public.temporadas where id = v_reto.temporada_id;

      if v_rangos is not null then
        select (elem->>'mmr_min')::int as mmr_min, (elem->>'mmr_max')::int as mmr_max
          into v_rango
          from jsonb_array_elements(v_rangos) as elem
          where (elem->>'posicion')::int = p_posicion;

        if v_rango is not null then
          select mmr_equipos into v_mmr_jugador from public.profiles where id = p_jugador_id;

          if v_mmr_jugador < v_rango.mmr_min or v_mmr_jugador > v_rango.mmr_max then
            raise exception 'El jugador para la posición % debe tener entre % y % de MMR de equipos (tiene %).',
              p_posicion, v_rango.mmr_min, v_rango.mmr_max, v_mmr_jugador;
          end if;
        end if;
      end if;
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por, posicion, es_suplente
    )
    values (
      p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid(),
      case when v_reto.formato = 'wtl' and not p_es_suplente then p_posicion else null end,
      p_es_suplente
    );

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de ese equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- reemplazar_jugador_lineup(): reemplazo de un jugador reportado por
-- un suplente del mismo equipo, mientras la Clan War siga 'aceptada'
-- (antes de que se cierre el check-in -- en 'en_curso' ya no tiene
-- sentido cambiar quién juega). Solo el dueño o un capitán del equipo
-- DEL JUGADOR REPORTADO puede hacerlo, y solo si existe de verdad un
-- reporte (clan_war_reportes) contra ese jugador en esta Clan War --
-- no alcanza con "quiero cambiarlo", tiene que haber un desacuerdo
-- real presentado por el rival.
-- ------------------------------------------------------------
create or replace function public.reemplazar_jugador_lineup(
  p_lineup_id_titular uuid,
  p_lineup_id_suplente uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titular record;
  v_suplente record;
  v_reto record;
  v_soy_challenger boolean;
begin
  select * into v_titular from public.clan_war_lineup where id = p_lineup_id_titular for update;
  if v_titular is null then
    raise exception 'Ese jugador no está en el lineup.';
  end if;
  if v_titular.es_suplente then
    raise exception 'Esa fila ya es un suplente -- no hace falta reemplazarla.';
  end if;

  select * into v_suplente from public.clan_war_lineup where id = p_lineup_id_suplente for update;
  if v_suplente is null then
    raise exception 'Ese suplente no está en el lineup.';
  end if;
  if not v_suplente.es_suplente then
    raise exception 'Esa fila no está anotada como suplente.';
  end if;
  if v_suplente.clan_war_id <> v_titular.clan_war_id or v_suplente.team_id <> v_titular.team_id then
    raise exception 'El suplente tiene que ser del mismo equipo y de la misma Clan War que el jugador a reemplazar.';
  end if;

  select * into v_reto from public.clan_wars where id = v_titular.clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa Clan War no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_titular.team_id) then
    raise exception 'Solo el dueño o un capitán del equipo de ese jugador puede reemplazarlo.';
  end if;

  if v_reto.status <> 'aceptada' then
    raise exception 'Solo se puede reemplazar un jugador antes de que se cierre el check-in.';
  end if;

  if v_titular.jugador_id is null or not exists (
    select 1 from public.clan_war_reportes
    where clan_war_id = v_titular.clan_war_id and jugador_afectado_id = v_titular.jugador_id
  ) then
    raise exception 'Ese jugador no tiene ningún reporte de problema en esta Clan War.';
  end if;

  -- Se borra primero al titular reportado -- si el formato es WTL, su
  -- posición queda libre recién ahí, así el update de abajo no choca
  -- con clan_war_lineup_posicion_unica (clan_war_id, team_id, posicion).
  delete from public.clan_war_lineup where id = p_lineup_id_titular;

  update public.clan_war_lineup
    set posicion = v_titular.posicion,
        es_suplente = false
    where id = p_lineup_id_suplente;

  v_soy_challenger := (v_titular.team_id = v_reto.challenger_team_id);

  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = v_reto.id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = v_reto.id;
  end if;
end;
$$;

grant execute on function public.reemplazar_jugador_lineup(uuid, uuid) to authenticated;
