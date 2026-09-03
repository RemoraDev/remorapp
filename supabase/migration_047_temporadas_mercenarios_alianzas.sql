-- ============================================================
-- Migración 047: temporadas, mercenarios y alianzas entre equipos.
--
-- Decisiones consultadas y confirmadas con el organizador antes de
-- escribir esta migración (clan_wars no tenía ningún vínculo con
-- torneos ni temporadas hasta ahora):
--
-- 1) clan_wars.temporada_id es OPCIONAL. Al proponer un reto se puede
--    indicar una temporada; si no se indica (como todos los retos de
--    hasta hoy), ninguna de las reglas nuevas de esta migración
--    aplica y todo se comporta exactamente igual que antes.
-- 2) rangos_mmr_por_posicion vive en temporadas, NO en tournaments --
--    tournaments no tiene ninguna relación con clan_wars/
--    armar_lineup_cw(), así que ahí hubiera quedado desconectado de
--    la validación que se pide. "El organizador" es quien administra
--    el torneo/liga dueño de esa temporada (temporadas.torneo_id).
--
-- Contenido:
-- 1) temporadas: contenedor mínimo (sin historial todavía).
-- 2) clan_wars.temporada_id.
-- 3) team_mercenarios + fichar_mercenario().
-- 4) team_alianzas + proponer_alianza() + confirmar_alianza_equipo() +
--    aprobar_alianza(). team_alianzas.aprobado_por_equipo_b (agregada
--    a pedido, además de las columnas originales): el dueño del
--    equipo A propone (queda 'pendiente'), el dueño del equipo B
--    confirma con confirmar_alianza_equipo(), y recién con esa
--    confirmación un administrador puede aprobar o rechazar con
--    aprobar_alianza() -- sin ella, aprobar_alianza() rechaza
--    explícitamente el intento, sea quien sea que la llame.
-- 5) roster_elegible_cw(): a quién puede poner un capitán en el
--    lineup -- miembros propios, el mercenario propio (si hay,
--    fichado para la temporada de ese reto) y, si hay una alianza
--    aprobada para esa temporada, los miembros y el mercenario del
--    equipo aliado también.
-- 6) proponer_clan_war(): +p_temporada_id.
-- 7) armar_lineup_cw(): la elegibilidad de p_jugador_id ahora pasa
--    por roster_elegible_cw() en vez de exigir team_members
--    directamente; además, en formato WTL con una temporada que tiene
--    rangos_mmr_por_posicion configurado, valida que el jugador
--    cumpla el rango de mmr_equipos de la posición que se le asigna.
-- 8) designar_ace_wtl(): un mercenario no puede ser designado ACE.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Temporadas: solo lo necesario para que "fichado para toda la
--    temporada" tenga un límite de tiempo real. Sin historial de
--    temporadas pasadas todavía -- eso es una fase aparte.
-- ------------------------------------------------------------
create table public.temporadas (
  id uuid primary key default gen_random_uuid(),
  torneo_id uuid not null references public.tournaments (id) on delete cascade,
  nombre text not null check (char_length(nombre) between 3 and 60),
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz not null,
  inscripciones_abiertas boolean not null default true,
  -- Migración 047, punto 4: array de {posicion, mmr_min, mmr_max}, uno
  -- por cada posición del set. Null = sin restricción (comportamiento
  -- de siempre). Las posiciones válidas son 1/2/3 -- WTL, el único
  -- formato de Clan War con el concepto de "posición del set" hasta
  -- hoy, siempre usa exactamente esas tres.
  rangos_mmr_por_posicion jsonb,
  created_at timestamptz not null default now(),
  check (fecha_fin > fecha_inicio)
);

alter table public.temporadas enable row level security;

-- Público, igual que tournaments -- una temporada es información
-- pública del torneo/liga que la usa.
create policy "temporadas_select_publico"
  on public.temporadas for select
  using (true);

create policy "temporadas_insert_organizador"
  on public.temporadas for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = torneo_id and (t.creador_id = auth.uid() or public.is_admin())
    )
  );

create policy "temporadas_update_organizador"
  on public.temporadas for update
  to authenticated
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = torneo_id and (t.creador_id = auth.uid() or public.is_admin())
    )
  );

grant select on public.temporadas to anon, authenticated;
grant insert, update on public.temporadas to authenticated;

