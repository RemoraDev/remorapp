-- ------------------------------------------------------------
-- Migración 083: en un torneo de LIGA (liga_id no nulo) por equipos
-- (2v2/3v3/4v4) en modo "Todos contra todos", cada partido de cada
-- ronda pasa a ser una Clan War real -- con lineup, ventana de
-- check-in de 15 minutos, aprobación de los dos capitanes y reporte
-- partida por partida (formato "simple", que admite cualquier
-- cantidad de jugadores y puede terminar empatado) -- en vez de
-- reportarse con un solo click "Ganó X" como hasta ahora. El resultado
-- final de la Clan War (ganador o empate) se refleja solo en la tabla
-- de posiciones de la liga.
--
-- 1v1 (no hay clanes) y los torneos que no son de liga (amistoso,
-- privado) NO se ven afectados: siguen reportándose con el click de
-- siempre, sin lineup ni Clan War.
-- ------------------------------------------------------------

alter table public.tournament_group_matches
  add column clan_war_id uuid references public.clan_wars (id);

-- generar_todos_contra_todos(): mismo método del círculo de siempre --
-- lo único nuevo es que, cuando corresponde, cada partido crea su
-- Clan War (ya 'aceptada', sin pasar por la propuesta manual -- mismo
-- criterio que generar_escenario_prueba_lineup()) y queda linkeada al
-- partido. La fecha de cada ronda sale de fecha_inicio del torneo + 7
-- días por ronda, así que "se juega todos los jueves" queda resuelto
-- solo por el día de la semana que se eligió al crear el torneo.
create or replace function public.generar_todos_contra_todos(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_participantes uuid[];
  v_n int;
  v_grupo_id uuid;
  v_arr uuid[];
  v_rondas int;
  v_r int;
  v_i int;
  v_j int;
  v_p1 uuid;
  v_p2 uuid;
  v_ultimo uuid;
  v_usa_clan_war boolean;
  v_temporada_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_clan_war_id uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede iniciar el torneo.';
  end if;
  if v_torneo.modo <> 'todos_contra_todos' then
    raise exception 'Este torneo no es de formato Todos contra todos.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para iniciar.';
  end if;

  select array_agg(id order by random())
  into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'Necesitas al menos 3 jugadores confirmados para un torneo de Todos contra todos.';
  end if;

  v_usa_clan_war := v_torneo.liga_id is not null and v_torneo.formato in ('2v2', '3v3', '4v4');

  if v_usa_clan_war then
    select id into v_temporada_id from public.temporadas
      where torneo_id = p_tournament_id
      order by fecha_inicio desc
      limit 1;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Todos contra todos')
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  v_arr := v_participantes;
  if v_n % 2 <> 0 then
    v_arr := array_append(v_arr, null);
    v_n := v_n + 1;
  end if;

  v_rondas := v_n - 1;

  for v_r in 1..v_rondas loop
    for v_i in 1..(v_n / 2) loop
      v_p1 := v_arr[v_i];
      v_p2 := v_arr[v_n + 1 - v_i];

      if v_p1 is not null and v_p2 is not null then
        v_clan_war_id := null;

        if v_usa_clan_war then
          select team_id into v_team1_id from public.tournament_participants where id = v_p1;
          select team_id into v_team2_id from public.tournament_participants where id = v_p2;

          insert into public.clan_wars (
            challenger_team_id, challenged_team_id, fecha_hora_cet,
            status, formato, temporada_id
          ) values (
            v_team1_id, v_team2_id, v_torneo.fecha_inicio + ((v_r - 1) * interval '7 days'),
            'aceptada', 'simple', v_temporada_id
          )
          returning id into v_clan_war_id;
        end if;

        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada, clan_war_id)
        values (v_grupo_id, v_p1, v_p2, v_r, v_clan_war_id);
      end if;
    end loop;

    v_ultimo := v_arr[v_n];
    for v_j in reverse v_n..3 loop
      v_arr[v_j] := v_arr[v_j - 1];
    end loop;
    v_arr[2] := v_ultimo;
  end loop;

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false
    where id = p_tournament_id;
end;
$$;

