-- ============================================================
-- Migración 050: dos ajustes al sistema de Carisma (migración 049).
--
-- 1) El +10 de carisma que gana un caster al crear un torneo o
--    proponer una Clan War ya NO es 100% para él: el 80% (8 puntos)
--    va a su cuenta, el 20% (2 puntos) va al clan al que pertenece
--    ACTUALMENTE (profiles.carisma y teams.carisma son cosas
--    separadas -- este reparto solo mueve puntos entre las dos). Sin
--    equipo, el 100% se queda con el caster -- no hay a quién
--    repartirle. Los likes (origen 'like') NO se tocan, siguen 100%
--    para el caster: el reparto se implementó adentro de
--    registrar_carisma(), condicionado a origen = 'evento_creado', así
--    que dar_like_caster() sigue funcionando exactamente igual.
--
-- 2) teams.carisma (nuevo, mismo patrón sin tope que profiles.carisma)
--    + team_carisma_log. Un equipo gana carisma cuando su dueño o un
--    capitán organiza un torneo o una Clan War, en 3 niveles según el
--    tamaño REAL del evento -- evaluado al cerrarse las inscripciones
--    (generar_llave(), incluso si hubo etapa de grupos antes -- ahí se
--    vuelve a contar el total de inscritos confirmados, no solo los
--    que avanzaron de grupos, para reflejar el tamaño real del
--    evento) o al proponer la Clan War (su tamaño no varía después,
--    siempre son exactamente 2 clanes):
--      - evento_normal (+5): Clan War (siempre), o torneo con 16 o
--        menos jugadores.
--      - evento_grande (+15): torneo con más de 16 jugadores.
--      - evento_masivo (+40): torneo con más de 5 clanes Y más de 16
--        jugadores a la vez (solo posible en un torneo por equipos).
--    "Jugadores" en un torneo por equipos se aproxima como cupos
--    ocupados × jugadores mínimos de ese formato (2v2/3v3/4v4) --  no
--    existe un roster guardado por torneo para contar cabezas reales,
--    mismo límite que ya se disclosureó para el ranking de jugadores
--    (migración 048).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 2a) teams.carisma + team_carisma_log.
-- ------------------------------------------------------------
alter table public.teams add column if not exists carisma integer not null default 0 check (carisma >= 0);

create table public.team_carisma_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  cantidad integer not null,
  origen text not null check (origen in ('evento_normal', 'evento_grande', 'evento_masivo', 'caster_del_clan')),
  created_at timestamptz not null default now()
);

alter table public.team_carisma_log enable row level security;

create policy "team_carisma_log_select_publico"
  on public.team_carisma_log for select
  using (true);

-- Sin política de insert para authenticated -- la única forma de
-- escribir acá es registrar_carisma_equipo(), security definer.
grant select on public.team_carisma_log to anon, authenticated;

