-- ============================================================
-- Migración 041: etapa de grupos previa a la llave eliminatoria.
--
-- 1) tournaments: tiene_fase_grupos, cantidad_grupos, avanzan_por_grupo,
--    fase_actual ('grupos' / 'eliminacion', default 'eliminacion' para
--    no romper los torneos que ya existen -- todos arrancan como si
--    ya estuvieran en la fase de eliminación, que es como se
--    comportaban antes de esta migración).
-- 2) tournament_groups / tournament_group_participants /
--    tournament_group_matches: mismo espíritu público de lectura que
--    bracket_matches (select using(true) -- un torneo se puede ver
--    completo con el link, grupos incluidos).
-- 3) generar_grupos(): reparte a los confirmados en la cantidad de
--    grupos elegida (round robin sobre una lista ya barajada, así el
--    reparto es parejo -- nunca de más de 1 de diferencia entre
--    grupos -- y al azar) y arma todos los partidos de todos contra
--    todos de cada grupo. Deja fase_actual = 'grupos' y el torneo
--    'en_curso' (mismo criterio que generar_llave(): una vez que
--    arranca la competencia, se cierran las inscripciones).
-- 4) reportar_resultado_grupo(): mismo criterio de PERMISO que
--    reportar_resultado() (organizador o cualquiera de los dos
--    participantes), pero sin el mecanismo de doble confirmación ni
--    de disputa de bracket_matches -- el esquema que se pidió para
--    tournament_group_matches solo tiene 'pendiente'/'jugado', sin un
--    estado de disputa, así que cualquiera de los autorizados
--    resuelve el partido al toque, sin esperar al otro lado. Se
--    disclosea acá porque es una simplificación real respecto al
--    mecanismo de la llave, no un descuido.
-- 5) posiciones_grupos(): tabla de posiciones de TODOS los grupos de
--    un torneo de una sola vez (el frontend agrupa por group_id) --
--    ordenada por partidos ganados, empate por orden de inscripción.
--    Sin diferencia de mapas todavía (queda pendiente para cuando se
--    construya el formato WTL, como pidió el usuario).
-- 6) generar_llave(): SE REUTILIZA, no se duplica. Ahora, si el
--    torneo tiene fase de grupos y fase_actual = 'grupos', en vez de
--    tomar a todos los confirmados toma a los avanzan_por_grupo
--    mejores de cada grupo (según posiciones_grupos()) -- y exige que
--    no queden partidos de grupo pendientes. El resto de la función
--    (armado de la llave, byes, etc.) es exactamente el mismo código
--    de siempre.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas en tournaments
-- ------------------------------------------------------------
alter table public.tournaments add column if not exists tiene_fase_grupos boolean not null default false;
alter table public.tournaments add column if not exists cantidad_grupos integer;
alter table public.tournaments add column if not exists avanzan_por_grupo integer;
alter table public.tournaments add column if not exists fase_actual text not null default 'eliminacion'
  check (fase_actual in ('grupos', 'eliminacion'));

-- ------------------------------------------------------------
-- 2) Tablas nuevas
-- ------------------------------------------------------------
create table public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

alter table public.tournament_groups enable row level security;

create policy "tournament_groups_select_publico"
  on public.tournament_groups for select
  using (true);

grant select on public.tournament_groups to anon, authenticated;

create table public.tournament_group_participants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.tournament_groups (id) on delete cascade,
  participant_id uuid not null references public.tournament_participants (id) on delete cascade,
  -- Un participante pertenece a un solo grupo dentro de su torneo.
  unique (participant_id)
);

alter table public.tournament_group_participants enable row level security;

create policy "tournament_group_participants_select_publico"
  on public.tournament_group_participants for select
  using (true);

grant select on public.tournament_group_participants to anon, authenticated;

create table public.tournament_group_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.tournament_groups (id) on delete cascade,
  participant1_id uuid not null references public.tournament_participants (id),
  participant2_id uuid not null references public.tournament_participants (id),
  ganador_id uuid references public.tournament_participants (id),
  status text not null default 'pendiente' check (status in ('pendiente', 'jugado')),
  created_at timestamptz not null default now(),
  check (participant1_id <> participant2_id),
  check (ganador_id is null or ganador_id in (participant1_id, participant2_id))
);

alter table public.tournament_group_matches enable row level security;

create policy "tournament_group_matches_select_publico"
  on public.tournament_group_matches for select
  using (true);

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es generar_grupos() y
-- reportar_resultado_grupo(), security definer, mismo patrón que
-- bracket_matches/generar_llave()/reportar_resultado().
grant select on public.tournament_group_matches to anon, authenticated;

