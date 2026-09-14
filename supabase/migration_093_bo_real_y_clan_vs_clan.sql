-- ------------------------------------------------------------
-- Migración 093: dos ajustes sobre el sistema de lineup WTL.
--
-- 1) "Bo" real: hasta ahora mapas_por_set se trataba como una cantidad
--    FIJA de mapas a jugar siempre (si estaba en 3, exigía los 3
--    mapas aunque un lado ya hubiera ganado 2-0). Se corrige
--    reportar_mapa_wtl() para que cierre el set apenas alguien
--    alcanza la mayoría real de un "Bo" (mejor de N): Bo1 se cierra en
--    1 mapa, Bo3 se cierra apenas alguien llega a 2 victorias (2-0 o
--    2-1, sin jugar el tercer mapa si ya está decidido), Bo5 apenas
--    alguien llega a 3. Bo2 quesa igual que siempre (siempre se juegan
--    los 2 mapas, pudiendo terminar 1-1 empatado) porque con solo 2
--    mapas nunca hay una mayoría estricta antes de agotarlos.
-- 2) clan_wars.mapas_por_set (nueva columna, default 2): para un reto
--    directo (Clan War Amistosa incluida) sin torneo detrás, hasta
--    ahora el "Bo" quedaba fijo en 2 sin ninguna forma de
--    configurarlo -- torneo_de_clan_war() solo resolvía este valor
--    para una Clan War generada por un torneo. Mismo patrón que
--    jugadores_por_set (migración 091): esta columna es el fallback
--    cuando no hay torneo detrás, y sigue siendo editable por
--    proponer_clan_war().
-- ------------------------------------------------------------

alter table public.clan_wars
  add column mapas_por_set integer not null default 2 check (mapas_por_set > 0);

-- reportar_mapa_wtl(): mismo cuerpo de siempre, con el cierre del set
-- corregido a un "Bo" real (ver comentario de arriba) y leyendo
-- clan_wars.mapas_por_set como fallback cuando no hay torneo detrás.
create or replace function public.reportar_mapa_wtl(p_set_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_gano_challenger boolean;
  v_mapas_ganados_challenger int;
  v_mapas_ganados_challenged int;
  v_mapas_por_set int;
  v_mayoria int;
begin
  select * into v_set from public.clan_war_wtl_sets where id = p_set_id for update;
  if v_set is null then
    raise exception 'Ese set no existe.';
  end if;
  if v_set.status = 'jugado' then
    raise exception 'Este set ya tiene resultado.';
  end if;

  select * into v_reto from public.clan_wars where id = v_set.clan_war_id;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_set.jugador_challenger_id and p_ganador_id <> v_set.jugador_challenged_id then
    raise exception 'Ese jugador no juega este set.';
  end if;

  v_gano_challenger := (p_ganador_id = v_set.jugador_challenger_id);
  v_perdedor_id := case when v_gano_challenger then v_set.jugador_challenged_id else v_set.jugador_challenger_id end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;
  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  if v_gano_challenger then
    update public.clan_war_wtl_sets set mapas_ganados_challenger = mapas_ganados_challenger + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenger = resultado_mapas_challenger + 1 where id = v_set.clan_war_id;
  else
    update public.clan_war_wtl_sets set mapas_ganados_challenged = mapas_ganados_challenged + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenged = resultado_mapas_challenged + 1 where id = v_set.clan_war_id;
  end if;

  select mapas_ganados_challenger, mapas_ganados_challenged
    into v_mapas_ganados_challenger, v_mapas_ganados_challenged
    from public.clan_war_wtl_sets where id = p_set_id;

  v_mapas_por_set := coalesce(
    (select t.mapas_por_set from public.torneo_de_clan_war(v_set.clan_war_id) t),
    v_reto.mapas_por_set,
    2
  );

  -- Mayoría real de un "Bo N": la mitad entera más uno. Para Bo1 da 1
  -- (se cierra apenas hay un mapa jugado); para Bo3 da 2; para Bo5 da
  -- 3. Para Bo2 da 2 también, pero esa mayoría nunca se alcanza ANTES
  -- de agotar los 2 mapas (ganar 2 mapas exige jugar los 2) -- así que
  -- el cierre de un Bo2 siempre lo termina dando el chequeo de "mapas
  -- agotados" de abajo, permitiendo el empate 1-1 tal como ya
  -- funcionaba.
  v_mayoria := (v_mapas_por_set / 2) + 1;

  if greatest(v_mapas_ganados_challenger, v_mapas_ganados_challenged) >= v_mayoria
     or (v_mapas_ganados_challenger + v_mapas_ganados_challenged) >= v_mapas_por_set
  then
    update public.clan_war_wtl_sets set status = 'jugado' where id = p_set_id;
  end if;
end;
$$;

grant execute on function public.reportar_mapa_wtl(uuid, uuid) to authenticated;

-- proponer_clan_war(): mismo cuerpo de la migración 091, con el nuevo
-- parámetro p_mapas_por_set (default 2, igual que el default de
-- siempre).
drop function if exists public.proponer_clan_war(uuid, timestamptz, text, uuid, integer);

create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null,
  p_jugadores_por_set integer default 3,
  p_mapas_por_set integer default 2
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
  if p_mapas_por_set is null or p_mapas_por_set < 1 then
    raise exception 'El "Bo" de cada set tiene que ser al menos 1.';
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
    challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id,
    jugadores_por_set, mapas_por_set
  )
  values (
    v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id,
    p_jugadores_por_set, p_mapas_por_set
  );
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid, integer, integer) to authenticated;
