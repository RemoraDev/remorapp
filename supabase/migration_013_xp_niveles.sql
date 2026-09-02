-- ============================================================
-- Migración 013: sistema de experiencia y niveles -- Fase A (solo
-- números, sin skins todavía -- eso es una fase aparte que viene
-- después).
--
--   1) xp y nivel en profiles y en teams. nivel es una columna
--      GENERATED (Postgres la recalcula sola a partir de xp, nunca
--      puede desincronizarse ni escribirse a mano).
--   2) Reparto de XP: extiende avanzar_ganador() (no la duplica) --
--      cubre tanto un reporte normal como uno resuelto por disputa
--      desde /admin, porque las dos rutas terminan llamando a esta
--      misma función.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Constantes -- TODAS en un solo lugar, para poder ajustarlas
--    después sin tocar nada más del sistema (solo hay que cambiar el
--    número acá abajo y volver a correr este CREATE OR REPLACE).
--
--    XP_GANADOR / XP_PERDEDOR: lo que gana cada participante por
--    partida REAL jugada (nunca por un bye -- eso se filtra en
--    avanzar_ganador(), ver más abajo). El perdedor recibe 4 veces
--    menos, para que ganar se siga sintiendo importante.
--
--    Nivel de JUGADOR: nivel = floor(2 * sqrt(xp)), tope 100.
--    Equivale a decir "el nivel N pide N²/4 de XP acumulada". Nivel
--    100 pide 2500 XP. A 20 XP por victoria (mezclando victorias y
--    derrotas, digamos ~12 XP promedio por partida), alguien jugando
--    varias partidas por semana llega a nivel 100 en unos 4 meses de
--    juego constante -- no años.
--
--    Nivel de CLAN: nivel = floor(cbrt(xp / 0.025)), tope 100.
--    Equivale a "el nivel N pide 0.025 × N³ de XP acumulada" -- una
--    curva CÚBICA, no cuadrática: crece mucho más rápido que la del
--    jugador a medida que sube el nivel, así que para el mismo
--    número de nivel el clan siempre pide más XP que un jugador
--    individual, y esa diferencia se agranda cuanto más alto es el
--    nivel. Los primeros niveles caen rápido a propósito (nivel 10 =
--    25 XP, casi nada -- se siente bien apenas el clan arranca), pero
--    nivel 100 pide 25.000 XP acumulada entre TODOS los miembros que
--    participan. Para un clan de varios jugadores activos eso
--    representa más de un año de esfuerzo sostenido del grupo, no
--    algo que un clan chico o una sola persona activa logre en
--    semanas.
--
--    Si al probarlo se siente muy fácil o muy difícil, avisa y se
--    ajustan estos números -- no son definitivos.
-- ------------------------------------------------------------
create or replace function public.xp_ganador_partida()
returns int
language sql
immutable
as $$ select 20 $$;

create or replace function public.xp_perdedor_partida()
returns int
language sql
immutable
as $$ select 5 $$;

create or replace function public.calcular_nivel_jugador(p_xp int)
returns int
language sql
immutable
as $$
  select least(100, floor(2 * sqrt(greatest(p_xp, 0)))::int);
$$;

create or replace function public.calcular_nivel_clan(p_xp int)
returns int
language sql
immutable
as $$
  select least(100, floor(cbrt(greatest(p_xp, 0) / 0.025))::int);
$$;

-- ------------------------------------------------------------
-- 2) Columnas nuevas. nivel es GENERATED ALWAYS: se recalcula sola
--    en cada cambio de xp, nadie (ni el propio dueño de la fila)
--    puede escribirla a mano -- Postgres la rechaza directo.
-- ------------------------------------------------------------
alter table public.profiles add column xp integer not null default 0;
alter table public.profiles add column nivel integer generated always as (public.calcular_nivel_jugador(xp)) stored;

alter table public.teams add column xp integer not null default 0;
alter table public.teams add column nivel integer generated always as (public.calcular_nivel_clan(xp)) stored;

-- xp SÍ se puede escribir (a diferencia de nivel, que Postgres ya
-- protege solo), pero no por el propio usuario/dueño directo: si no
-- se hiciera este revoke, cualquiera podría regalarse XP con un
-- update común, porque profiles_update_propio / teams_update_propio
-- (las políticas que ya existen) dejan editar la fila propia entera.
-- Mismo patrón que ya se usa con profiles.email (revoke de columna),
-- pero acá es de escritura, no de lectura. otorgar_xp_participante()
-- (más abajo) sigue pudiendo escribir xp porque corre security
-- definer, con los privilegios de quien es dueño de la función, no
-- los de "authenticated".
revoke update (xp) on public.profiles from authenticated;
revoke update (xp) on public.teams from authenticated;
-- CORRECCIÓN (migración 017): este revoke tampoco funcionó, mismo
-- motivo que profiles.email -- patch_002_profile_self_update.sql y
-- migration_007_avatares_banners.sql ya habían otorgado UPDATE de
-- tabla completa, y un revoke de columna no puede recortar eso. xp
-- quedó editable con un update común hasta la migración 017, que lo
-- arregla de verdad. Se deja esta línea tal cual, como registro de lo
-- que se corrió en su momento.

-- ------------------------------------------------------------
-- 3) otorgar_xp_participante: le da XP a un participante de bracket,
--    sea jugador individual o equipo (ver migración 009 -- cada
--    tournament_participants.id es una cosa o la otra, nunca las
--    dos). En el caso de equipo, CADA miembro recibe esta misma
--    cantidad en su propio perfil, y el equipo suma esa misma
--    cantidad UNA VEZ POR CADA MIEMBRO que participa -- así un clan
--    grande y activo acumula más rápido que uno chico, a propósito
--    (ver la explicación de la curva de clan más arriba). Si el
--    participante es un jugador individual que además pertenece a un
--    equipo, ese equipo también recibe la misma cantidad -- cualquier
--    miembro que juega aporta al clan, sin importar quién sea.
-- ------------------------------------------------------------
create or replace function public.otorgar_xp_participante(p_participant_id uuid, p_xp int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_team_id uuid;
begin
  select user_id, team_id into v_participante
  from public.tournament_participants
  where id = p_participant_id;

  if v_participante.user_id is not null then
    update public.profiles set xp = xp + p_xp where id = v_participante.user_id;

    select team_id into v_team_id from public.team_members where user_id = v_participante.user_id;
    if v_team_id is not null then
      update public.teams set xp = xp + p_xp where id = v_team_id;
    end if;

  elsif v_participante.team_id is not null then
    update public.profiles
      set xp = xp + p_xp
      where id in (select user_id from public.team_members where team_id = v_participante.team_id);

    update public.teams
      set xp = xp + p_xp * (select count(*) from public.team_members where team_id = v_participante.team_id)
      where id = v_participante.team_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4) avanzar_ganador: se extiende (no se duplica) para repartir XP
--    justo antes de la lógica de avance que ya existía. Solo en
--    partidas REALES (con los dos participantes presentes) -- un bye
--    no se jugó, nadie gana XP por eso.
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
  v_perdedor_id uuid;
begin
  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    v_perdedor_id := case
      when v_match.winner_id = v_match.participant1_id then v_match.participant2_id
      else v_match.participant1_id
    end;

    perform public.otorgar_xp_participante(v_match.winner_id, public.xp_ganador_partida());
    perform public.otorgar_xp_participante(v_perdedor_id, public.xp_perdedor_partida());
  end if;

  select count(*) into v_total_en_ronda
  from public.bracket_matches
  where tournament_id = v_match.tournament_id and round = v_match.round;

  if v_total_en_ronda = 1 then
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
