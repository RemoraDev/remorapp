-- ------------------------------------------------------------
-- Migración 091: "Clan War Amistosa" -- reto directo entre dos clanes
-- con invitación desde un buscador de equipos, expuesto como una
-- opción simplificada dentro del asistente de creación de torneos, en
-- vez de un torneo con llave. No es un mecanismo nuevo: reutiliza tal
-- cual proponer_clan_war()/responder_clan_war() (el "Retar a otro
-- clan" que ya existe en el Panel de control del equipo) -- lo único
-- nuevo es:
--
-- 1) clan_wars.jugadores_por_set (nueva columna, default 3): cuántos
--    titulares por lado espera esta Clan War puntual. Para una Clan
--    War vinculada a un torneo, sigue mandando el valor del torneo
--    (torneo_de_clan_war(), migración 090) -- este campo solo importa
--    para un reto directo sin torneo detrás, y a diferencia del
--    torneo, es editable en cualquier momento por cualquiera de los
--    dos capitanes mientras el reto no esté cerrado: al ser un reto
--    amistoso entre dos clanes que ya se pusieron de acuerdo, no hay
--    razón para trabarlo como si fuera una regla oficial de torneo.
-- 2) proponer_clan_war() admite ese nuevo parámetro.
-- 3) cambiar_jugadores_por_set_cw(): ajustarlo después de creado el
--    reto, típicamente desde la propia pantalla de lineup.
-- 4) retos_clan_war_pendientes_count(): cuántos retos de Clan War
--    tiene pendientes de responder el usuario logueado (dueño o
--    capitán del equipo retado) -- se sí a la cuenta que ya mostraba
--    el contador del header (antes solo invitaciones a equipo).
-- 5) logros_clan_war_de(): Clan Wars ya finalizadas de un equipo que
--    NO pertenecen a ningún torneo (ni fase de grupos ni bracket) --
--    esto es lo que se muestra en la pestaña pública "Logros" de la
--    ficha del equipo, como actividad propia del clan. Una Clan War
--    que sí viene de un torneo no aparece acá porque su resultado ya
--    queda reflejado en el propio torneo (y, si corresponde, en la
--    Sala de la Fama a través de él) -- mostrarla de nuevo acá sería
--    duplicar la misma información en dos lugares.
-- ------------------------------------------------------------

alter table public.clan_wars
  add column jugadores_por_set integer not null default 3 check (jugadores_por_set > 0);

-- armar_lineup_cw(): mismo cuerpo de la migración 090 -- el único
-- cambio es que, para un reto sin torneo detrás, el límite de
-- posición ahora sale de clan_wars.jugadores_por_set (editable) en vez
-- de quedar fijo en 3.
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
  v_jugadores_por_set int;
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

  if p_team_id_como_admin is null and now() >= public.plazo_edicion_lineup_cw(p_clan_war_id) then
    raise exception 'El plazo para editar el lineup ya venció. Pídele al staff una extensión, o solicítasela al equipo rival desde el panel de control.';
  end if;

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' and not p_es_suplente then
      if p_jugador_id is null or p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;

      v_jugadores_por_set := coalesce(
        (select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t),
        v_reto.jugadores_por_set,
        3
      );

      if p_posicion is null or p_posicion < 1 or p_posicion > v_jugadores_por_set then
        raise exception 'En formato WTL hay que indicar una posición entre 1 y % para esta Clan War.', v_jugadores_por_set;
      end if;
      if exists (
        select 1 from public.clan_war_lineup
        where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion = p_posicion
      ) then
        raise exception 'Ya asignaste esa posición a otro jugador.';
      end if;
    elsif v_reto.formato = 'wtl' and p_es_suplente then
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

-- confirmar_lineup_cw(): mismo cambio de coalesce que armar_lineup_cw().
create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid, p_team_id_como_admin uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_posiciones_completas boolean;
  v_jugadores_por_set int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede confirmar el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_confirmar_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  if v_reto.formato = 'wtl' then
    v_jugadores_por_set := coalesce(
      (select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t),
      v_reto.jugadores_por_set,
      3
    );

    select (count(distinct posicion) = v_jugadores_por_set) into v_posiciones_completas
    from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion is not null;

    if not v_posiciones_completas then
      raise exception 'En formato WTL el lineup necesita exactamente % jugadores titulares.', v_jugadores_por_set;
    end if;
  end if;

  if v_mi_team_id = v_reto.challenger_team_id then
    update public.clan_wars
      set lineup_visto_bueno_challenger = true, visto_bueno_dado_por_challenger = auth.uid()
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = true, visto_bueno_dado_por_challenged = auth.uid()
      where id = p_clan_war_id;
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

