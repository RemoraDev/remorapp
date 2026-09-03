-- ============================================================
-- Migración 044: overlay público para OBS -- /overlay/cw/:id y
-- /overlay/torneo/:id.
--
-- El overlay de TORNEO no necesita ninguna función nueva: tournaments,
-- bracket_matches, tournament_participants, teams y las columnas
-- públicas de profiles ya tienen select público (using(true) + grant a
-- anon) desde hace varias migraciones -- el frontend arma esa página
-- consultando esas tablas directo, sin backend nuevo.
--
-- El overlay de CLAN WAR sí necesita algo nuevo: clan_wars,
-- clan_war_wtl_sets y clan_war_matches son privadas por diseño (solo
-- el dueño o un capitán de alguno de los dos equipos, ver
-- es_capitan_o_dueno() en migraciones anteriores) -- no se puede abrir
-- esa política sin exponer de paso motivo_rechazo, caster_link, y el
-- resto de una fila completa a cualquiera con el id.
--
-- overlay_clan_war(): una función pública (security definer, sin
-- chequeo de permiso adentro a propósito) que arma a mano un jsonb con
-- SOLO lo que hace falta para el marcador -- nombre/tag/logo de cada
-- equipo, formato, estado, el marcador global de mapas, los sets WTL
-- (posición, nombre de cada jugador, mapas ganados de cada uno,
-- estado) o la partida simple actual, y el ACE si corresponde. Nunca
-- devuelve motivo_rechazo, caster_nombre/link, link_verificacion,
-- agregado_por, ni ningún dato de perfil que no sea nick/unique_id.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create or replace function public.overlay_clan_war(p_clan_war_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'formato', cw.formato,
    'status', cw.status,
    'fecha_hora_cet', cw.fecha_hora_cet,
    'challenger', jsonb_build_object('nombre', tc.name, 'tag', tc.tag, 'logo_url', tc.logo_url),
    'challenged', jsonb_build_object('nombre', td.name, 'tag', td.tag, 'logo_url', td.logo_url),
    'resultado_mapas_challenger', cw.resultado_mapas_challenger,
    'resultado_mapas_challenged', cw.resultado_mapas_challenged,
    'wtl_sets', (
      case when cw.formato = 'wtl' then (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'posicion', s.posicion,
            'jugador_challenger', coalesce(pc.nick || '#' || pc.unique_id, 'Jugador de RemorApp'),
            'jugador_challenged', coalesce(pd.nick || '#' || pd.unique_id, 'Jugador de RemorApp'),
            'mapas_ganados_challenger', s.mapas_ganados_challenger,
            'mapas_ganados_challenged', s.mapas_ganados_challenged,
            'status', s.status
          )
          order by s.posicion
        ), '[]'::jsonb)
        from public.clan_war_wtl_sets s
        join public.profiles pc on pc.id = s.jugador_challenger_id
        join public.profiles pd on pd.id = s.jugador_challenged_id
        where s.clan_war_id = cw.id
      ) else null end
    ),
    'ace', (
      case when cw.formato = 'wtl' and (cw.ace_challenger_id is not null or cw.ace_challenged_id is not null) then
        jsonb_build_object(
          'challenger', (select coalesce(nick || '#' || unique_id, 'Jugador de RemorApp') from public.profiles where id = cw.ace_challenger_id),
          'challenged', (select coalesce(nick || '#' || unique_id, 'Jugador de RemorApp') from public.profiles where id = cw.ace_challenged_id),
          'ganador', case
            when cw.ace_ganador_id is null then null
            when cw.ace_ganador_id = cw.ace_challenger_id then 'challenger'
            else 'challenged'
          end
        )
      else null end
    ),
    'partida_actual_simple', (
      case when cw.formato = 'simple' then (
        select jsonb_build_object(
          'jugador_challenger', coalesce(pc2.nick || '#' || pc2.unique_id, 'Jugador de RemorApp'),
          'jugador_challenged', coalesce(pd2.nick || '#' || pd2.unique_id, 'Jugador de RemorApp'),
          'status', m.status
        )
        from public.clan_war_matches m
        join public.profiles pc2 on pc2.id = m.jugador_challenger_id
        join public.profiles pd2 on pd2.id = m.jugador_challenged_id
        where m.clan_war_id = cw.id and m.status = 'pendiente'
        order by m.created_at asc
        limit 1
      ) else null end
    ),
    'ganadas_challenger', (
      case when cw.formato = 'simple' then (
        select count(*) from public.clan_war_matches
        where clan_war_id = cw.id and status = 'jugado' and ganador_id = jugador_challenger_id
      ) else null end
    ),
    'ganadas_challenged', (
      case when cw.formato = 'simple' then (
        select count(*) from public.clan_war_matches
        where clan_war_id = cw.id and status = 'jugado' and ganador_id = jugador_challenged_id
      ) else null end
    )
  )
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.overlay_clan_war(uuid) to anon, authenticated;
