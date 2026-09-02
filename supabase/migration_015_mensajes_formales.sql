-- ============================================================
-- Migración 015: tono formal en mensajes de error.
--
-- Cambia el texto de 4 mensajes de error que tenían modismos chilenos
-- ("wn", "pillado") por un tono formal y neutro, entendible en
-- cualquiera de los países donde funciona RemorApp (Chile, Guatemala,
-- Puerto Rico, Argentina, Perú, Bolivia). No cambia ninguna lógica --
-- cada función queda exactamente igual, solo el texto entre comillas
-- del raise exception.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create or replace function public.validar_tag_unico_por_servidor()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.teams t
    where t.tag = new.tag
      and t.id is distinct from new.id
      and t.sc2_regions && new.sc2_regions
  ) then
    raise exception 'Ese tag ya está en uso en uno de esos servidores. Intenta con otro.';
  end if;

  return new;
end;
$$;

create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by)
  values (p_team_id, p_user_id, auth.uid());

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

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
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar la llave.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

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
    set estado = 'en_curso', check_in_abierto = false
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

create or replace function public.proponer_apuesta(p_challenged_team_id uuid, p_monto int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger_team_id uuid;
  v_challenger_xp int;
  v_id uuid;
begin
  select team_id into v_challenger_team_id
  from public.team_members
  where user_id = auth.uid() and roles @> array['owner']::text[];

  if v_challenger_team_id is null then
    raise exception 'Tienes que ser dueño de un equipo para proponer una apuesta.';
  end if;

  if v_challenger_team_id = p_challenged_team_id then
    raise exception 'No puedes desafiar a tu propio equipo.';
  end if;

  if not exists (select 1 from public.teams where id = p_challenged_team_id) then
    raise exception 'Ese equipo no existe.';
  end if;

  if p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a 0.';
  end if;

  select xp into v_challenger_xp from public.teams where id = v_challenger_team_id;
  if p_monto > v_challenger_xp then
    raise exception 'No puedes apostar más XP del que tiene tu equipo (tiene %).', v_challenger_xp;
  end if;

  insert into public.team_xp_wagers (challenger_team_id, challenged_team_id, monto)
  values (v_challenger_team_id, p_challenged_team_id, p_monto)
  returning id into v_id;

  return v_id;
end;
$$;