grant execute on function public.confirmar_lineup_cw(uuid, uuid) to authenticated;

-- proponer_clan_war(): mismo cuerpo de siempre, con el nuevo parámetro
-- p_jugadores_por_set (default 3, igual que el default de siempre).
drop function if exists public.proponer_clan_war(uuid, timestamptz, text, uuid);

create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null,
  p_jugadores_por_set integer default 3
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
  if p_jugadores_por_set is null or p_jugadores_por_set < 1 then
    raise exception 'La cantidad de jugadores por lado tiene que ser al menos 1.';
  end if;

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

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (
    challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id, jugadores_por_set
  )
  values (
    v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id, p_jugadores_por_set
  );
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- cambiar_jugadores_por_set_cw(): ajustar después de creado el reto,
-- solo para un reto SIN torneo detrás (si viene de un torneo, la
-- cantidad la define el torneo, no se toca acá). No se retocan las
-- filas de clan_war_lineup ya cargadas -- si se baja el número y
-- queda alguna posición de más, los propios capitanes la quitan a
-- mano con armar_lineup_cw(), igual que cualquier otro ajuste de
-- lineup.
-- ------------------------------------------------------------
create or replace function public.cambiar_jugadores_por_set_cw(p_clan_war_id uuid, p_jugadores_por_set integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_jugadores_por_set is null or p_jugadores_por_set < 1 then
    raise exception 'La cantidad de jugadores por lado tiene que ser al menos 1.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'Solo se puede ajustar la cantidad de jugadores después de aceptar el reto.';
  end if;

  if (select t.id from public.torneo_de_clan_war(p_clan_war_id) t) is not null then
    raise exception 'Esta Clan War pertenece a un torneo -- la cantidad de jugadores la define el torneo, no se puede cambiar acá.';
  end if;

  update public.clan_wars set jugadores_por_set = p_jugadores_por_set where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_jugadores_por_set_cw(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- retos_clan_war_pendientes_count(): retos de Clan War pendientes de
-- responder del usuario logueado (dueño o capitán del equipo
-- retado) -- se suma al contador de notificaciones del header, que
-- antes solo contaba invitaciones a equipo (team_invitations).
-- ------------------------------------------------------------
create or replace function public.retos_clan_war_pendientes_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
  from public.clan_wars cw
  where cw.status = 'pendiente'
    and exists (
      select 1 from public.teams t
      where t.id = cw.challenged_team_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = t.id and tm.user_id = auth.uid() and tm.es_capitan
          )
        )
    );
$$;

grant execute on function public.retos_clan_war_pendientes_count() to authenticated;

-- ------------------------------------------------------------
-- logros_clan_war_de(): Clan Wars finalizadas de un equipo que NO
-- pertenecen a ningún torneo (ni fase de grupos ni bracket) -- pública
-- (sin restricción de participante, a diferencia de la RLS de
-- clan_wars), pensada para la pestaña "Logros" de la ficha pública del
-- equipo. Una Clan War que sí viene de un torneo no aparece acá: su
-- resultado ya se refleja en el propio torneo.
-- ------------------------------------------------------------
create or replace function public.logros_clan_war_de(p_team_id uuid)
returns table (
  id uuid,
  rival_team_id uuid,
  rival_nombre text,
  rival_tag text,
  fecha_hora_cet timestamptz,
  gane boolean,
  empate boolean,
  formato text,
  jugadores_por_set integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    cw.id,
    rival.id,
    rival.name,
    rival.tag,
    cw.fecha_hora_cet,
    (cw.ganador_team_id = p_team_id) as gane,
    (cw.status = 'empatada') as empate,
    cw.formato,
    cw.jugadores_por_set
  from public.clan_wars cw
  join public.teams rival
    on rival.id = case when cw.challenger_team_id = p_team_id then cw.challenged_team_id else cw.challenger_team_id end
  where (cw.challenger_team_id = p_team_id or cw.challenged_team_id = p_team_id)
    and cw.status in ('finalizada', 'empatada')
    and not exists (select 1 from public.tournament_group_matches gm where gm.clan_war_id = cw.id)
    and not exists (select 1 from public.bracket_matches bm where bm.clan_war_id = cw.id)
  order by cw.fecha_hora_cet desc;
$$;

grant execute on function public.logros_clan_war_de(uuid) to anon, authenticated;
