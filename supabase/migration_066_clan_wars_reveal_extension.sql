-- ------------------------------------------------------------
-- Migración 066: revelación del lineup de Clan War, plazo de edición
-- (30 minutos en vez de 15), solicitudes de extensión con aprobación
-- del rival, visibilidad total del dueño de la plataforma, vista
-- pública del lineup con casters para las tarjetas de Inicio, y el
-- registro "Movimientos entre equipos" para el dueño.
--
-- Hoy el lineup del rival ya es visible en tiempo real para el
-- capitán del otro equipo (sin ninguna restricción de tiempo ni de
-- visto bueno) -- no existía ningún mecanismo de "ocultar hasta
-- revelar". Esta migración lo introduce: el lineup de cada equipo
-- queda oculto para el rival hasta que se "revela", lo que ocurre
-- (lo que pase primero):
--   a) ambos equipos ya dieron su visto bueno, o
--   b) se venció el plazo de edición (30 minutos antes del inicio,
--      salvo que se haya aprobado una extensión).
-- El dueño de la plataforma ve siempre los dos lineups, sin esperar
-- ninguna de las dos condiciones -- es exclusivo de él, ni siquiera
-- otro admin común la tiene.
-- ------------------------------------------------------------

-- Plazo de edición extendido más allá del default (30 minutos antes),
-- aprobado por el rival (solicitar_extension_lineup_cw) o fijado
-- directamente por el dueño (admin_extender_plazo_lineup_cw). Null =
-- todavía no se extendió, rige el default de 30 minutos.
alter table public.clan_wars add column lineup_plazo_extendido_hasta timestamptz;

-- Plazo vigente para seguir editando el propio lineup -- 30 minutos
-- antes del inicio por default (antes eran 15, sin ningún plazo real
-- aplicado ni en el frontend ni en la base), o la extensión aprobada
-- si la hay.
create or replace function public.plazo_edicion_lineup_cw(p_clan_war_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lineup_plazo_extendido_hasta, fecha_hora_cet - interval '30 minutes')
  from public.clan_wars
  where id = p_clan_war_id;
$$;

grant execute on function public.plazo_edicion_lineup_cw(uuid) to authenticated;

-- Se revela al rival (y al público, ver lineup_publico_clan_war más
-- abajo) apenas se cumple cualquiera de las dos condiciones -- una vez
-- que ambos dieron el visto bueno ya no hay ventaja competitiva en
-- seguir ocultándolo, y el plazo vencido fuerza la revelación aunque
-- alguno de los dos nunca haya confirmado, para que no quede oculto
-- indefinidamente.
create or replace function public.revelado_lineup_cw(p_clan_war_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (cw.lineup_visto_bueno_challenger and cw.lineup_visto_bueno_challenged)
    or now() >= public.plazo_edicion_lineup_cw(cw.id)
  from public.clan_wars cw
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.revelado_lineup_cw(uuid) to anon, authenticated;

-- armar_lineup_cw(): mismo cuerpo de siempre, con el plazo de edición
-- ahora exigido de verdad (antes no existía ningún límite de tiempo,
-- ni en el frontend ni acá) -- salvo actuando como admin
-- (p_team_id_como_admin), que sigue sin límite, igual que hoy.
create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null,
  p_team_id_como_admin uuid default null
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

  -- Plazo de edición (migración 066): 30 minutos antes del inicio,
  -- salvo extensión aprobada -- no aplica cuando actúa el dueño.
  if p_team_id_como_admin is null and now() >= public.plazo_edicion_lineup_cw(p_clan_war_id) then
    raise exception 'El plazo para editar el lineup ya venció. Pídele al staff una extensión, o solicítasela al equipo rival desde el panel de control.';
  end if;

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' then
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

    if v_reto.formato = 'wtl' and v_reto.temporada_id is not null and p_jugador_id is not null then
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
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por, posicion
    )
    values (
      p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid(),
      case when v_reto.formato = 'wtl' then p_posicion else null end
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

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid) to authenticated;

-- ------------------------------------------------------------
-- clan_war_lineup: la política de select se reemplaza -- un capitán ya
-- no ve las filas del equipo rival por el solo hecho de ser capitán de
-- alguno de los dos, solo las ve una vez que revelado_lineup_cw()
-- devuelve verdadero. El dueño de la plataforma sigue viendo todo
-- siempre. Un admin común (is_admin() pero no es_dueno_plataforma())
-- ya no tiene bypass acá -- nunca lo necesitó: la pestaña de Clan Wars
-- del Panel de Administración solo consulta clan_war_lineup cuando
-- quien mira es, además, el dueño de la plataforma (ver
-- handleElegirEquipoActuarComo en AdminPage.tsx).
-- ------------------------------------------------------------
drop policy if exists "clan_war_lineup_select_propio" on public.clan_war_lineup;

