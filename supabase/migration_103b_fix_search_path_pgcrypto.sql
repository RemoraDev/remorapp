-- ------------------------------------------------------------
-- Migración 103b: corrige un error real encontrado en la prueba en
-- vivo -- guardar_config_obs() y obtener_config_obs() fallaban con
-- "function pgp_sym_encrypt(text, text) does not exist". pgcrypto
-- queda instalado en el esquema "extensions" en este proyecto (no en
-- "public"), y el "set search_path = public, vault" de esas dos
-- funciones no lo incluía -- se agrega acá.
-- ------------------------------------------------------------

create or replace function public.guardar_config_obs(
  p_url text,
  p_password text,
  p_escena_bracket text,
  p_escena_en_vivo text
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
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

create or replace function public.obtener_config_obs()
returns table (
  obs_websocket_url text,
  obs_websocket_password text,
  obs_escena_bracket text,
  obs_escena_en_vivo text
)
language plpgsql
security definer
set search_path = public, vault, extensions
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
