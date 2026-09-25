-- ------------------------------------------------------------
-- Migración 107: separar "cuenta válida" de los datos específicos de
-- StarCraft II. RemorApp es agnóstica a cualquier juego, pero hasta
-- ahora cuenta_validada (y por lo tanto crear un torneo o un equipo, o
-- pedir unirse a uno) exigía país, sc2_region y sc2_id además del
-- nick -- eso bloqueaba a cualquiera que no juegue StarCraft II (y de
-- paso, a cualquiera que no quisiera compartir su país). De ahora en
-- más, cuenta_validada solo exige el nick. País, servidor de SC2, ID
-- de SC2, raza y liga quedan totalmente opcionales -- ya eran columnas
-- nullable (sus check constraints ya decían "is null or..."); el
-- único lugar que en los hechos las volvía obligatorias era este
-- trigger, no un constraint de columna.
-- ------------------------------------------------------------

create or replace function public.actualizar_cuenta_validada()
returns trigger
language plpgsql
as $$
begin
  new.cuenta_validada := (new.nick is not null);
  return new;
end;
$$;

-- Mismo cuerpo de siempre (migración 095), solo se actualiza el
-- mensaje de error para no seguir pidiendo país/servidor/ID de SC2.
create or replace function public.validar_creador_torneo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cuenta_validada_ok() then
    raise exception 'Necesitas completar tu perfil (el nick) antes de crear un torneo.';
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

-- Mismo cuerpo de siempre (migración 104), solo se actualiza el
-- mensaje de error.
create or replace function public.solicitar_union_equipo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  if not public.cuenta_validada_ok() then
    raise exception 'Tu cuenta todavía no está validada -- completa el nick en tu perfil.';
  end if;

  if not exists (select 1 from public.teams where id = p_team_id and not disuelto) then
    raise exception 'Ese equipo no existe.';
  end if;

  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a un equipo.';
  end if;

  if exists (
    select 1 from public.team_join_requests
    where team_id = p_team_id and solicitante_id = auth.uid() and status = 'pendiente'
  ) then
    raise exception 'Ya tienes una solicitud pendiente para este equipo.';
  end if;

  insert into public.team_join_requests (team_id, solicitante_id)
  values (p_team_id, auth.uid());
end;
$$;

-- Registro más directo: RegisterPage ahora pide el nick en el mismo
-- formulario inicial (validado del lado del cliente con las mismas
-- reglas de siempre -- 3 a 13 caracteres, sin espacios, filtro de
-- lenguaje) y lo manda en el metadata del signUp, igual que ya se
-- hacía con "nombre". Mismo cuerpo de siempre (migración 062), solo se
-- suma la columna nick al insert -- el check constraint de formato de
-- profiles.nick (migración 011) sigue siendo la barrera real si algo
-- llegara a saltarse la validación del cliente: como handle_new_user
-- corre AFTER INSERT on auth.users, esa violación revierte la
-- transacción completa (no queda una cuenta a medio crear).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_id text;
begin
  if exists (select 1 from public.correos_bloqueados where correo = new.email) then
    raise exception 'Este correo no puede registrarse.';
  end if;

  loop
    v_unique_id := (floor(random() * 90000) + 10000)::int::text;
    exit when not exists (select 1 from public.profiles where unique_id = v_unique_id);
  end loop;

  insert into public.profiles (id, nombre, nick, unique_id, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'nick',
    v_unique_id,
    new.email
  );
  return new;
end;
$$;

-- Recalcula cuenta_validada para los perfiles que ya existen -- el
-- trigger de arriba solo corre en el próximo insert/update de cada
-- fila, así que sin este backfill alguien que ya tiene nick cargado
-- (pero nunca completó país ni los datos de SC2) seguiría bloqueado
-- hasta que volviera a guardar su perfil por cualquier otro motivo.
-- "set nick = nick" no cambia ningún dato real, solo dispara el
-- trigger before_upsert_profiles_validar_cuenta para que recalcule la
-- columna con la lógica nueva.
update public.profiles
set nick = nick
where nick is not null and not cuenta_validada;
