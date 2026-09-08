-- ------------------------------------------------------------
-- Migración 078: Todos contra todos arma los partidos organizados por
-- ronda (método del círculo, el estándar de cualquier fixture de
-- todos-contra-todos real) -- antes generaba los mismos partidos pero
-- sin ningún orden, así que la interfaz no podía mostrarlos agrupados
-- en "Ronda 1", "Ronda 2", etc.
--
-- Método del círculo: con N participantes (par -- si N es impar se
-- agrega un "bye" fantasma que no genera partido), hay N-1 rondas de
-- N/2 partidos cada una. Se fija el primer participante en su lugar y
-- se rota el resto en cada ronda -- así nadie repite rival y todos
-- juegan una vez por ronda.
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
  v_arr uuid[];
  v_rondas int;
  v_r int;
  v_i int;
  v_j int;
  v_p1 uuid;
  v_p2 uuid;
  v_ultimo uuid;
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

  -- Con cantidad impar de confirmados, se agrega un hueco null (bye)
  -- para que el método del círculo trabaje con un número par -- el
  -- hueco nunca genera un partido real, solo hace que ese
  -- participante descanse esa ronda.
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
        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
        values (v_grupo_id, v_p1, v_p2, v_r);
      end if;
    end loop;

    -- Rotación del método del círculo: el primero queda fijo, el
    -- último pasa a la segunda posición, y el resto se corre un lugar.
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

grant execute on function public.generar_todos_contra_todos(uuid) to authenticated;
