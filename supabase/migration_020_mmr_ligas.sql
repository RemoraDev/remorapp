-- ============================================================
-- Migración 020: reemplaza el sistema de experiencia y niveles
-- (Fase A, migración 013, más el log/apuestas de XP entre clanes de
-- la migración 014) por un sistema de MMR y ligas oficiales de
-- StarCraft II. Fase 1 nada más: el cálculo de MMR/liga/nivel y la
-- bandera de banca rota -- todavía sin el ajuste de MMR por resultado
-- de partida ni el flujo de Clan Wars, eso es la fase siguiente.
--
-- Reemplazo, no adición: no se mantienen los dos sistemas en
-- paralelo. Se borran profiles.xp, profiles.nivel, teams.xp,
-- teams.nivel, sus funciones de cálculo, team_xp_log y
-- team_xp_wagers completos (con ellos se va también el sistema de
-- apostar XP entre clanes -- decisión explícita: sin ese sistema no
-- tiene sentido mantener una moneda de XP viva).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Baja del sistema de XP/niveles/apuestas (migraciones 013 y 014).
--    avanzar_ganador() se redefine primero (sin las llamadas a
--    otorgar_xp_participante()) para que no quede nunca, ni por un
--    instante, referenciando algo que se está por borrar.
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

  -- Registro de actividad (migración 020): solo en partidas reales, con
  -- los dos participantes presentes -- un bye no se jugó. Reemplaza al
  -- reparto de XP que hacía este mismo punto antes; todavía no hay
  -- ajuste de MMR por resultado (eso es la fase de Clan Wars), pero la
  -- actividad sí se registra desde ya, para que la restauración de
  -- banca rota (30 días sin participar) funcione desde el principio.
  if v_match.participant1_id is not null and v_match.participant2_id is not null then
    perform public.registrar_actividad_participante(v_match.participant1_id);
    perform public.registrar_actividad_participante(v_match.participant2_id);
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

-- registrar_actividad_participante() se crea recién más abajo (punto
-- 4), pero Postgres no valida referencias a otras funciones dentro de
-- un cuerpo plpgsql hasta que se ejecuta -- mismo patrón que ya usa
-- generar_llave() al llamar a avanzar_ganador() antes de que esté
-- definida en el archivo.

drop function if exists public.resolver_disputa_apuesta(uuid, uuid);
drop function if exists public.reportar_resultado_apuesta(uuid, uuid);
drop function if exists public.resolver_apuesta_interno(uuid, uuid);
drop function if exists public.responder_apuesta(uuid, boolean);
drop function if exists public.proponer_apuesta(uuid, int);
drop table if exists public.team_xp_wagers;

drop function if exists public.otorgar_xp_participante(uuid, int, text);
drop table if exists public.team_xp_log;

-- nivel dependía de xp (columna GENERATED) -- hay que sacar nivel
-- antes de poder sacar xp.
alter table public.profiles drop column if exists nivel;
alter table public.profiles drop column if exists xp;
alter table public.teams drop column if exists nivel;
alter table public.teams drop column if exists xp;

drop function if exists public.calcular_nivel_clan(int);
drop function if exists public.calcular_nivel_jugador(int);
drop function if exists public.xp_perdedor_partida();
drop function if exists public.xp_ganador_partida();

