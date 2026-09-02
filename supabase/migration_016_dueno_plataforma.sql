-- ============================================================
-- Migración 016: privilegio del dueño de la plataforma.
--
-- Distinto de es_admin -- es un privilegio para UNA cuenta específica
-- (la tuya), no para el staff en general. Ningún otro administrador
-- tiene esto ni puede verlo.
--
--   1) es_dueno_plataforma en profiles: mismo mecanismo de protección
--      que es_admin (se extiende el mismo trigger, no se duplica) --
--      solo se activa a mano en el SQL Editor, nunca desde la app.
--      Además, a diferencia de es_admin, esta columna queda con la
--      LECTURA revocada para todos (mismo patrón que profiles.email):
--      nadie puede leerla con un select común, ni siquiera otro
--      admin -- la única forma de consultarla es la función
--      es_dueno_plataforma(), que solo contesta sobre uno mismo.
--   2) Ese mismo trigger bloquea además que alguien (incluido otro
--      admin) te suspenda/banee desde la app -- "no se puede
--      investigar ni banear" para tu cuenta específicamente.
--   3) dueno_actividad_log: no es "sin registro", es "registro
--      privado" -- una tabla que solo vos podés leer (RLS exige
--      es_dueno_plataforma() = true), invisible para todo el resto
--      del staff. registrar_actividad_dueno() es la única puerta
--      para escribir ahí, y ya queda enganchada en resolver_disputa()
--      y resolver_disputa_apuesta() -- se registra solo cuando quien
--      resuelve sos vos, nunca cuando resuelve otro admin.
--
-- "Invisibilidad al mirar" (punto 2 de tu pedido) y el futuro botón
-- "Investigar jugador" (punto 3) no tienen código que tocar todavía
-- -- no existe ningún sistema de "vio tu perfil" ni de investigación
-- de jugadores hoy en la app. Lo que sí queda listo es
-- es_dueno_plataforma(): cuando se construya cualquiera de las dos
-- cosas, esa función es la que hay que llamar para excluirte /
-- bloquear la acción contra tu cuenta -- ver el comentario largo más
-- abajo, junto a esa función.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columna nueva + protección.
-- ------------------------------------------------------------
alter table public.profiles add column es_dueno_plataforma boolean not null default false;

-- Nadie puede leer esta columna con un select común -- ni siquiera
-- otro admin. Mismo patrón que profiles.email: la única forma de
-- consultarla es la función es_dueno_plataforma() de más abajo, que
-- solo contesta "¿el que está preguntando es el dueño?", nunca expone
-- la columna en sí para otra fila que no sea la propia.
revoke select (es_dueno_plataforma) on public.profiles from anon, authenticated;

-- Se extiende proteger_es_admin() (no se duplica): mismo mecanismo
-- exacto que ya protegía es_admin -- current_setting('request.jwt.claims')
-- solo existe cuando la consulta llega por la API de Supabase, así
-- que esto bloquea cambios desde la app pero no interfiere con
-- activarlo a mano acá en el SQL Editor.
--
-- Además, mientras estamos acá: si la fila que se está editando
-- pertenece al dueño de la plataforma (old.es_dueno_plataforma),
-- bloquea también que la app la suspenda/banee -- ni siquiera otro
-- administrador puede hacerlo desde /admin. La única forma de
-- suspender esa cuenta específica sería, otra vez, directo en el SQL
-- Editor.
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;

    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2) es_dueno_plataforma(): igual que is_admin(), pero para este