-- ------------------------------------------------------------
-- 2) clan_wars.temporada_id: opcional, ver la nota al principio del
--    archivo.
-- ------------------------------------------------------------
alter table public.clan_wars add column if not exists temporada_id uuid references public.temporadas (id);

-- ------------------------------------------------------------
-- 3) Mercenarios: fichados para una temporada completa, no para una
--    Clan War puntual.
-- ------------------------------------------------------------
create table public.team_mercenarios (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  jugador_id uuid not null references public.profiles (id),
  temporada_id uuid not null references public.temporadas (id) on delete cascade,
  fichado_en timestamptz not null default now(),
  -- Un jugador no puede ser mercenario de más de un equipo en la
  -- misma temporada.
  unique (jugador_id, temporada_id),
  -- Un equipo no puede tener más de 1 mercenario por temporada.
  unique (team_id, temporada_id)
);

alter table public.team_mercenarios enable row level security;

-- Público a propósito: el roster de mercenarios se muestra en el
-- perfil del equipo (punto 5 del pedido), igual que team_members.
create policy "team_mercenarios_select_publico"
  on public.team_mercenarios for select
  using (true);

-- Sin política de insert/update para authenticated -- la única forma
-- de escribir acá es fichar_mercenario(), security definer.
grant select on public.team_mercenarios to anon, authenticated;

create or replace function public.fichar_mercenario(p_team_id uuid, p_jugador_id uuid, p_temporada_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temporada record;
begin
  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán puede fichar un mercenario.';
  end if;

  select * into v_temporada from public.temporadas where id = p_temporada_id for update;
  if v_temporada is null then
    raise exception 'Esa temporada no existe.';
  end if;
  if not v_temporada.inscripciones_abiertas then
    raise exception 'Las inscripciones de esta temporada ya están cerradas.';
  end if;

  if exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_jugador_id) then
    raise exception 'Ese jugador ya es miembro del equipo -- no hace falta ficharlo como mercenario.';
  end if;

  insert into public.team_mercenarios (team_id, jugador_id, temporada_id)
  values (p_team_id, p_jugador_id, p_temporada_id);
exception
  when unique_violation then
    raise exception 'Ese jugador ya es mercenario de otro equipo esta temporada, o tu equipo ya tiene un mercenario fichado esta temporada.';
end;
$$;

