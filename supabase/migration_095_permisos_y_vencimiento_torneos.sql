-- ------------------------------------------------------------
-- Migración 095: permisos de creación de torneos/ligas según el
-- formato, límite de anticipación de 60 días (con extensión por un
-- administrador), y vencimiento automático de torneos sin actividad.
--
-- 1) Permisos de creación: un torneo formato '1v1' solo exige cuenta
--    validada; cualquier otro formato (2v2/3v3/4v4/wtl -- siempre
--    involucra clanes, First Stand incluido, que se apoya en un
--    formato de equipo) exige además ser caster, dueño/capitán de
--    algún equipo, staff, admin, o dueño de la plataforma. Se valida
--    con un trigger BEFORE INSERT (mismo patrón que
--    validar_fecha_inicio_torneo()), con mensajes claros -- así queda
--    bloqueado a nivel de base, no solo escondiendo el botón en la
--    app.
-- 2) Límite de 60 días: se extiende validar_fecha_inicio_torneo()
--    (antes solo rechazaba fechas pasadas) para que también rechace
--    una fecha de inicio a más de 60 días de anticipación -- y el
--    trigger pasa a correr también en UPDATE de fecha_inicio (antes
--    solo en INSERT), porque si no alcanzaba con crear el torneo con
--    una fecha válida y después moverla con un update común, sin
--    pasar nunca por esta validación. admin_extender_plazo_torneo()
--    es la única forma de saltarse ese límite para un torneo puntual,
--    dejando registrado quién lo autorizó y cuándo.
-- 3) Vencimiento automático: evaluar_vencimiento_torneo(), evaluada al
--    cargar la ficha del torneo (mismo patrón que
--    restaurar_banca_rota_equipo(), sin cron) -- a los 30 días de la
--    fecha de inicio programada sin ningún partido jugado (grupos,
--    bracket, o Clan War asociada), el torneo queda marcado como
--    "candidato a eliminación"; si pasan 7 días más sin actividad, se
--    borra de forma permanente (las tablas satélite ya cascadean
--    limpio desde tournaments, confirmado en admin_eliminar_torneo()).
--    reactivar_torneo_candidato() le da al organizador (o a un
--    administrador) la oportunidad de sacarlo de "candidato" antes de
--    que se borre, con un reinicio real del plazo de 30 días (no
--    alcanza con solo borrar la marca: si no, quedaría marcado de
--    nuevo apenas se lo vuelva a evaluar).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1) Permisos de creación según formato.
-- ------------------------------------------------------------

-- cuenta_validada_ok(): mismo patrón exacto que esta_suspendido().
create or replace function public.cuenta_validada_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select cuenta_validada from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.cuenta_validada_ok() to authenticated;

-- lidera_algun_equipo(): "¿dueño o capitán de AL MENOS UN equipo?" --
-- extraído del mismo chequeo que ya hacía investigar_jugador() en
-- línea, ahora reutilizable como función propia.
create or replace function public.lidera_algun_equipo()
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.teams where owner_id = auth.uid())
    or exists (select 1 from public.team_members where user_id = auth.uid() and es_capitan);
$$;

grant execute on function public.lidera_algun_equipo() to authenticated;

create or replace function public.validar_creador_torneo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cuenta_validada_ok() then
    raise exception 'Necesitas completar tu perfil (nick, país, servidor y ID de SC2) antes de crear un torneo.';
  end if;

  -- Cualquier formato que no sea 1v1 involucra clanes (2v2/3v3/4v4,
  -- WTL, y First Stand -- que siempre se arma sobre un formato de
  -- equipo, nunca sobre 1v1): exige uno de los roles habilitados.
  if new.formato <> '1v1' then
    if not (
      public.es_dueno_plataforma()
      or public.is_admin()
      or public.es_staff()
      or coalesce((select es_caster from public.profiles where id = auth.uid()), false)
      or public.lidera_algun_equipo()
    ) then
      raise exception 'Para crear un torneo o liga por equipos necesitas ser caster, dueño o capitán de un clan, staff, o administrador.';
    end if;
  end if;

  return new;
end;
$$;

create trigger before_insert_tournaments_valida_creador
  before insert on public.tournaments
  for each row execute function public.validar_creador_torneo();

-- ------------------------------------------------------------
-- 2) Límite de anticipación de 60 días + extensión por un admin.
-- ------------------------------------------------------------

-- validar_fecha_inicio_torneo(): mismo cuerpo de siempre, con el
-- límite de 60 días sumado -- salteable únicamente dentro de la misma
-- transacción de admin_extender_plazo_torneo() (ver el
-- set_config('remorapp.permitir_fecha_extendida', ...) ahí abajo, que
-- es local a la transacción y se apaga solo al terminar).
create or replace function public.validar_fecha_inicio_torneo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Tolerancia de 5 minutos: cubre el tiempo que tarda en llenarse y
  -- mandarse el formulario, y un posible desfase de reloj del
  -- navegador -- no es para permitir fechas pasadas de verdad.
  if new.fecha_inicio < now() - interval '5 minutes' then
    raise exception 'La fecha de inicio no puede ser en el pasado.';
  end if;

  if new.fecha_inicio > now() + interval '60 days'
     and coalesce(current_setting('remorapp.permitir_fecha_extendida', true), 'false') <> 'true'
  then
    raise exception 'La fecha de inicio no puede ser más de 60 días en el futuro. Si necesitas programar con más anticipación, pídele a un administrador que extienda el plazo de este torneo.';
  end if;

  return new;
end;
$$;

