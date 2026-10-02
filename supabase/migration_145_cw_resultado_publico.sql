-- Migración 145: botón "Ver celebración" (canvas-confetti) para el
-- ganador de un torneo o de una Clan War Amistosa ya terminada,
-- visible para cualquiera que vea el resultado final (no solo el
-- ganador). Para un torneo no hace falta nada en la base -- el
-- campeón ya es público (campeon_participant_id). Para una Clan War
-- Amistosa, en cambio, el resultado (ganador_team_id y el marcador de
-- mapas) hoy solo se veía en el panel privado del equipo
-- (TeamDetailPage.tsx, "Historial de retos") -- esta migración lo
-- suma también a lineup_publico_clan_war(), para que la ficha pública
-- (ClanWarLineupPublicoPage.tsx) pueda mostrar el resultado real y
-- habilitar el botón ahí.
--
-- lineup_publico_clan_war(): mismo cuerpo de la migración 133
-- (streamer_nombre), solo suma ganador_team_id y el marcador de mapas
-- -- quedan en null mientras la Clan War no esté resuelta, igual que
-- ya pasa con el resto de las columnas de resultado.
drop function if exists public.lineup_publico_clan_war(uuid);

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
    'challenger_team_id', cw.challenger_team_id,
    'challenged_team_id', cw.challenged_team_id,
    'caster_nombre', cw.caster_nombre,
    'caster_link', cw.caster_link,
    'challenger_stream_link', cw.challenger_stream_link,
    'challenger_stream_delay', cw.challenger_stream_delay,
    'challenger_streamer_nombre', cw.challenger_streamer_nombre,
    'challenged_stream_link', cw.challenged_stream_link,
    'challenged_stream_delay', cw.challenged_stream_delay,
    'challenged_streamer_nombre', cw.challenged_streamer_nombre,
    'fondo_clasico', cw.fondo_lineup,
    'fondo_imagen_url', (select f.image_url from public.catalogo_fondos_lineup f where f.id = cw.fondo_lineup_imagen_id),
    'estructura', cw.estructura_lineup,
    'aspecto', cw.aspecto_lineup,
    'ganador_team_id', cw.ganador_team_id,
    'resultado_mapas_challenger', cw.resultado_mapas_challenger,
    'resultado_mapas_challenged', cw.resultado_mapas_challenged,
    'lineup_challenger', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
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
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
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
