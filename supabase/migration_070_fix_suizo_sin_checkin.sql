-- ------------------------------------------------------------
-- Migración 070: corrección encontrada probando la 069 en vivo --
-- generar_torneo_suizo() exigía checked_in = true, pero el formato
-- Suizo no tiene (todavía) ninguna pantalla de check-in propia -- esa
-- pantalla es exclusiva del flujo de eliminación simple. Mientras no
-- exista una, Suizo arranca con TODOS los inscritos, sin pedir
-- confirmación de asistencia.
-- ------------------------------------------------------------
create or replace function public.generar_torneo_suizo(p_tournament_id uuid)
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
  v_rondas int;
  v_i int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede iniciar el torneo.';
  end if;
  if v_torneo.modo <> 'suizo' then
    raise exception 'Este torneo no es de formato Suizo.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para iniciar.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'Necesitas al menos 3 jugadores inscritos para un torneo Suizo.';
  end if;

  v_rondas := coalesce(v_torneo.swiss_rondas_totales, ceil(log(2, v_n))::int);
  if v_rondas < 1 then
    v_rondas := 1;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (p_tournament_id, 'Suizo')
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  v_i := 1;
  while v_i < v_n loop
    insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada)
    values (v_grupo_id, v_participantes[v_i], v_participantes[v_i + 1], 1);
    v_i := v_i + 2;
  end loop;

  update public.tournaments
    set estado = 'en_curso', swiss_rondas_totales = v_rondas
    where id = p_tournament_id;
end;
$$;

grant execute on function public.generar_torneo_suizo(uuid) to authenticated;