create or replace function public.registrar_carisma_equipo(p_team_id uuid, p_cantidad integer, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.teams set carisma = carisma + p_cantidad where id = p_team_id;
  insert into public.team_carisma_log (team_id, cantidad, origen) values (p_team_id, p_cantidad, p_origen);
end;
$$;

-- ------------------------------------------------------------
-- 1) registrar_carisma(): 80/20 con el clan actual, solo para
--    origen = 'evento_creado' -- mismo nombre y firma de siempre, así
--    que otorgar_carisma_torneo_creado() y proponer_clan_war() no
--    necesitan ningún cambio para este punto.
-- ------------------------------------------------------------
create or replace function public.registrar_carisma(p_user_id uuid, p_cantidad integer, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_parte_caster integer;
  v_parte_equipo integer;
begin
  if p_origen = 'evento_creado' then
    select team_id into v_team_id from public.team_members where user_id = p_user_id;

    if v_team_id is not null then
      v_parte_caster := floor(p_cantidad * 0.8)::integer;
      v_parte_equipo := p_cantidad - v_parte_caster;

      update public.profiles set carisma = carisma + v_parte_caster where id = p_user_id;
      insert into public.carisma_log (user_id, cantidad, origen) values (p_user_id, v_parte_caster, p_origen);

      perform public.registrar_carisma_equipo(v_team_id, v_parte_equipo, 'caster_del_clan');
      return;
    end if;
  end if;

  -- Sin equipo, o un like (origen 'like'): 100% para el caster, igual
  -- que antes de esta migración.
  update public.profiles set carisma = carisma + p_cantidad where id = p_user_id;
  insert into public.carisma_log (user_id, cantidad, origen) values (p_user_id, p_cantidad, p_origen);
end;
$$;

-- ------------------------------------------------------------
-- 2b) proponer_clan_war(): +5 de carisma de equipo para quien
--     propone -- una Clan War siempre es "evento normal" (siempre
--     exactamente 2 clanes, sin variación de tamaño posible). Mismo
--     nombre y firma que ya tenía.
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
  v_es_caster boolean;
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;

  if p_temporada_id is not null and not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'Esa temporada no existe.';
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

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id);

  select es_caster into v_es_caster from public.profiles where id = auth.uid();
  if v_es_caster then
    perform public.registrar_carisma(auth.uid(), 10, 'evento_creado');
  end if;

  -- Migración 050: carisma de equipo, siempre "evento normal".
  perform public.registrar_carisma_equipo(v_challenger.id, 5, 'evento_normal');
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 2c) generar_llave(): carisma de equipo por el tamaño real del
--     evento, evaluado con las inscripciones ya cerradas -- mismo
--     nombre y firma de siempre.
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
  v_checked_in_count int;
  v_jugadores_por_equipo int;
  v_total_clanes int;
  v_total_jugadores int;
  v_cantidad_evento int;
  v_origen_evento text;
  v_team_organizador uuid;
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

    -- Los avanzan_por_grupo mejores de cada grupo, según la tabla de
    -- posiciones (ganados desc, orden de inscripción como desempate).
    select array_agg(participant_id order by random())
    into v_participantes
    from (
      select participant_id,
             row_number() over (
               partition by group_id order by ganados desc, inscrito_en asc
             ) as puesto
      from public.posiciones_grupos(p_tournament_id)
    ) clasificados
    where puesto <= v_torneo.avanzan_por_grupo;
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

  -- Migración 050: carisma de equipo por el tamaño real del evento --
  -- se cuenta acá, con las inscripciones ya cerradas y la llave ya
  -- generada. Se recuenta directo de tournament_participants (no se
  -- reutiliza v_n) para que, en un torneo con etapa de grupos, el
  -- tamaño refleje a TODOS los que se inscribieron y confirmaron, no
  -- solo a quienes avanzaron de grupos.
  select count(*) into v_checked_in_count
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_jugadores_por_equipo := case v_torneo.formato
    when '2v2' then 2
    when '3v3' then 3
    when '4v4' then 4
    else 1
  end;
  -- "Clanes" solo tiene sentido en un torneo por equipos -- en 1v1
  -- queda en 0 a propósito, así el nivel "evento_masivo" (más de 5
  -- clanes) nunca se puede alcanzar ahí.
  v_total_clanes := case when v_torneo.formato = '1v1' then 0 else v_checked_in_count end;
  v_total_jugadores := v_checked_in_count * v_jugadores_por_equipo;

  if v_total_clanes > 5 and v_total_jugadores > 16 then
    v_cantidad_evento := 40;
    v_origen_evento := 'evento_masivo';
  elsif v_total_jugadores > 16 then
    v_cantidad_evento := 15;
    v_origen_evento := 'evento_grande';
  else
    v_cantidad_evento := 5;
    v_origen_evento := 'evento_normal';
  end if;

  -- Solo si quien organiza (creador_id) es dueño o capitán de un
  -- equipo actualmente -- sin eso, no hay a quién otorgarle el
  -- carisma.
  select tm.team_id into v_team_organizador
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.user_id = v_torneo.creador_id
    and (t.owner_id = v_torneo.creador_id or tm.es_capitan);

  if v_team_organizador is not null then
    perform public.registrar_carisma_equipo(v_team_organizador, v_cantidad_evento, v_origen_evento);
  end if;
end;
$$;

grant execute on function public.generar_llave(uuid) to authenticated;