-- ------------------------------------------------------------
-- 2) Tabla de ligas oficiales de StarCraft II -- fija, no calculada,
--    tal como está definida oficialmente. mmr < 1000 (el rango entre
--    el piso absoluto de 500 y el arranque de Bronce 3) no es una
--    liga real: se trata directamente como 'Banca Rota'.
-- ------------------------------------------------------------
create or replace function public.calcular_liga(p_mmr integer)
returns text
language sql
immutable
as $$
  select case
    when p_mmr < 1000 then 'Banca Rota'
    when p_mmr <= 1200 then 'Bronce 3'
    when p_mmr <= 1440 then 'Bronce 2'
    when p_mmr <= 1680 then 'Bronce 1'
    when p_mmr <= 1880 then 'Plata 3'
    when p_mmr <= 2080 then 'Plata 2'
    when p_mmr <= 2280 then 'Plata 1'
    when p_mmr <= 2427 then 'Oro 3'
    when p_mmr <= 2573 then 'Oro 2'
    when p_mmr <= 2720 then 'Oro 1'
    when p_mmr <= 2853 then 'Platino 3'
    when p_mmr <= 2987 then 'Platino 2'
    when p_mmr <= 3120 then 'Platino 1'
    when p_mmr <= 3493 then 'Diamante 3'
    when p_mmr <= 3867 then 'Diamante 2'
    when p_mmr <= 4240 then 'Diamante 1'
    when p_mmr <= 4480 then 'Maestro 3'
    when p_mmr <= 4720 then 'Maestro 2'
    when p_mmr <= 4960 then 'Maestro 1'
    else 'Gran Maestro'
  end;
$$;

-- ------------------------------------------------------------
-- 3) Nivel 1-100 derivado del MMR -- solo tiene sentido para 1v1 por
--    ahora (el de equipos se define en otra fase). Relación lineal
--    exacta: nivel 1 = 1000 MMR, nivel 100 = 4961 MMR o más. Por
--    debajo de 1000 (banca rota) queda fijo en nivel 1, no negativo.
-- ------------------------------------------------------------
create or replace function public.calcular_nivel(p_mmr integer)
returns integer
language sql
immutable
as $$
  select greatest(1, least(100,
    round(1 + (p_mmr - 1000)::numeric / (4961 - 1000) * 99)
  ))::int;
$$;

-- ------------------------------------------------------------
-- 4) Columnas de MMR. mmr_1v1 y mmr_equipos son del jugador (cada uno
--    por separado -- el rating de un jugador en 1v1 no tiene por qué
--    ser el mismo que su rating jugando en equipo); teams.mmr es del
--    clan como unidad, nace en 1441 (Bronce 1), no en 1000. Los tres
--    tienen un piso absoluto de 500 -- nunca pueden bajar de ahí (acá
--    todavía no hay ningún mecanismo que reste MMR, eso llega en la
--    fase de Clan Wars, pero el piso queda listo desde ahora).
--
--    banca_rota, nivel_1v1, liga_1v1 y liga_equipos son GENERATED:
--    igual que nivel dependía de xp antes, ahora dependen del mmr
--    correspondiente y Postgres los recalcula solo -- nunca pueden
--    desincronizarse ni escribirse a mano.
-- ------------------------------------------------------------
alter table public.profiles add column mmr_1v1 integer not null default 1000 check (mmr_1v1 >= 500);
alter table public.profiles add column mmr_equipos integer not null default 1000 check (mmr_equipos >= 500);
-- Último momento en que este jugador participó en algo (se inscribió,
-- confirmó asistencia, o jugó una partida real) -- uso interno nada
-- más, para la restauración de banca rota (punto 5). No es pública:
-- no se agrega a la lista de columnas de SELECT de más abajo.
alter table public.profiles add column ultima_actividad timestamptz not null default now();

alter table public.profiles add column banca_rota boolean
  generated always as (mmr_1v1 <= 500 or mmr_equipos <= 500) stored;
alter table public.profiles add column nivel_1v1 integer
  generated always as (public.calcular_nivel(mmr_1v1)) stored;
alter table public.profiles add column liga_1v1 text
  generated always as (public.calcular_liga(mmr_1v1)) stored;
alter table public.profiles add column liga_equipos text
  generated always as (public.calcular_liga(mmr_equipos)) stored;

alter table public.teams add column mmr integer not null default 1441 check (mmr >= 500);
alter table public.teams add column ultima_actividad timestamptz not null default now();
alter table public.teams add column banca_rota boolean generated always as (mmr <= 500) stored;
alter table public.teams add column liga text generated always as (public.calcular_liga(mmr)) stored;

