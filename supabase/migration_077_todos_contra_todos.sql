-- ------------------------------------------------------------
-- Migración 077: motor real para el modo "Todos contra todos" --
-- hasta ahora era una opción seleccionable al crear un torneo, sin
-- ninguna función detrás (ni check-in, ni forma de armar los
-- partidos, ni de cerrarlo). Reutiliza exactamente el mismo trío de
-- tablas que Suizo y la etapa de grupos clásica (tournament_groups /
-- tournament_group_participants / tournament_group_matches /
-- posiciones_grupos()), como un solo grupo -- pero a diferencia de
-- Suizo, SÍ usa check-in (mismo mecanismo que eliminación simple), y
-- arma TODOS los partidos de una sola vez en vez de ronda por ronda:
-- cada inscrito confirmado juega contra todos los demás exactamente
-- una vez.
-- ------------------------------------------------------------

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
  v_i int;
  v_j int;
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

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Todos contra todos')
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  -- Fixture completo: cada par de inscritos se enfrenta exactamente
  -- una vez -- N*(N-1)/2 partidos en total.
  for v_i in 1..v_n loop
    for v_j in (v_i + 1)..v_n loop
      insert into public.tournament_group_matches (group_id, participant1_id, participant2_id)
      values (v_grupo_id, v_participantes[v_i], v_participantes[v_j]);
    end loop;
  end loop;

  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_todos_contra_todos(uuid) to authenticated;

create or replace function public.finalizar_todos_contra_todos(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_grupo_id uuid;
  v_pendientes int;
  v_campeon uuid;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede finalizar el torneo.';
  end if;
  if v_torneo.modo <> 'todos_contra_todos' then
    raise exception 'Este torneo no es de formato Todos contra todos.';
  end if;
  if v_torneo.estado <> 'en_curso' then
    raise exception 'Este torneo no está en curso.';
  end if;

  select id into v_grupo_id from public.tournament_groups where tournament_id = p_tournament_id;
  if v_grupo_id is null then
    raise exception 'Todavía no se inició el torneo.';
  end if;

  select count(*) into v_pendientes
  from public.tournament_group_matches
  where group_id = v_grupo_id and status <> 'jugado';

  if v_pendientes > 0 then
    raise exception 'Todavía faltan % partido(s) por jugarse.', v_pendientes;
  end if;

  -- Mismo desempate que Suizo: más puntos, después diferencia de
  -- mapas, después quién se inscribió primero.
  select participant_id into v_campeon
  from public.posiciones_grupos(p_tournament_id)
  order by puntos desc, dif_mapas desc, inscrito_en asc
  limit 1;

  update public.tournaments
    set estado = 'finalizado', campeon_participant_id = v_campeon
    where id = p_tournament_id;
end;
$$;

grant execute on function public.finalizar_todos_contra_todos(uuid) to authenticated;