--    privilegio aparte. Es la única forma de consultar el privilegio
--    desde afuera de la base -- nunca se expone la columna cruda.
--
--    PREPARADO PARA MÁS ADELANTE -- cuando se construya:
--      - Cualquier tipo de "fulano vio tu perfil/equipo" o notificación
--        de visita: antes de generar el registro o la notificación,
--        chequear "if public.es_dueno_plataforma() then return; end if;"
--        (o el equivalente en esa función) para que una visita del
--        dueño de la plataforma nunca quede registrada ni notifique a
--        nadie.
--      - El botón "Investigar jugador": la función que lo respalde
--        tiene que empezar rechazando el intento si el PERFIL
--        INVESTIGADO tiene es_dueno_plataforma = true, sin importar
--        quién esté llamando (ni siquiera otro admin puede usarlo
--        contra esta cuenta) -- algo como:
--          if exists (select 1 from public.profiles where id = p_investigado and es_dueno_plataforma) then
--            raise exception 'No se puede investigar esta cuenta.';
--          end if;
--        al principio de esa función, antes de cualquier otra lógica.
-- ------------------------------------------------------------
create or replace function public.es_dueno_plataforma()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select es_dueno_plataforma from public.profiles where id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- 3) dueno_actividad_log: registro PRIVADO (no ausencia de registro)
--    de las acciones sensibles que hace el dueño de la plataforma.
--    RLS exige es_dueno_plataforma() = true para leer -- invisible
--    para todo el resto del staff, incluidos otros administradores.
-- ------------------------------------------------------------
create table public.dueno_actividad_log (
  id uuid primary key default gen_random_uuid(),
  accion text not null,
  detalle text,
  created_at timestamptz not null default now()
);

alter table public.dueno_actividad_log enable row level security;

create policy "dueno_actividad_log_select_propio"
  on public.dueno_actividad_log for select
  to authenticated
  using (public.es_dueno_plataforma());

grant select on public.dueno_actividad_log to authenticated;

-- Única puerta de escritura -- ni siquiera el propio dueño inserta
-- acá con un insert directo desde la app, y por supuesto no hay
-- política INSERT para nadie más.
create or replace function public.registrar_actividad_dueno(p_accion text, p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Solo el dueño de la plataforma puede registrar esto.';
  end if;

  insert into public.dueno_actividad_log (accion, detalle)
  values (p_accion, p_detalle);
end;
$$;

grant execute on function public.registrar_actividad_dueno(text, text) to authenticated;

-- ------------------------------------------------------------
-- 4) Enganchar el registro en las dos acciones "revisar una disputa"
--    que ya existen -- solo se registra cuando quien resuelve es el
--    dueño de la plataforma; para cualquier otro admin, estas mismas
--    funciones siguen exactamente igual, sin dejar ningún rastro acá.
-- ------------------------------------------------------------
create or replace function public.resolver_disputa(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver una disputa.';
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id for update;

  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'en_disputa' then
    raise exception 'Esta partida no está en disputa.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  update public.bracket_matches
    set winner_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;

  perform public.avanzar_ganador(p_match_id);

  if public.es_dueno_plataforma() then
    perform public.registrar_actividad_dueno(
      'resolver_disputa',
      'match_id=' || p_match_id::text || ' ganador=' || p_ganador_id::text
    );
  end if;
end;
$$;

create or replace function public.resolver_disputa_apuesta(p_wager_id uuid, p_ganador_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apuesta record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver una disputa de apuesta.';
  end if;

  select * into v_apuesta from public.team_xp_wagers where id = p_wager_id for update;

  if v_apuesta is null then
    raise exception 'Esa apuesta no existe.';
  end if;
  if v_apuesta.status <> 'en_disputa' then
    raise exception 'Esta apuesta no está en disputa.';
  end if;
  if p_ganador_team_id <> v_apuesta.challenger_team_id and p_ganador_team_id <> v_apuesta.challenged_team_id then
    raise exception 'Ese equipo no participa en esta apuesta.';
  end if;

  perform public.resolver_apuesta_interno(p_wager_id, p_ganador_team_id);

  if public.es_dueno_plataforma() then
    perform public.registrar_actividad_dueno(
      'resolver_disputa_apuesta',
      'wager_id=' || p_wager_id::text || ' ganador_team_id=' || p_ganador_team_id::text
    );
  end if;
end;
$$;

-- ============================================================
-- Corre esto aparte, cambiando el correo por el tuyo, para activarte
-- a vos mismo como dueño de la plataforma (igual que ya activaste
-- es_admin en su momento):
--
--   update public.profiles set es_dueno_plataforma = true
--   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
-- ============================================================