-- ------------------------------------------------------------
-- 5) Registro de actividad y restauración de banca rota.
--
--    Mecanismo elegido para "cada 30 días": NO un cron de Supabase
--    (pg_cron) -- requiere que esa extensión esté habilitada en el
--    proyecto, algo que no puedo verificar ni activar yo mismo desde
--    acá, y si no lo está, esta migración entera fallaría al
--    correrla. En su lugar, restaurar_banca_rota_perfil() /
--    _equipo() se llaman desde el frontend cada vez que alguien entra
--    a su perfil o a la página de su equipo (mismo patrón "se evalúa
--    al toque" que ya usa, por ejemplo, esta_suspendido()) -- no hace
--    falta ninguna configuración adicional en Supabase, funciona
--    igual en cualquier plan.
-- ------------------------------------------------------------
create or replace function public.registrar_actividad_participante(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
begin
  select user_id, team_id into v_participante
  from public.tournament_participants
  where id = p_participant_id;

  if v_participante.user_id is not null then
    update public.profiles set ultima_actividad = now() where id = v_participante.user_id;
  elsif v_participante.team_id is not null then
    update public.teams set ultima_actividad = now() where id = v_participante.team_id;
    update public.profiles set ultima_actividad = now()
      where id in (select user_id from public.team_members where team_id = v_participante.team_id);
  end if;
end;
$$;

create or replace function public.registrar_actividad_tras_inscripcion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.registrar_actividad_participante(new.id);
  return new;
end;
$$;

create trigger after_insert_participant_actividad
  after insert on public.tournament_participants
  for each row execute function public.registrar_actividad_tras_inscripcion();

-- confirmar_asistencia() (migración 010) también cuenta como
-- actividad -- se extiende (no se duplica) para registrar esto justo
-- después de confirmar.
create or replace function public.confirmar_asistencia(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
begin
  select * into v_participante
  from public.tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Ese participante no existe.';
  end if;

  if not public.es_dueno_del_participante(p_participant_id) then
    raise exception 'No tienes permiso para confirmar esta inscripción.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id;

  if not v_torneo.check_in_abierto then
    raise exception 'El check-in no está abierto para este torneo.';
  end if;

  update public.tournament_participants
    set checked_in = true, checked_in_at = now()
    where id = p_participant_id;

  perform public.registrar_actividad_participante(p_participant_id);
end;
$$;

grant execute on function public.confirmar_asistencia(uuid) to authenticated;

-- Si pasaron 30 días corridos sin actividad y sigue en banca rota,
-- vuelve a 1000 MMR (Bronce 3) -- fresco, no al punto de partida
-- original (los 1441 de un clan nuevo), es una restauración desde el
-- fondo de la tabla, no un perdón completo. banca_rota es GENERATED,
-- así que la bandera se apaga sola en el mismo UPDATE, sin un paso
-- aparte para "sacarla".
create or replace function public.restaurar_banca_rota_perfil(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    mmr_1v1 = case when mmr_1v1 <= 500 then 1000 else mmr_1v1 end,
    mmr_equipos = case when mmr_equipos <= 500 then 1000 else mmr_equipos end
  where id = p_user_id
    and (mmr_1v1 <= 500 or mmr_equipos <= 500)
    and ultima_actividad <= now() - interval '30 days';
end;
$$;

grant execute on function public.restaurar_banca_rota_perfil(uuid) to authenticated;

create or replace function public.restaurar_banca_rota_equipo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.teams
  set mmr = 1000
  where id = p_team_id
    and mmr <= 500
    and ultima_actividad <= now() - interval '30 days';
end;
$$;

grant execute on function public.restaurar_banca_rota_equipo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6) profiles: la lista explícita de columnas de SELECT (migración
--    017) tiene que actualizarse -- sale xp/nivel, entran las
--    columnas nuevas (menos ultima_actividad, que queda interna).
-- ------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, nombre, perfil_tipo, es_admin, es_caster, nick, unique_id,
  country, sc2_region, sc2_id, liga, avatar_url, bio,
  cuenta_validada, suspendido, creado_en,
  mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos
) on public.profiles to anon, authenticated;
