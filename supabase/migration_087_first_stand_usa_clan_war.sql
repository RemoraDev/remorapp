-- ------------------------------------------------------------
-- Migración 087: First Stand pasa a jugarse como Clan War real.
--
-- Hasta ahora convivían dos generadores de fixture "todos contra
-- todos" con el mismo algoritmo de círculo (Berger): First Stand
-- (generar_fixture_first_stand(), migración 057/080) y la liga
-- "Todos contra todos" (generar_todos_contra_todos(), migración
-- 077/078/083). Solo el segundo, desde la migración 083, conectaba
-- cada partido a una Clan War real (lineup, suplentes, visto bueno de
-- los dos capitanes, ventana de check-in y reporte partida por
-- partida o WTL mapa por mapa) -- First Stand seguía resolviéndose
-- con el botón de un solo clic "Ganó X 2-0/2-1" de antes, sin pasar
-- por ninguno de esos pasos, a pesar de estar categorizado en una
-- liga por equipos igual que el otro formato.
--
-- Esta migración unifica los dos en generar_todos_contra_todos():
-- ahora también acepta torneos First Stand (modo = 'eliminacion_simple'
-- y formato_liga = 'first_stand'), arma el fixture con el mismo
-- método del círculo de siempre (7 equipos -> 7 jornadas sin repetir
-- rival, igual que antes) y crea una Clan War real por partido. Se
-- elimina generar_fixture_first_stand() -- ya no queda nada que la
-- necesite, y mantenerla habría dejado dos funciones haciendo lo
-- mismo.
--
-- formato_clan_war (columna nueva en tournaments): antes el formato
-- de las Clan Wars generadas por el fixture quedaba fijo en 'simple'.
-- Ahora el organizador puede elegir 'wtl' al crear el torneo. 'wtl'
-- exige lineup de exactamente 3 jugadores por posición (columna
-- clan_war_lineup.posicion, migración 042, check in (1,2,3)) -- por
-- eso el check de abajo solo permite 'wtl' en torneos 3v3; en
-- cualquier otro formato de equipo queda fijo en 'simple'.
-- ------------------------------------------------------------

alter table public.tournaments
  add column formato_clan_war text not null default 'simple'
  check (formato_clan_war in ('simple', 'wtl'));

alter table public.tournaments
  add constraint tournaments_wtl_solo_3v3
  check (formato_clan_war = 'simple' or formato = '3v3');

drop function if exists public.generar_fixture_first_stand(uuid);

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
  v_es_first_stand boolean;
  v_temporada_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_clan_war_id uuid;
  v_avanzan int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede iniciar el torneo.';
  end if;

  v_es_first_stand := v_torneo.modo = 'eliminacion_simple' and v_torneo.formato_liga = 'first_stand';

  if v_torneo.modo <> 'todos_contra_todos' and not v_es_first_stand then
    raise exception 'Este torneo no es de formato Todos contra todos ni First Stand.';
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
    raise exception 'Necesitas al menos 3 equipos/jugadores confirmados para este formato.';
  end if;

  -- Cuántos avanzan a playoffs: solo aplica a First Stand -- Todos
  -- contra todos de liga no tiene fase de playoffs, el resultado
  -- final vive solo en la tabla de posiciones.
  if v_es_first_stand then
    v_avanzan := coalesce(v_torneo.avanzan_por_grupo, 4);
    if v_avanzan < 2 or v_avanzan > v_n then
      raise exception 'La cantidad de equipos que avanzan a playoffs no puede superar la cantidad de confirmados.';
    end if;
  end if;

  -- Clan War real por partido: cualquier torneo por equipos (2v2/3v3/
  -- 4v4) que sea de liga (liga_id) o First Stand. 1v1 y los torneos
  -- amistosos/privados sin liga ni First Stand siguen sin Clan War.
  v_usa_clan_war := v_torneo.formato in ('2v2', '3v3', '4v4')
    and (v_torneo.liga_id is not null or v_es_first_stand);

  if v_usa_clan_war then
    select id into v_temporada_id from public.temporadas
      where torneo_id = p_tournament_id
      order by fecha_inicio desc
      limit 1;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (
    p_tournament_id,
    case when v_es_first_stand then 'Fase de todos contra todos' else 'Todos contra todos' end
  )
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  -- Método del círculo: con N impar se agrega un hueco null
  -- (descanso) para trabajar con un número par -- así, con 7 equipos,
  -- quedan 7 jornadas de 3 partidos reales cada una, sin que nadie
  -- repita rival (mismo resultado que el algoritmo de Berger que tenía
  -- generar_fixture_first_stand() antes de esta migración).
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
            'aceptada', v_torneo.formato_clan_war, v_temporada_id
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

  if v_es_first_stand then
    -- cantidad_grupos = 1 para que generar_llave() reutilice tal cual
    -- su rama existente de "cerrar grupos y armar la llave con los
    -- clasificados" -- avanzan_por_grupo queda en lo que el
    -- organizador haya elegido al crear el torneo, nunca se pisa acá.
    update public.tournaments
      set estado = 'en_curso', check_in_abierto = false, fase_actual = 'grupos',
          tiene_fase_grupos = true, cantidad_grupos = 1, avanzan_por_grupo = v_avanzan
      where id = p_tournament_id;
  else
    update public.tournaments
      set estado = 'en_curso', check_in_abierto = false
      where id = p_tournament_id;
  end if;
end;
$$;

grant execute on function public.generar_todos_contra_todos(uuid) to authenticated;
