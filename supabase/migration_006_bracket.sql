-- ============================================================
-- Migración 006: llave de eliminación simple (1v1) — generar,
-- reportar resultados, avanzar ganadores, finalizar torneo.
--
-- Por ahora SOLO para formato 1v1 y modo eliminacion_simple; el
-- resto queda para más adelante. No toca nada de lo que ya existe.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) bracket_matches
-- ------------------------------------------------------------
create table public.bracket_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null,
  match_number int not null,
  participant1_id uuid references public.tournament_participants (id),
  -- null = bye (pase directo): participant1_id avanza solo.
  participant2_id uuid references public.tournament_participants (id),
  winner_id uuid references public.tournament_participants (id),
  -- Lo que reportó cada participante por su cuenta (no el organizador,
  -- que decide directo). Sirven solo para detectar si coinciden o no
  -- -- ver reportar_resultado() más abajo.
  reported_p1_winner uuid references public.tournament_participants (id),
  reported_p2_winner uuid references public.tournament_participants (id),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'jugado', 'en_disputa')),
  created_at timestamptz not null default now(),
  unique (tournament_id, round, match_number)
);

alter table public.bracket_matches enable row level security;

-- Cualquiera puede ver la llave (mismo criterio que el resto de la
-- info pública de un torneo).
create policy "bracket_matches_select_publico"
  on public.bracket_matches for select
  using (true);

-- A propósito NO hay política de insert/update para authenticated acá:
-- la única forma de escribir en esta tabla es a través de
-- generar_llave() y reportar_resultado() (más abajo), que son security
-- definer y revisan permisos por su cuenta -- así el frontend no puede
-- fabricar un resultado o una llave mandando un insert/update directo,
-- solo escondiendo el botón no alcanzaría.
grant select on public.bracket_matches to anon, authenticated;

-- Campeón del torneo, para que el historial lo pueda mostrar.
alter table public.tournaments
  add column if not exists campeon_participant_id uuid references public.tournament_participants (id);

-- ------------------------------------------------------------
-- 2) generar_llave: arma la ronda 1 al azar, asigna byes si hace
--    falta (nunca un bye contra otro bye: ver el comentario largo
--    más abajo), y pasa el torneo a en_curso.
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
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar la llave.';
  end if;
  if v_torneo.formato <> '1v1' or v_torneo.modo <> 'eliminacion_simple' then
    raise exception 'Por ahora la llave solo está disponible para 1v1 eliminación simple.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para generar la llave.';
  end if;

  select array_agg(id order by random()) into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 2 then
    raise exception 'Hace falta al menos 2 inscritos para generar la llave.';
  end if;

  -- Próxima potencia de 2 que alcance para todos los inscritos.
  v_next_pow2 := 1;
  while v_next_pow2 < v_n loop
    v_next_pow2 := v_next_pow2 * 2;
  end loop;

  v_num_matches := v_next_pow2 / 2;
  v_num_byes := v_next_pow2 - v_n;

  -- v_num_byes siempre es menor que v_num_matches (es una propiedad de
  -- "próxima potencia de 2"), así que alcanza un bye por partido como
  -- máximo -- nunca bye contra bye. Se eligen al azar cuáles partidos
  -- de la ronda 1 reciben uno.
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

  update public.tournaments set estado = 'en_curso' where id = p_tournament_id;

  -- Los byes ya quedan "jugados": se avanza a esos ganadores a la
  -- ronda 2 de una vez, para que no queden esperando un reporte que
  -- nunca va a llegar (no hay nada que reportar en un bye).
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
-- 3) avanzar_ganador: mete al ganador de una partida ya jugada en
--    la partida que le toca de la ronda siguiente (creándola si
--    hace falta), o termina el torneo si era la final.
-- ------------------------------------------------------------
create or replace function public.avanzar_ganador(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_total_en_ronda int;
  v_target_match_number int;
  v_target record;
  v_es_impar boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round;

  if v_total_en_ronda = 1 then
    -- Era la partida de la final: se acabó el torneo.
    update public.tournaments
      set estado = 'finalizado', campeon_participant_id = v_match.winner_id
      where id = v_match.tournament_id;
    return;
  end if;

  v_target_match_number := ceil(v_match.match_number::numeric / 2);
  v_es_impar := (v_match.match_number % 2) = 1;

  select * into v_target
  from public.bracket_matches
  where tournament_id = v_match.tournament_id
    and round = v_match.round + 1
    and match_number = v_target_match_number
  for update;

  if not found then
    insert into public.bracket_matches (
      tournament_id, round, match_number, participant1_id, participant2_id, status
    )
    values (
      v_match.tournament_id,
      v_match.round + 1,
      v_target_match_number,
      case when v_es_impar then v_match.winner_id else null end,
      case when v_es_impar then null else v_match.winner_id end,
      'pendiente'
    );
  else
    if v_es_impar then
      update public.bracket_matches set participant1_id = v_match.winner_id where id = v_target.id;
    else
      update public.bracket_matches set participant2_id = v_match.winner_id where id = v_target.id;
    end if;
  end if;
end;
$$;

-- No lleva grant a authenticated a propósito: solo la llaman
-- generar_llave() y reportar_resultado(), nunca directo desde el
-- frontend.

-- ------------------------------------------------------------
-- 4) reportar_resultado: quién puede reportar (organizador o uno de
--    los dos participantes de ESA partida, verificado acá, no solo
--    escondido en la pantalla), y qué pasa si los dos participantes
--    reportan distinto (en_disputa, sin resolverse sola).
-- ------------------------------------------------------------
create or replace function public.reportar_resultado(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
  v_user_p1 uuid;
  v_user_p2 uuid;
  v_soy_p1 boolean;
  v_soy_p2 boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if v_match.status = 'en_disputa' then
    raise exception 'Resultado en disputa, un administrador debe resolverlo.';
  end if;
  if v_match.participant2_id is null then
    raise exception 'Esta partida es un bye, no se reporta.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  v_es_organizador := (v_torneo.creador_id = auth.uid());

  select user_id into v_user_p1 from public.tournament_participants where id = v_match.participant1_id;
  select user_id into v_user_p2 from public.tournament_participants where id = v_match.participant2_id;
  v_soy_p1 := (v_user_p1 = auth.uid());
  v_soy_p2 := (v_user_p2 = auth.uid());

  if not v_es_organizador and not v_soy_p1 and not v_soy_p2 then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  if v_es_organizador then
    -- El organizador decide directo, no necesita que ambos coincidan.
    update public.bracket_matches
      set winner_id = p_ganador_id, status = 'jugado'
      where id = p_match_id;
  else
    if v_soy_p1 then
      update public.bracket_matches set reported_p1_winner = p_ganador_id where id = p_match_id;
    else
      update public.bracket_matches set reported_p2_winner = p_ganador_id where id = p_match_id;
    end if;

    select * into v_match from public.bracket_matches where id = p_match_id;

    if v_match.reported_p1_winner is not null and v_match.reported_p2_winner is not null then
      if v_match.reported_p1_winner = v_match.reported_p2_winner then
        update public.bracket_matches
          set winner_id = v_match.reported_p1_winner, status = 'jugado'
          where id = p_match_id;
      else
        update public.bracket_matches set status = 'en_disputa' where id = p_match_id;
      end if;
    end if;
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.status = 'jugado' then
    perform public.avanzar_ganador(p_match_id);
  end if;
end;
$$;

grant execute on function public.reportar_resultado(uuid, uuid) to authenticated;
