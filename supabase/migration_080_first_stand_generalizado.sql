-- ------------------------------------------------------------
-- Migración 080: First Stand ya no exige exactamente 7 equipos.
--
-- generar_fixture_first_stand() tenía escrito a mano, para 7 equipos
-- fijos, el mismo método del círculo que se generalizó para "Todos
-- contra todos" en la migración 078 -- alcanza con reemplazar ese
-- fragmento por el genérico (funciona igual para 7 que para
-- cualquier N) y sacar el chequeo "v_n <> 7". La cantidad de equipos
-- que avanzan a los playoffs, antes fija en 4, ahora se toma de
-- avanzan_por_grupo (configurable desde el formulario de creación).
-- ------------------------------------------------------------
create or replace function public.generar_fixture_first_stand(p_tournament_id uuid)
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
  v_avanzan int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar el fixture.';
  end if;
  if v_torneo.formato_liga is distinct from 'first_stand' then
    raise exception 'Este torneo no está configurado como First Stand.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar el fixture.';
  end if;

  select array_agg(id order by random())
  into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'First Stand necesita al menos 3 equipos confirmados (hay %).', v_n;
  end if;

  v_avanzan := coalesce(v_torneo.avanzan_por_grupo, 4);
  if v_avanzan < 2 or v_avanzan > v_n then
    raise exception 'La cantidad de equipos que avanzan a playoffs no puede superar la cantidad de confirmados.';
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Fase de todos contra todos')
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  -- Método del círculo genérico (igual que generar_todos_contra_todos,
  -- migración 078) -- con N impar se agrega un hueco null (descanso)
  -- para trabajar con un número par.
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

    v_ultimo := v_arr[v_n];
    for v_j in reverse v_n..3 loop
      v_arr[v_j] := v_arr[v_j - 1];
    end loop;
    v_arr[2] := v_ultimo;
  end loop;

  -- cantidad_grupos = 1 para que generar_llave() reutilice tal cual su
  -- rama existente de "cerrar grupos y armar la llave con los
  -- clasificados" -- avanzan_por_grupo ahora queda en lo que el
  -- organizador haya elegido, no fijo en 4.
  update public.tournaments
    set estado = 'en_curso', check_in_abierto = false, fase_actual = 'grupos',
        tiene_fase_grupos = true, cantidad_grupos = 1, avanzan_por_grupo = v_avanzan
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_fixture_first_stand(uuid) to authenticated;