-- Antes este trigger solo corría en INSERT -- se recrea para que
-- también corra al editar fecha_inicio de un torneo ya creado, si no
-- el límite de arriba se podía saltar con un update común después de
-- crear el torneo con una fecha válida.
drop trigger if exists before_insert_tournaments_valida_fecha on public.tournaments;
create trigger before_insert_or_update_tournaments_valida_fecha
  before insert or update of fecha_inicio on public.tournaments
  for each row execute function public.validar_fecha_inicio_torneo();

alter table public.tournaments
  add column plazo_extendido_por uuid references public.profiles (id),
  add column plazo_extendido_en timestamptz;

create or replace function public.admin_extender_plazo_torneo(p_tournament_id uuid, p_nueva_fecha_inicio timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.es_dueno_plataforma()) then
    raise exception 'Solo un administrador puede extender el plazo de un torneo.';
  end if;

  if p_nueva_fecha_inicio <= now() then
    raise exception 'La nueva fecha debe ser en el futuro.';
  end if;

  -- Local a esta transacción -- se apaga solo al terminar, ninguna
  -- otra sentencia de esta misma sesión queda con el límite
  -- deshabilitado.
  perform set_config('remorapp.permitir_fecha_extendida', 'true', true);

  update public.tournaments
    set fecha_inicio = p_nueva_fecha_inicio,
        plazo_extendido_por = auth.uid(),
        plazo_extendido_en = now()
    where id = p_tournament_id;

  if not found then
    raise exception 'Ese torneo no existe.';
  end if;
end;
$$;

grant execute on function public.admin_extender_plazo_torneo(uuid, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 3) Vencimiento automático de torneos sin actividad.
-- ------------------------------------------------------------

alter table public.tournaments
  add column candidato_eliminacion_desde timestamptz,
  add column ultima_reactivacion_en timestamptz;

-- evaluar_vencimiento_torneo(): evaluada al cargar la ficha del
-- torneo (mismo patrón que restaurar_banca_rota_equipo(), sin cron).
-- El punto de referencia para contar los 30 días es fecha_inicio, o
-- ultima_reactivacion_en si el organizador ya reactivó el torneo una
-- vez (le da un plazo de 30 días realmente nuevo, no uno que ya
-- estaba vencido desde el vamos).
create or replace function public.evaluar_vencimiento_torneo(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_hay_actividad boolean;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;
  if v_torneo is null or v_torneo.estado = 'finalizado' then
    return;
  end if;

  -- Ya pasaron los 7 días de margen desde que se marcó como
  -- candidato: se borra de forma permanente. Las tablas satélite
  -- (tournament_participants, tournament_groups,
  -- tournament_group_matches, bracket_matches, temporadas,
  -- torneo_invitaciones_equipo, torneo_solicitudes_equipo, etc.) ya
  -- cascadean limpio desde tournaments -- confirmado en
  -- admin_eliminar_torneo(). Las Clan Wars que haya generado el
  -- fixture no se tocan acá: quedan sin torneo dueño (ya no las
  -- referencia ningún tournament_group_matches/bracket_matches), pero
  -- siguen existiendo como Clan Wars propias de los dos clanes.
  if v_torneo.candidato_eliminacion_desde is not null
     and v_torneo.candidato_eliminacion_desde <= now() - interval '7 days'
  then
    delete from public.tournaments where id = p_tournament_id;
    return;
  end if;

  -- Ya está marcado como candidato: nada más que evaluar mientras se
  -- cumplen los 7 días de arriba, o hasta que se reactive.
  if v_torneo.candidato_eliminacion_desde is not null then
    return;
  end if;

  -- Todavía no pasaron los 30 días desde la fecha de referencia.
  if coalesce(v_torneo.ultima_reactivacion_en, v_torneo.fecha_inicio) > now() - interval '30 days' then
    return;
  end if;

  select
    exists (
      select 1
      from public.tournament_group_matches gm
      join public.tournament_groups g on g.id = gm.group_id
      where g.tournament_id = p_tournament_id and gm.status = 'jugado'
    )
    or exists (
      select 1 from public.bracket_matches
      where tournament_id = p_tournament_id and status = 'jugado'
    )
    or exists (
      select 1
      from public.tournament_group_matches gm
      join public.tournament_groups g on g.id = gm.group_id
      join public.clan_wars cw on cw.id = gm.clan_war_id
      where g.tournament_id = p_tournament_id and cw.status in ('en_curso', 'finalizada', 'empatada')
    )
    or exists (
      select 1
      from public.bracket_matches bm
      join public.clan_wars cw on cw.id = bm.clan_war_id
      where bm.tournament_id = p_tournament_id and cw.status in ('en_curso', 'finalizada', 'empatada')
    )
    into v_hay_actividad;

  if not v_hay_actividad then
    update public.tournaments
      set candidato_eliminacion_desde = now()
      where id = p_tournament_id;
  end if;
end;
$$;

grant execute on function public.evaluar_vencimiento_torneo(uuid) to anon, authenticated;

-- reactivar_torneo_candidato(): el organizador (o un administrador)
-- saca al torneo de "candidato a eliminación" -- reinicia el plazo de
-- 30 días de verdad (ultima_reactivacion_en), no solo borra la marca.
create or replace function public.reactivar_torneo_candidato(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;
  if v_torneo is null then
    raise exception 'Ese torneo no existe.';
  end if;

  if v_torneo.creador_id <> auth.uid() and not public.is_admin() and not public.es_dueno_plataforma() then
    raise exception 'Solo el organizador o un administrador puede reactivar este torneo.';
  end if;

  if v_torneo.candidato_eliminacion_desde is null then
    return;
  end if;

  update public.tournaments
    set candidato_eliminacion_desde = null,
        ultima_reactivacion_en = now()
    where id = p_tournament_id;
end;
$$;

grant execute on function public.reactivar_torneo_candidato(uuid) to authenticated;