-- reportar_resultado_grupo(): un partido que ya tiene su Clan War
-- vinculada no se puede reportar con el click de siempre -- el
-- resultado sale de cerrar_clan_war(), más abajo.
create or replace function public.reportar_resultado_grupo(
  p_match_id uuid, p_ganador_id uuid, p_resultado_perdedor integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
begin
  select * into v_match from public.tournament_group_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.clan_war_id is not null then
    raise exception 'Este partido se juega como Clan War -- reportalo desde ahí, no con este botón.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;
  if p_resultado_perdedor is not null and p_resultado_perdedor not in (0, 1) then
    raise exception 'El resultado del equipo que perdió tiene que ser 0 o 1 (al mejor de 3).';
  end if;

  select t.* into v_torneo
  from public.tournaments t
  join public.tournament_groups g on g.tournament_id = t.id
  where g.id = v_match.group_id;

  v_es_organizador := (v_torneo.creador_id = auth.uid());

  if not v_es_organizador
     and not public.es_dueno_del_participante(v_match.participant1_id)
     and not public.es_dueno_del_participante(v_match.participant2_id)
  then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  update public.tournament_group_matches
    set ganador_id = p_ganador_id,
        status = 'jugado',
        resultado_participant1 = case
          when p_resultado_perdedor is null then null
          when p_ganador_id = v_match.participant1_id then 2
          else p_resultado_perdedor
        end,
        resultado_participant2 = case
          when p_resultado_perdedor is null then null
          when p_ganador_id = v_match.participant2_id then 2
          else p_resultado_perdedor
        end
    where id = p_match_id;
end;
$$;

-- cerrar_clan_war(): al cerrarse (empatada o con ganador), si esta
-- Clan War es la de un partido de liga, el resultado se refleja solo
-- en tournament_group_matches -- ningún click aparte hace falta.
create or replace function public.cerrar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
  v_ganadas_challenger int;
  v_ganadas_challenged int;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_team_ganador_id uuid;
  v_team_perdedor_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.formato = 'wtl' then
    if exists (
      select 1 from public.clan_war_wtl_sets where clan_war_id = p_clan_war_id and status <> 'jugado'
    ) then
      raise exception 'Todavía faltan sets de la Clan War por jugarse.';
    end if;
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged
       and v_reto.ace_ganador_id is null
    then
      raise exception 'El marcador global quedó empatado -- todavía falta jugar el mapa decisivo del ACE.';
    end if;
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    return;
  end if;

  if v_reto.formato = 'wtl' then
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged then
      if v_reto.ace_ganador_id = v_reto.ace_challenger_id then
        v_team_ganador_id := v_reto.challenger_team_id;
        v_team_perdedor_id := v_reto.challenged_team_id;
      else
        v_team_ganador_id := v_reto.challenged_team_id;
        v_team_perdedor_id := v_reto.challenger_team_id;
      end if;
    elsif v_reto.resultado_mapas_challenger > v_reto.resultado_mapas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  else
    select count(*) into v_ganadas_challenger
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

    select count(*) into v_ganadas_challenged
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

    if v_ganadas_challenger = v_ganadas_challenged then
      update public.clan_wars set status = 'empatada' where id = p_clan_war_id;

      -- Migración 083: el partido de liga vinculado (si lo hay) queda
      -- jugado y empatado -- posiciones_grupos() ya sabe sumarle el
      -- punto de empate a los dos participantes.
      update public.tournament_group_matches
        set status = 'jugado', ganador_id = null
        where clan_war_id = p_clan_war_id;

      return;
    end if;

    if v_ganadas_challenger > v_ganadas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;

  update public.titulos_padre_hijo
    set status = 'activo',
        ganador_id = v_team_ganador_id,
        fecha_inicio = now(),
        fecha_fin = now() + (duracion_dias || ' days')::interval
    where tipo = 'clan'
      and aceptado = true
      and status = 'pendiente'
      and (
        (retador_id = v_reto.challenger_team_id and retado_id = v_reto.challenged_team_id)
        or (retador_id = v_reto.challenged_team_id and retado_id = v_reto.challenger_team_id)
      );

  -- Migración 083: partido de liga vinculado (si lo hay) queda jugado,
  -- con el mismo ganador que la Clan War -- se resuelve por equipo, no
  -- por participant1/2 directo, porque no se sabe de antemano cuál de
  -- los dos quedó como "challenger" al generar el fixture.
  update public.tournament_group_matches
    set status = 'jugado',
        ganador_id = case
          when (select team_id from public.tournament_participants where id = tournament_group_matches.participant1_id) = v_team_ganador_id
            then participant1_id
          else participant2_id
        end
    where clan_war_id = p_clan_war_id;
end;
$$;

-- posiciones_grupos(): suma "empatados" -- necesario porque, a
-- diferencia de antes, un partido de Todos contra todos por liga
-- ahora sí puede terminar empatado (Clan War formato simple con la
-- misma cantidad de partidas ganadas de cada lado). Un empate suma 1
-- punto a cada participante (además de contar como "jugado"), una
-- victoria sigue sumando puntos_victoria_2_0/2_1 como siempre.
drop function if exists public.posiciones_grupos(uuid);

create or replace function public.posiciones_grupos(p_tournament_id uuid)
returns table (
  group_id uuid,
  group_nombre text,
  participant_id uuid,
  ganados bigint,
  empatados bigint,
  jugados bigint,
  puntos bigint,
  dif_mapas bigint,
  inscrito_en timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    g.id as group_id,
    g.nombre as group_nombre,
    gp.participant_id,
    coalesce(w.ganados, 0) as ganados,
    coalesce(e.empatados, 0) as empatados,
    coalesce(pl.jugados, 0) as jugados,
    coalesce(pts.puntos, 0) + coalesce(e.empatados, 0) as puntos,
    coalesce(dif.dif_mapas, 0) as dif_mapas,
    tp.inscrito_en
  from public.tournament_groups g
  join public.tournament_group_participants gp on gp.group_id = g.id
  join public.tournament_participants tp on tp.id = gp.participant_id
  left join (
    select group_id, ganador_id, count(*) as ganados
    from public.tournament_group_matches
    where status = 'jugado' and ganador_id is not null
    group by group_id, ganador_id
  ) w on w.group_id = g.id and w.ganador_id = gp.participant_id
  left join (
    select group_id, participant_id, count(*) as empatados
    from (
      select group_id, participant1_id as participant_id
      from public.tournament_group_matches where status = 'jugado' and ganador_id is null
      union all
      select group_id, participant2_id as participant_id
      from public.tournament_group_matches where status = 'jugado' and ganador_id is null
    ) empatados_por_participante
    group by group_id, participant_id
  ) e on e.group_id = g.id and e.participant_id = gp.participant_id
  left join (
    select group_id, participant_id, count(*) as jugados
    from (
      select group_id, participant1_id as participant_id
      from public.tournament_group_matches where status = 'jugado'
      union all
      select group_id, participant2_id as participant_id
      from public.tournament_group_matches where status = 'jugado'
    ) jugados_por_participante
    group by group_id, participant_id
  ) pl on pl.group_id = g.id and pl.participant_id = gp.participant_id
  left join (
    select gm.group_id, gm.ganador_id,
      sum(
        case
          when gm.resultado_participant1 = 0 or gm.resultado_participant2 = 0 then t2.puntos_victoria_2_0
          else t2.puntos_victoria_2_1
        end
      ) as puntos
    from public.tournament_group_matches gm
    join public.tournament_groups g2 on g2.id = gm.group_id
    join public.tournaments t2 on t2.id = g2.tournament_id
    where gm.status = 'jugado' and gm.ganador_id is not null
    group by gm.group_id, gm.ganador_id
  ) pts on pts.group_id = g.id and pts.ganador_id = gp.participant_id
  left join (
    select group_id, participant_id, sum(dif) as dif_mapas
    from (
      select group_id, participant1_id as participant_id,
        coalesce(resultado_participant1, 0) - coalesce(resultado_participant2, 0) as dif
      from public.tournament_group_matches where status = 'jugado'
      union all
      select group_id, participant2_id as participant_id,
        coalesce(resultado_participant2, 0) - coalesce(resultado_participant1, 0) as dif
      from public.tournament_group_matches where status = 'jugado'
    ) difs
    group by group_id, participant_id
  ) dif on dif.group_id = g.id and dif.participant_id = gp.participant_id
  where g.tournament_id = p_tournament_id
  order by
    g.nombre,
    (coalesce(pts.puntos, 0) + coalesce(e.empatados, 0)) desc,
    coalesce(dif.dif_mapas, 0) desc,
    tp.inscrito_en asc;
$$;

grant execute on function public.posiciones_grupos(uuid) to anon, authenticated;