grant execute on function public.fichar_mercenario(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Alianzas: comparten jugadores elegibles para el lineup, cada
--    equipo mantiene su identidad propia (nombre, logo, perfil).
-- ------------------------------------------------------------
create table public.team_alianzas (
  id uuid primary key default gen_random_uuid(),
  team_a_id uuid not null references public.teams (id) on delete cascade,
  team_b_id uuid not null references public.teams (id) on delete cascade,
  temporada_id uuid not null references public.temporadas (id) on delete cascade,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  aprobado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- El dueño del equipo B tiene que confirmar (confirmar_alianza_equipo())
  -- antes de que un administrador pueda aprobarla -- ver el chequeo
  -- explícito en aprobar_alianza() más abajo.
  aprobado_por_equipo_b boolean not null default false,
  check (team_a_id <> team_b_id)
);

alter table public.team_alianzas enable row level security;

-- Una alianza 'aprobada' es pública (se muestra en el perfil del
-- equipo, punto 5); 'pendiente'/'rechazada' solo las ven los
-- involucrados y un administrador -- mismo criterio de privacidad que
-- el resto de las propuestas del proyecto antes de resolverse.
create policy "team_alianzas_select"
  on public.team_alianzas for select
  using (
    status = 'aprobada'
    or (
      auth.uid() is not null
      and (
        public.es_capitan_o_dueno(team_a_id) or public.es_capitan_o_dueno(team_b_id) or public.is_admin()
      )
    )
  );

-- Sin política de insert/update para authenticated -- la única forma
-- de escribir acá es proponer_alianza() y aprobar_alianza(), security
-- definer.
grant select on public.team_alianzas to anon, authenticated;

create or replace function public.proponer_alianza(p_team_id uuid, p_team_rival_id uuid, p_temporada_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team is null then
    raise exception 'Ese equipo no existe.';
  end if;
  -- A propósito exclusivo del dueño, no "dueño o capitán" -- una
  -- alianza es una decisión de fondo del equipo, distinta de operar
  -- una Clan War puntual.
  if v_team.owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo puede proponer una alianza.';
  end if;

  if p_team_rival_id = p_team_id then
    raise exception 'Un equipo no puede aliarse consigo mismo.';
  end if;
  if not exists (select 1 from public.teams where id = p_team_rival_id) then
    raise exception 'Ese equipo rival no existe.';
  end if;
  if not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'Esa temporada no existe.';
  end if;

  -- Máximo 2 equipos por alianza y un equipo no puede estar en más de
  -- una alianza activa a la vez en la misma temporada.
  if exists (
    select 1 from public.team_alianzas
    where temporada_id = p_temporada_id
      and status = 'aprobada'
      and (p_team_id in (team_a_id, team_b_id) or p_team_rival_id in (team_a_id, team_b_id))
  ) then
    raise exception 'Uno de los dos equipos ya tiene una alianza activa en esta temporada.';
  end if;

  insert into public.team_alianzas (team_a_id, team_b_id, temporada_id)
  values (p_team_id, p_team_rival_id, p_temporada_id);
end;
$$;

grant execute on function public.proponer_alianza(uuid, uuid, uuid) to authenticated;

create or replace function public.confirmar_alianza_equipo(p_alianza_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alianza record;
  v_team_b record;
begin
  select * into v_alianza from public.team_alianzas where id = p_alianza_id for update;
  if v_alianza is null then
    raise exception 'Esa alianza no existe.';
  end if;
  if v_alianza.status <> 'pendiente' then
    raise exception 'Esta alianza ya fue resuelta.';
  end if;
  if v_alianza.aprobado_por_equipo_b then
    raise exception 'Esta alianza ya fue confirmada por tu equipo.';
  end if;

  select * into v_team_b from public.teams where id = v_alianza.team_b_id;
  -- A propósito exclusivo del dueño del equipo B, mismo criterio que
  -- proponer_alianza() con el equipo A -- no "dueño o capitán".
  if v_team_b.owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo invitado puede confirmar esta alianza.';
  end if;

  update public.team_alianzas set aprobado_por_equipo_b = true where id = p_alianza_id;
end;
$$;

grant execute on function public.confirmar_alianza_equipo(uuid) to authenticated;

create or replace function public.aprobar_alianza(p_alianza_id uuid, p_aprobar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alianza record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede aprobar o rechazar una alianza.';
  end if;

  select * into v_alianza from public.team_alianzas where id = p_alianza_id for update;
  if v_alianza is null then
    raise exception 'Esa alianza no existe.';
  end if;
  if v_alianza.status <> 'pendiente' then
    raise exception 'Esta alianza ya fue resuelta.';
  end if;

  if p_aprobar then
    if not v_alianza.aprobado_por_equipo_b then
      raise exception 'Todavía no se puede aprobar: falta que el equipo invitado confirme la alianza.';
    end if;

    -- Revalidado acá también (y no solo en proponer_alianza()) por si
    -- alguno de los dos equipos consiguió otra alianza aprobada
    -- mientras esta seguía pendiente.
    if exists (
      select 1 from public.team_alianzas
      where id <> p_alianza_id
        and temporada_id = v_alianza.temporada_id
        and status = 'aprobada'
        and (
          v_alianza.team_a_id in (team_a_id, team_b_id) or v_alianza.team_b_id in (team_a_id, team_b_id)
        )
    ) then
      raise exception 'Uno de los dos equipos ya tiene una alianza activa en esta temporada.';
    end if;

    update public.team_alianzas set status = 'aprobada', aprobado_por = auth.uid() where id = p_alianza_id;
  else
    update public.team_alianzas set status = 'rechazada', aprobado_por = auth.uid() where id = p_alianza_id;
  end if;
end;
$$;

grant execute on function public.aprobar_alianza(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 5) roster_elegible_cw(): a quién puede poner un capitán en el
--    lineup de una Clan War de esta temporada -- miembros propios,
--    mercenario propio, y si hay alianza aprobada, miembros y
--    mercenario del equipo aliado. Con p_temporada_id null (la
--    inmensa mayoría de las Clan Wars, sin cambios) devuelve
--    exactamente lo mismo que team_members: el comportamiento de
--    siempre.
-- ------------------------------------------------------------
create or replace function public.roster_elegible_cw(p_team_id uuid, p_temporada_id uuid)
returns table (jugador_id uuid, es_mercenario boolean, es_aliado boolean)
language sql
security definer
set search_path = public
stable
as $$
  with equipo_aliado as (
    select case when team_a_id = p_team_id then team_b_id else team_a_id end as aliado_id
    from public.team_alianzas
    where p_temporada_id is not null
      and temporada_id = p_temporada_id
      and status = 'aprobada'
      and (team_a_id = p_team_id or team_b_id = p_team_id)
    limit 1
  )
  select user_id as jugador_id, false as es_mercenario, false as es_aliado
  from public.team_members
  where team_id = p_team_id

  union

  select tmerc.jugador_id, true, false
  from public.team_mercenarios tmerc
  where tmerc.team_id = p_team_id and p_temporada_id is not null and tmerc.temporada_id = p_temporada_id

  union

  select tm.user_id, false, true
  from public.team_members tm
  join equipo_aliado a on tm.team_id = a.aliado_id

  union

  select tmerc.jugador_id, true, true
  from public.team_mercenarios tmerc
  join equipo_aliado a on tmerc.team_id = a.aliado_id
  where p_temporada_id is not null and tmerc.temporada_id = p_temporada_id;
$$;

grant execute on function public.roster_elegible_cw(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 6) proponer_clan_war(): +p_temporada_id, opcional.
-- ------------------------------------------------------------
drop function if exists public.proponer_clan_war(uuid, timestamptz, text);

create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null
)
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
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;

  if p_temporada_id is not null and not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'Esa temporada no existe.';
  end if;

  -- Migración 038: ya no solo el dueño -- cualquier miembro que sea
  -- dueño o capitán de su equipo. team_members.user_id es primary key,
  -- así que solo puede pertenecer a un equipo a la vez.
  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
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

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id);
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 7) armar_lineup_cw(): elegibilidad vía roster_elegible_cw() +
--    rango de MMR por posición.
-- ------------------------------------------------------------
create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null
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

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
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

    -- Migración 047: antes exigía team_members directo -- ahora pasa
    -- por roster_elegible_cw(), que además de los miembros propios
    -- incluye al mercenario propio y, con alianza aprobada para la
    -- temporada de este reto, al roster del equipo aliado. Con
    -- v_reto.temporada_id null (la mayoría de los retos) el resultado
    -- es idéntico a team_members -- mismo comportamiento de siempre.
    if p_jugador_id is not null and not exists (
      select 1 from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) where jugador_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de tu equipo, ni tu mercenario, ni miembro de un equipo aliado para esta temporada.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de tu equipo.';
    end if;

    -- Migración 047, punto 4: rangos de MMR por posición, solo en
    -- formato WTL (el único con el concepto de "posición" hoy) y solo
    -- si la temporada de este reto los tiene configurados.
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
      raise exception 'Esa fila del lineup no existe o no es de tu equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  -- Cualquier cambio en el lineup resetea el visto bueno (y quién lo
  -- dio) del lado que lo cambió -- hay que volver a confirmarlo.
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