-- ------------------------------------------------------------
-- 3) generar_grupos()
-- ------------------------------------------------------------
create or replace function public.generar_grupos(p_tournament_id uuid)
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
  v_nombre text;
  v_idx int;
  v_participantes_grupo uuid[];
  v_i int;
  v_j int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar los grupos.';
  end if;
  if not v_torneo.tiene_fase_grupos then
    raise exception 'Este torneo no tiene etapa de grupos configurada.';
  end if;
  if v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora la etapa de grupos solo está disponible para el modo de eliminación simple.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar los grupos.';
  end if;
  if v_torneo.cantidad_grupos is null or v_torneo.cantidad_grupos < 2 then
    raise exception 'La cantidad de grupos configurada no es válida.';
  end if;
  if v_torneo.avanzan_por_grupo is null or v_torneo.avanzan_por_grupo < 1 then
    raise exception 'La cantidad de clasificados por grupo configurada no es válida.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < v_torneo.cantidad_grupos * 2 then
    raise exception 'Necesitas al menos % jugadores confirmados para % grupos (mínimo 2 por grupo).',
      v_torneo.cantidad_grupos * 2, v_torneo.cantidad_grupos;
  end if;
  if v_torneo.avanzan_por_grupo * v_torneo.cantidad_grupos < 2 then
    raise exception 'La cantidad de clasificados totales tiene que ser al menos 2 para armar la llave después.';
  end if;

  for v_idx in 1..v_torneo.cantidad_grupos loop
    v_nombre := 'Grupo ' || chr(64 + v_idx); -- 65 = 'A' en ASCII/UTF-8.

    insert into public.tournament_groups (tournament_id, nombre)
    values (p_tournament_id, v_nombre)
    returning id into v_grupo_id;

    -- Reparto equilibrado: round robin sobre la lista ya barajada al
    -- azar arriba -- cada grupo recibe un participante por turno, así
    -- que ningún grupo queda con más de 1 de diferencia respecto a
    -- los demás.
    v_participantes_grupo := array[]::uuid[];
    v_i := v_idx;
    while v_i <= v_n loop
      v_participantes_grupo := array_append(v_participantes_grupo, v_participantes[v_i]);
      v_i := v_i + v_torneo.cantidad_grupos;
    end loop;

    for v_j in 1..array_length(v_participantes_grupo, 1) loop
      insert into public.tournament_group_participants (group_id, participant_id)
      values (v_grupo_id, v_participantes_grupo[v_j]);
    end loop;

    -- Todos contra todos dentro del grupo: cada par exactamente una vez.
    for v_i in 1..array_length(v_participantes_grupo, 1) loop
      for v_j in (v_i + 1)..array_length(v_participantes_grupo, 1) loop
        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id)
        values (v_grupo_id, v_participantes_grupo[v_i], v_participantes_grupo[v_j]);
      end loop;
    end loop;
  end loop;

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'grupos'
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_grupos(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) reportar_resultado_grupo()
-- ------------------------------------------------------------
create or replace function public.reportar_resultado_grupo(p_match_id uuid, p_ganador_id uuid)
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
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
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
    set ganador_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;
end;
$$;

grant execute on function public.reportar_resultado_grupo(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) posiciones_grupos(): tabla de posiciones de todos los grupos de
--    un torneo. Pública (select), como cualquier otro dato del
--    torneo -- se muestra en /tournaments/:id sin restricción.
-- ------------------------------------------------------------
create or replace function public.posiciones_grupos(p_tournament_id uuid)
returns table (
  group_id uuid,
  group_nombre text,
  participant_id uuid,
  ganados bigint,
  jugados bigint,
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
    coalesce(pl.jugados, 0) as jugados,
    tp.inscrito_en
  from public.tournament_groups g
  join public.tournament_group_participants gp on gp.group_id = g.id
  join public.tournament_participants tp on tp.id = gp.participant_id
  left join (
    select group_id, ganador_id, count(*) as ganados
    from public.tournament_group_matches
    where status = 'jugado'
    group by group_id, ganador_id
  ) w on w.group_id = g.id and w.ganador_id = gp.participant_id
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
  where g.tournament_id = p_tournament_id
  order by g.nombre, coalesce(w.ganados, 0) desc, tp.inscrito_en asc;
$$;

grant execute on function public.posiciones_grupos(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 6) generar_llave(): mismo nombre y firma de siempre, ahora también
--    sirve para cerrar la etapa de grupos -- no se creó una función
--    aparte para eso, tal como se pidió.
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
