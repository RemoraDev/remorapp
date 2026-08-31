-- ============================================================
-- Migración 003: identidad de jugador en profiles
-- (Fase 1 del módulo de Equipos/Clanes — sin nada de equipos
-- todavía, solo perfil de jugador).
--
-- profiles YA TIENE datos reales (incluida tu cuenta). Esta
-- migración agrega columnas a una tabla existente, rellena las
-- filas actuales con valores válidos, y recién después aplica
-- las restricciones (UNIQUE, formato, etc.) — en ese orden, para
-- no romper ninguna fila que ya exista.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Agregar las columnas nuevas, todas sin restricciones
--    todavía (se agregan después del backfill).
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists nick text,
  add column if not exists unique_id text,
  add column if not exists country text,
  add column if not exists sc2_region text,
  add column if not exists sc2_id text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  -- cuenta_validada tampoco existía: se agrega acá también. Es un
  -- valor calculado (ver el trigger más abajo), no algo que la app
  -- deba mandar a mano.
  add column if not exists cuenta_validada boolean not null default false;

-- ------------------------------------------------------------
-- 2) Backfill de unique_id para las filas que ya existen: un
--    random de 5 dígitos (10000-99999) por cuenta, verificando
--    uno por uno que no se repita con ninguno ya asignado (acá
--    o en una vuelta anterior del mismo loop).
-- ------------------------------------------------------------
do $$
declare
  fila record;
  candidato text;
begin
  for fila in select id from public.profiles where unique_id is null loop
    loop
      candidato := (floor(random() * 90000) + 10000)::int::text;
      exit when not exists (select 1 from public.profiles where unique_id = candidato);
    end loop;
    update public.profiles set unique_id = candidato where id = fila.id;
  end loop;
end $$;

-- Ahora que todas las filas tienen uno, recién acá se puede exigir
-- que sea único y obligatorio.
alter table public.profiles
  alter column unique_id set not null,
  add constraint profiles_unique_id_key unique (unique_id);

-- ------------------------------------------------------------
-- 3) Backfill de nick para las filas que ya existen, a partir del
--    nombre actual: se limpia (solo letras/números/guion bajo,
--    máx. 16) para que ya cumpla el formato antes de agregar el
--    check constraint del paso siguiente. nick puede quedar null
--    para cuentas nuevas: se completa recién en el gate de /perfil,
--    no al registrarse.
-- ------------------------------------------------------------
update public.profiles
set nick = nullif(substring(regexp_replace(coalesce(nombre, ''), '[^A-Za-z0-9_]', '', 'g') from 1 for 16), '')
where nick is null;

-- Si el nombre no tenía ningún caracter válido (o quedó muy corto
-- tras limpiarlo), se arma un nick de respaldo con el unique_id
-- recién asignado, que ya es único.
update public.profiles
set nick = 'Jugador' || unique_id
where nick is null or length(nick) < 3;

-- Formato del nick (mismo regex que valida el frontend en
-- src/lib/nickValidation.ts): 3-16 caracteres, solo letras,
-- números y guion bajo. Puede ser null (todavía sin completar).
alter table public.profiles
  add constraint profiles_nick_formato check (nick is null or nick ~ '^[A-Za-z0-9_]{3,16}$');

-- ------------------------------------------------------------
-- 4) country y sc2_region: nullable (se completan en el gate de
--    /perfil), pero ya con su check constraint de valores válidos.
--    country es el país del jugador (no el servidor de juego);
--    sc2_region es el servidor real de StarCraft II al que se
--    conecta, elegido libremente por el jugador, no detectado.
-- ------------------------------------------------------------
alter table public.profiles
  add constraint profiles_country_valido
    check (country is null or country in ('chile', 'guatemala', 'puerto_rico', 'argentina', 'peru', 'bolivia')),
  add constraint profiles_sc2_region_valido
    check (sc2_region is null or sc2_region in ('america', 'europe', 'asia'));

-- ------------------------------------------------------------
-- 5) cuenta_validada se recalcula sola en cada insert/update, a
--    partir de si nick, country, sc2_region y sc2_id están
--    completos. La app nunca necesita (ni puede) setearla a mano:
--    alcanza con guardar esos 4 campos.
-- ------------------------------------------------------------
create or replace function public.actualizar_cuenta_validada()
returns trigger
language plpgsql
as $$
begin
  new.cuenta_validada := (
    new.nick is not null
    and new.country is not null
    and new.sc2_region is not null
    and new.sc2_id is not null
  );
  return new;
end;
$$;

drop trigger if exists before_upsert_profiles_validar_cuenta on public.profiles;
create trigger before_upsert_profiles_validar_cuenta
  before insert or update on public.profiles
  for each row execute function public.actualizar_cuenta_validada();

-- Aplica el cálculo también a las filas existentes (por si alguna
-- ya tenía los 4 campos completos, aunque hoy no debería pasar,
-- ya que country/sc2_region/sc2_id recién se agregaron arriba).
update public.profiles
set cuenta_validada = (
  nick is not null and country is not null and sc2_region is not null and sc2_id is not null
);

-- ------------------------------------------------------------
-- 6) unique_id es inmutable: una vez asignado, ningún UPDATE
--    (de la app ni del SQL Editor) puede volver a generarlo o
--    cambiarlo.
-- ------------------------------------------------------------
create or replace function public.proteger_unique_id()
returns trigger
language plpgsql
as $$
begin
  if old.unique_id is not null then
    new.unique_id := old.unique_id;
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_profiles_proteger_unique_id on public.profiles;
create trigger before_update_profiles_proteger_unique_id
  before update on public.profiles
  for each row execute function public.proteger_unique_id();

-- ------------------------------------------------------------
-- 7) A partir de ahora, cada cuenta nueva también recibe su
--    unique_id (único, 5 dígitos) apenas se registra. nick sigue
--    quedando null hasta que lo complete en el gate de /perfil.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_id text;
begin
  loop
    v_unique_id := (floor(random() * 90000) + 10000)::int::text;
    exit when not exists (select 1 from public.profiles where unique_id = v_unique_id);
  end loop;

  insert into public.profiles (id, nombre, perfil_tipo, unique_id)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'perfil_tipo',
    v_unique_id
  );
  return new;
end;
$$;

-- No hace falta volver a crear el trigger on_auth_user_created: ya
-- apunta a esta función por nombre, y create or replace le cambia
-- el comportamiento sin tocar el trigger en sí.