create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    public.es_dueno_plataforma()
    or exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_lineup.clan_war_id
        and (
          team_id = case
            when public.es_capitan_o_dueno(cw.challenger_team_id) then cw.challenger_team_id
            when public.es_capitan_o_dueno(cw.challenged_team_id) then cw.challenged_team_id
          end
          or (
            (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
            and public.revelado_lineup_cw(cw.id)
          )
        )
    )
  );

-- ------------------------------------------------------------
-- Extensión del plazo de edición del lineup, aprobada por el rival --
-- mismo patrón exacto que clan_war_reschedules/solicitar_reprogramacion_cw
-- de la migración 045.
-- ------------------------------------------------------------
create table public.clan_war_lineup_extensiones (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id) on delete cascade,
  propuesto_por uuid not null references public.teams (id),
  minutos_solicitados integer not null check (minutos_solicitados > 0 and minutos_solicitados <= 240),
  motivo text,
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now()
);

alter table public.clan_war_lineup_extensiones enable row level security;

-- El dueño ve todas (para "Movimientos entre equipos" en /admin);
-- capitán o dueño de alguno de los dos equipos ve las de su propia
-- Clan War.
create policy "clan_war_lineup_extensiones_select"
  on public.clan_war_lineup_extensiones for select
  to authenticated
  using (
    public.es_dueno_plataforma()
    or exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

grant select on public.clan_war_lineup_extensiones to authenticated;

create or replace function public.solicitar_extension_lineup_cw(
  p_clan_war_id uuid,
  p_minutos_solicitados integer,
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
    raise exception 'Solo se puede pedir una extensión de lineup mientras el reto está aceptado, antes de empezar.';
  end if;

  if p_minutos_solicitados is null or p_minutos_solicitados <= 0 then
    raise exception 'Indica cuántos minutos querés pedir de más.';
  end if;

  if exists (
    select 1 from public.clan_war_lineup_extensiones
    where clan_war_id = p_clan_war_id and status = 'pendiente'
  ) then
    raise exception 'Ya hay una solicitud de extensión pendiente de respuesta.';
  end if;

  insert into public.clan_war_lineup_extensiones (clan_war_id, propuesto_por, minutos_solicitados, motivo)
  values (p_clan_war_id, v_mi_team_id, p_minutos_solicitados, nullif(trim(coalesce(p_motivo, '')), ''));
end;
$$;

grant execute on function public.solicitar_extension_lineup_cw(uuid, integer, text) to authenticated;

create or replace function public.responder_extension_lineup_cw(p_extension_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_reto record;
  v_mi_team_id uuid;
  v_nuevo_plazo timestamptz;
begin
  select * into v_solicitud from public.clan_war_lineup_extensiones where id = p_extension_id for update;
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
    raise exception 'No puedes responder tu propia solicitud de extensión -- le toca al otro equipo.';
  end if;

  if p_aceptar then
    -- Nunca más allá de la hora pactada de la Clan War: la extensión
    -- estira el plazo de edición, no corre el inicio del reto.
    v_nuevo_plazo := least(
      public.plazo_edicion_lineup_cw(v_reto.id) + (v_solicitud.minutos_solicitados || ' minutes')::interval,
      v_reto.fecha_hora_cet
    );
    update public.clan_wars set lineup_plazo_extendido_hasta = v_nuevo_plazo where id = v_reto.id;
    update public.clan_war_lineup_extensiones set status = 'aceptada' where id = p_extension_id;
  else
    update public.clan_war_lineup_extensiones set status = 'rechazada' where id = p_extension_id;
  end if;
end;
$$;

grant execute on function public.responder_extension_lineup_cw(uuid, boolean) to authenticated;

-- El dueño puede extender el plazo directamente, sin pasar por la
-- aprobación del rival -- queda igual registrado en
-- dueno_actividad_log, visible en "Movimientos entre equipos".
create or replace function public.admin_extender_plazo_lineup_cw(p_clan_war_id uuid, p_nueva_fecha_limite timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Solo el dueño de la plataforma puede extender el plazo de lineup directamente.';
  end if;

  update public.clan_wars set lineup_plazo_extendido_hasta = p_nueva_fecha_limite where id = p_clan_war_id;

  perform public.registrar_actividad_dueno(
    'extender_plazo_lineup_cw',
    'clan_war_id=' || p_clan_war_id::text || ' nueva_fecha_limite=' || p_nueva_fecha_limite::text
  );
end;
$$;

grant execute on function public.admin_extender_plazo_lineup_cw(uuid, timestamptz) to authenticated;

-- Reprogramar (migración 045): al aceptarse un cambio de fecha, el
-- plazo de edición extendido (si había uno) queda obsoleto -- se
-- reinicia a null para que vuelva a calcularse solo, 30 minutos antes
-- de la NUEVA fecha.
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
          reprogramaciones_usadas = reprogramaciones_usadas + 1,
          lineup_plazo_extendido_hasta = null
      where id = v_reto.id;
    update public.clan_war_reschedules set status = 'aceptada' where id = p_reschedule_id;
  else
    update public.clan_war_reschedules set status = 'rechazada' where id = p_reschedule_id;
  end if;
end;
$$;

grant execute on function public.responder_reprogramacion_cw(uuid, boolean) to authenticated;

-- "Movimientos entre equipos" (Panel de Administración, exclusivo del
-- dueño): las reprogramaciones ya tenían su propia política de select,
-- acotada a los capitanes de la Clan War en cuestión -- se le agrega
-- el bypass del dueño, para que las vea TODAS, de cualquier Clan War.
drop policy if exists "clan_war_reschedules_select_propio" on public.clan_war_reschedules;

create policy "clan_war_reschedules_select_propio"
  on public.clan_war_reschedules for select
  to authenticated
  using (
    public.es_dueno_plataforma()
    or exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

-- ------------------------------------------------------------
-- Vista pública del lineup + casters, para la tarjeta de "Clan Wars
-- próximas" en Inicio -- mismo espíritu que overlay_clan_war(): un
-- solo jsonb, security definer, sin exponer clan_war_lineup en crudo
-- a anon/authenticated. "revelado" en falso mientras no se cumpla
-- revelado_lineup_cw() -- el lineup y los casters quedan en null en
-- ese caso, para que el frontend muestre el aviso de espera sin datos
-- parciales.
-- ------------------------------------------------------------
create or replace function public.lineup_publico_clan_war(p_clan_war_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revelado', public.revelado_lineup_cw(cw.id),
    'formato', cw.formato,
    'status', cw.status,
    'fecha_hora_cet', cw.fecha_hora_cet,
    'challenger', jsonb_build_object('nombre', tc.name, 'tag', tc.tag, 'logo_url', tc.logo_url),
    'challenged', jsonb_build_object('nombre', td.name, 'tag', td.tag, 'logo_url', td.logo_url),
    'caster_nombre', cw.caster_nombre,
    'caster_link', cw.caster_link,
    'lineup_challenger', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenger_team_id
    ) else null end,
    'lineup_challenged', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenged_team_id
    ) else null end
  )
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.lineup_publico_clan_war(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- clan_wars_proximas(): se extiende con status y los datos que hacen
-- falta para que la tarjeta de Inicio sepa si es clickeable
-- (lineup_revelado) y para no mostrar el contador una vez que la
-- hora ya pasó. También se saca el límite "fecha_hora_cet >= now()"
-- para 'aceptada' -- antes, una Clan War que nunca hizo check-in
-- desaparecía de Inicio apenas pasaba su hora, sin haber llegado a un
-- resultado final; ahora se queda visible (con la insignia EN VIVO)
-- hasta que de verdad se cierra.
-- ------------------------------------------------------------
drop function if exists public.clan_wars_proximas();

create or replace function public.clan_wars_proximas()
returns table (
  id uuid,
  fecha_hora_cet timestamptz,
  formato text,
  status text,
  challenger_nombre text,
  challenger_tag text,
  challenger_logo_url text,
  challenged_nombre text,
  challenged_tag text,
  challenged_logo_url text,
  liga_nombre text,
  division_nombre text,
  lineup_visto_bueno_challenger boolean,
  lineup_visto_bueno_challenged boolean,
  lineup_revelado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cw.id,
    cw.fecha_hora_cet,
    cw.formato,
    cw.status,
    tc.name as challenger_nombre,
    tc.tag as challenger_tag,
    tc.logo_url as challenger_logo_url,
    td.name as challenged_nombre,
    td.tag as challenged_tag,
    td.logo_url as challenged_logo_url,
    l.nombre as liga_nombre,
    d.nombre as division_nombre,
    cw.lineup_visto_bueno_challenger,
    cw.lineup_visto_bueno_challenged,
    public.revelado_lineup_cw(cw.id) as lineup_revelado
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  left join public.temporadas tmp on tmp.id = cw.temporada_id
  left join public.tournaments t on t.id = tmp.torneo_id
  left join public.ligas l on l.id = t.liga_id
  left join public.divisiones_liga d on d.id = t.division_id
  where cw.status in ('en_curso', 'aceptada')
  order by cw.fecha_hora_cet asc;
$$;

grant execute on function public.clan_wars_proximas() to anon, authenticated;
