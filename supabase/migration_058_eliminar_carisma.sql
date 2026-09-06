-- ------------------------------------------------------------
-- Migración 058: eliminación completa del sistema de Carisma.
--
-- Se saca entero, no se deja oculto ni a medias: se eliminan las
-- tablas de registro, la columna en profiles y en teams, y toda
-- función/trigger que otorgaba puntos. Antes de eliminar
-- registrar_carisma() y registrar_carisma_equipo(), se corrigen las
-- dos funciones que las llamaban (proponer_clan_war() y
-- generar_llave()) para que dejen de hacerlo -- de lo contrario
-- quedarían rotas la próxima vez que alguien proponga una Clan War o
-- genere una llave.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- proponer_clan_war(): misma función, sin el otorgamiento de carisma
-- al caster ni al equipo retador. El resto del cuerpo queda idéntico.
-- ------------------------------------------------------------
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
-- generar_llave(): misma función, sin el otorgamiento de carisma de
-- equipo al cierre del torneo. El resto del cuerpo queda idéntico.
-- ------------------------------------------------------------
create or replace function public.generar_llave(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_participantes uuid[];
  v_n int;
  v_next_pow2 int;
  v_num_matches int;
  v_num_byes int;
  v_bye_matches int[];
  v_i int;
  v_es_bye boolean;
  v_p1 uuid;
  v_p2 uuid;
  v_partidos_pendientes int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar la llave.';
  end if;
  if v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora la llave solo está disponible para el modo de eliminación simple.';
  end if;

  if v_torneo.tiene_fase_grupos and v_torneo.fase_actual = 'grupos' then
    -- Cerrando la etapa de grupos: desde que se generaron los grupos
    -- el torneo ya está 'en_curso', no 'abierto' (ver generar_grupos()).
    if v_torneo.estado <> 'en_curso' then
      raise exception 'La etapa de grupos de este torneo no está en curso.';
    end if;

    select count(*) into v_partidos_pendientes
    from public.tournament_group_matches gm
    join public.tournament_groups g on g.id = gm.group_id
    where g.tournament_id = p_tournament_id and gm.status <> 'jugado';

    if v_partidos_pendientes > 0 then
      raise exception 'Todavía faltan % partido(s) de grupo por jugarse.', v_partidos_pendientes;
    end if;

    if v_torneo.formato_liga = 'first_stand' then
      select array_agg(participant_id order by puesto_orden)
      into v_participantes
      from (
        select participant_id,
          case puesto when 1 then 3 when 2 then 1 when 3 then 2 when 4 then 4 end as puesto_orden
        from (
          select participant_id,
                 row_number() over (order by puntos desc, dif_mapas desc, inscrito_en asc) as puesto
          from public.posiciones_grupos(p_tournament_id)
        ) clasificados
        where puesto <= 4
      ) sembrados;
    else
      -- Los avanzan_por_grupo mejores de cada grupo, según la tabla de
      -- posiciones (puntos desc, diferencia de mapas como desempate,
      -- orden de inscripción como último desempate).
      select array_agg(participant_id order by random())
      into v_participantes
      from (
        select participant_id,
               row_number() over (
                 partition by group_id order by puntos desc, dif_mapas desc, inscrito_en asc
               ) as puesto
        from public.posiciones_grupos(p_tournament_id)
      ) clasificados
      where puesto <= v_torneo.avanzan_por_grupo;
    end if;
  else
    if v_torneo.estado <> 'abierto' then
      raise exception 'Este torneo ya no está abierto para generar la llave.';
    end if;

    -- Migración 010: solo entran a la llave los que confirmaron
    -- check_in = true -- los demás quedan afuera de esta edición, sin
    -- bye ni nada.
    select array_agg(id order by random()) into v_participantes
    from public.tournament_participants
    where tournament_id = p_tournament_id and checked_in = true;
  end if;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 2 then
    raise exception 'Necesitas al menos 2 jugadores confirmados para generar la llave.';
  end if;

  v_next_pow2 := 1;
  while v_next_pow2 < v_n loop
    v_next_pow2 := v_next_pow2 * 2;
  end loop;

  v_num_matches := v_next_pow2 / 2;
  v_num_byes := v_next_pow2 - v_n;

  select array_agg(x order by random())
  into v_bye_matches
  from generate_series(1, v_num_matches) as x;
  v_bye_matches := v_bye_matches[1:v_num_byes];

  for v_i in 1..v_num_matches loop
    v_es_bye := v_i = any(v_bye_matches);

    v_p1 := v_participantes[array_length(v_participantes, 1)];
    v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];

    if v_es_bye then
      v_p2 := null;
    else
      v_p2 := v_participantes[array_length(v_participantes, 1)];
      v_participantes := v_participantes[1:array_length(v_participantes, 1) - 1];
    end if;

    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, winner_id, status
    )
    values (
      p_tournament_id,
      1,
      v_i,
      v_p1,
      v_p2,
      case when v_es_bye then v_p1 else null end,
      case when v_es_bye then 'jugado' else 'pendiente' end
    );
  end loop;

  -- check_in_abierto pasa a false en el mismo UPDATE que cierra las
  -- inscripciones: si algo de arriba falla (por ejemplo, menos de 2
  -- confirmados), el raise exception revierte toda la función,
  -- incluido esto -- el torneo no queda en un estado a medio camino.
  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'eliminacion'
    where id = p_tournament_id;

  for v_i in 1..v_num_matches loop
    if v_i = any(v_bye_matches) then
      perform public.avanzar_ganador(
        (select id from public.bracket_matches
         where tournament_id = p_tournament_id and round = 1 and match_number = v_i)
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.generar_llave(uuid) to authenticated;

-- ------------------------------------------------------------
-- Trigger + función que otorgaban carisma al crear un torneo.
-- ------------------------------------------------------------
drop trigger if exists after_insert_tournaments_carisma on public.tournaments;
drop function if exists public.otorgar_carisma_torneo_creado();

-- ------------------------------------------------------------
-- Like a casters -- función y tabla.
-- ------------------------------------------------------------
drop function if exists public.dar_like_caster(uuid);
drop table if exists public.caster_likes cascade;

-- ------------------------------------------------------------
-- Funciones que otorgaban carisma (jugador y equipo) y sus tablas de
-- registro.
-- ------------------------------------------------------------
drop function if exists public.registrar_carisma(uuid, integer, text);
drop function if exists public.registrar_carisma_equipo(uuid, integer, text);
drop table if exists public.carisma_log cascade;
drop table if exists public.team_carisma_log cascade;

-- ------------------------------------------------------------
-- Columnas de contador -- el drop de columna ya revoca por su cuenta
-- cualquier grant de columna que existiera sobre ellas (no hace falta
-- un revoke aparte).
-- ------------------------------------------------------------
alter table public.profiles drop column if exists carisma;
alter table public.teams drop column if exists carisma;