-- ------------------------------------------------------------
-- 8) designar_ace_wtl(): un mercenario no puede ser ACE.
-- ------------------------------------------------------------
create or replace function public.designar_ace_wtl(p_clan_war_id uuid, p_jugador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_mi_team_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;
  if v_reto.formato <> 'wtl' then
    raise exception 'Esta guerra no usa el formato WTL.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_soy_challenger := true;
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_soy_challenger := false;
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if exists (
    select 1 from public.clan_war_wtl_sets where clan_war_id = p_clan_war_id and status <> 'jugado'
  ) then
    raise exception 'Todavía faltan sets por jugarse.';
  end if;

  if v_reto.resultado_mapas_challenger <> v_reto.resultado_mapas_challenged then
    raise exception 'El marcador global no está empatado -- no hace falta designar un ACE.';
  end if;

  if not exists (
    select 1 from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and jugador_id = p_jugador_id
  ) then
    raise exception 'Ese jugador no es parte de tu lineup en esta guerra.';
  end if;

  -- Migración 047: un mercenario no puede ser designado ACE.
  if v_reto.temporada_id is not null and exists (
    select 1 from public.team_mercenarios
    where team_id = v_mi_team_id and jugador_id = p_jugador_id and temporada_id = v_reto.temporada_id
  ) then
    raise exception 'Un mercenario no puede ser designado como ACE.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set ace_challenger_id = p_jugador_id where id = p_clan_war_id;
  else
    update public.clan_wars set ace_challenged_id = p_jugador_id where id = p_clan_war_id;
  end if;
end;
$$;
