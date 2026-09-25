-- ------------------------------------------------------------
-- Migración 103: control remoto de OBS vía obs-websocket (protocolo
-- v5, incluido gratis en OBS 28+ -- Herramientas > WebSocket Server
-- Settings). Distinto del overlay para OBS que ya existe (migración
-- 044: páginas públicas de solo lectura pensadas como "Fuente de
-- navegador") -- acá el propio RemorApp, corriendo en el navegador del
-- caster, abre una conexión WebSocket hacia SU OBS local y le cambia
-- la escena sola cuando cambia el estado de una Clan War.
--
-- La contraseña de OBS es lo único sensible de toda esta migración:
-- queda cifrada con pgcrypto (pgp_sym_encrypt/pgp_sym_decrypt) usando
-- una clave simétrica guardada en Supabase Vault (vault.secrets --
-- cifrado en reposo con la clave raíz de la plataforma, no legible ni
-- siquiera por una consulta SQL común), y la columna nunca tiene
-- grant de SELECT para nadie: la única forma de leerla (ya
-- descifrada) es obtener_config_obs(), que devuelve exclusivamente la
-- fila de quien la llama (auth.uid()) -- ni un administrador puede
-- leer la contraseña de otro caster desde acá.
-- ------------------------------------------------------------

create extension if not exists supabase_vault;

alter table public.profiles
  add column obs_websocket_url text,
  -- Cifrada -- ver _clave_cifrado_obs()/guardar_config_obs()/
  -- obtener_config_obs() más abajo. Nunca se le da grant de select a
  -- nadie (ni siquiera al propio dueño): a propósito, para que la
  -- única puerta de lectura sea la RPC de auth.uid().
  add column obs_websocket_password text,
  add column obs_escena_bracket text,
  add column obs_escena_en_vivo text;

-- La url y los nombres de escena no son secretos (son iguales a los
-- que cualquiera vería mirando por encima del hombro al caster
-- transmitiendo) -- se puede leer la propia fila igual que el resto
-- de los datos de transmisión.
grant select (obs_websocket_url, obs_escena_bracket, obs_escena_en_vivo) on public.profiles to authenticated;

-- Se genera una única clave simétrica para todo el proyecto la
-- primera vez que corre esta migración -- si ya existiera (por correr
-- esto dos veces), no se pisa.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'obs_websocket_encryption_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'obs_websocket_encryption_key',
      'Clave simétrica para cifrar/descifrar profiles.obs_websocket_password (migración 103).'
    );
  end if;
end $$;

-- Función interna -- nunca se le da grant de execute a nadie. Solo la
-- llaman, desde dentro, las dos funciones de más abajo (al ser
-- security definer, se ejecutan como el dueño de la función, que
-- siempre puede leer vault.decrypted_secrets aunque authenticated no
-- tenga ningún permiso sobre esa vista).
create function public._clave_cifrado_obs()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_clave text;
begin
  select decrypted_secret into v_clave
  from vault.decrypted_secrets
  where name = 'obs_websocket_encryption_key';

  if v_clave is null then
    raise exception 'No se encontró la clave de cifrado de OBS -- contactar a un administrador.';
  end if;

  return v_clave;
end;
$$;

-- Explícito a propósito, sin confiar en que este proyecto ya tenga
-- revocado el execute default de PUBLIC sobre funciones nuevas: esta
-- función devuelve la clave maestra de cifrado en texto plano, así
-- que además del hecho de no tener ningún "grant execute" para
-- authenticated/anon, se le saca el privilegio por defecto también.
revoke all on function public._clave_cifrado_obs() from public;

-- p_password en null o '' significa "no cambiar la contraseña ya
-- guardada" -- el formulario nunca vuelve a mostrar la contraseña
-- real, así que reenviar el formulario sin tocar ese campo no debe
-- borrarla. borrar_config_obs() de más abajo es la única forma de
-- limpiarla de verdad.
create function public.guardar_config_obs(
  p_url text,
  p_password text,
  p_escena_bracket text,
  p_escena_en_vivo text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if p_password is not null and p_password <> '' then
    update public.profiles
    set
      obs_websocket_url = p_url,
      obs_websocket_password = encode(pgp_sym_encrypt(p_password, public._clave_cifrado_obs()), 'base64'),
      obs_escena_bracket = p_escena_bracket,
      obs_escena_en_vivo = p_escena_en_vivo
    where id = auth.uid();
  else
    update public.profiles
    set
      obs_websocket_url = p_url,
      obs_escena_bracket = p_escena_bracket,
      obs_escena_en_vivo = p_escena_en_vivo
    where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.guardar_config_obs(text, text, text, text) to authenticated;

create function public.borrar_config_obs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    obs_websocket_url = null,
    obs_websocket_password = null,
    obs_escena_bracket = null,
    obs_escena_en_vivo = null
  where id = auth.uid();
end;
$$;

grant execute on function public.borrar_config_obs() to authenticated;

-- Devuelve la config de OBS de quien llama, con la contraseña ya
-- descifrada -- es la única función de toda la base que entrega esa
-- contraseña en texto plano, y solo puede devolver la propia
-- (auth.uid() está fijo adentro, no es un parámetro).
create function public.obtener_config_obs()
returns table (
  obs_websocket_url text,
  obs_websocket_password text,
  obs_escena_bracket text,
  obs_escena_en_vivo text
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_password_cifrada text;
begin
  select p.obs_websocket_url, p.obs_websocket_password, p.obs_escena_bracket, p.obs_escena_en_vivo
  into obs_websocket_url, v_password_cifrada, obs_escena_bracket, obs_escena_en_vivo
  from public.profiles p
  where p.id = auth.uid();

  if v_password_cifrada is not null then
    obs_websocket_password := pgp_sym_decrypt(decode(v_password_cifrada, 'base64'), public._clave_cifrado_obs());
  end if;

  return next;
end;
$$;

grant execute on function public.obtener_config_obs() to authenticated;

-- ------------------------------------------------------------
-- Tiempo real para disparar el cambio de escena: el navegador del
-- caster necesita enterarse de los cambios de clan_wars (y de sus
-- partidas individuales) sin recargar la página, igual que
-- guerra_razas (migración 102).
--
-- "replica identity full" en clan_wars es necesario para poder
-- distinguir una transición real de estado (por ejemplo, de
-- 'aceptada' a 'en_curso') del resto de los campos que cambian todo
-- el tiempo en la misma fila (visto bueno del lineup, confirmaciones,
-- etc.) -- sin esto, el payload de Realtime no trae el valor ANTERIOR
-- de la fila, y el navegador no podría saber si el estado realmente
-- cambió o si fue otra columna la que se actualizó.
--
-- Nota de alcance: clan_wars_select_propio (más arriba) solo deja ver
-- la fila al capitán o dueño de alguno de los dos equipos -- un
-- jugador raso del equipo, sin ese rol, no recibe el cambio en tiempo
-- real (la RLS de Realtime es la misma que la de una consulta normal),
-- así que en la práctica esta función solo sirve para un caster que
-- además sea capitán o dueño de su propio equipo.
-- ------------------------------------------------------------
alter table public.clan_wars replica identity full;

alter publication supabase_realtime add table public.clan_wars;
alter publication supabase_realtime add table public.clan_war_matches;
alter publication supabase_realtime add table public.clan_war_wtl_sets;
