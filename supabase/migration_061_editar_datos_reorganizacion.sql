-- ------------------------------------------------------------
-- Migración 061: reorganización de "Editar Datos" -- separa lo
-- genérico (nick, contraseña, país, correo de recuperación) de lo
-- específico de StarCraft II (que se mueve entero a "Editar Datos del
-- Juego", ver la reorganización del frontend en ProfilePage.tsx).
--
-- Lo único que necesita la base es la columna nueva del correo de
-- recuperación y las funciones para leerla/guardarla (privada, mismo
-- criterio que profiles.email -- no es pública como el resto del
-- perfil) y para resolverla en el flujo de "¿Olvidaste tu contraseña?".
-- ------------------------------------------------------------

alter table public.profiles add column correo_recuperacion text;

-- Evita que dos cuentas distintas terminen compartiendo el mismo
-- correo de recuperación -- si eso pasara, resolver_correo_recuperacion()
-- no tendría forma de saber a cuál de las dos mandarle el link.
-- Parcial (where not null) para no chocar con las filas que todavía
-- no configuraron ninguno.
create unique index profiles_correo_recuperacion_unico
  on public.profiles (correo_recuperacion)
  where correo_recuperacion is not null;

-- mi_correo_recuperacion(): el dueño de la cuenta necesita ver su
-- propio valor para poder editarlo -- correo_recuperacion NO tiene
-- grant de columna (ni para anon ni para authenticated), mismo
-- criterio que profiles.email, así que hace falta esta función para
-- leerlo en vez de un select directo.
create or replace function public.mi_correo_recuperacion()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select correo_recuperacion from public.profiles where id = auth.uid();
$$;

grant execute on function public.mi_correo_recuperacion() to authenticated;

create or replace function public.guardar_correo_recuperacion(p_correo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text := nullif(trim(coalesce(p_correo, '')), '');
begin
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Ese correo no tiene un formato válido.';
  end if;

  begin
    update public.profiles set correo_recuperacion = v_correo where id = auth.uid();
  exception
    when unique_violation then
      raise exception 'Ese correo ya está configurado como recuperación en otra cuenta.';
  end;
end;
$$;

grant execute on function public.guardar_correo_recuperacion(text) to authenticated;

-- resolver_correo_recuperacion(): la puerta de entrada de "¿Olvidaste
-- tu contraseña?" (ForgotPasswordPage.tsx) -- se llama ANTES de
-- auth.resetPasswordForEmail(). Si lo que escribió la persona ya es
-- el correo principal de una cuenta, se devuelve tal cual (caso de
-- siempre, sin cambios). Si no, se busca coincidencia por
-- correo_recuperacion y se devuelve el correo PRINCIPAL de esa cuenta
-- (nunca el secundario -- el link de recuperación solo puede llegar
-- al correo de acceso real). Si no hay ninguna coincidencia, se
-- devuelve lo que se ingresó sin cambios, para que
-- resetPasswordForEmail() siga con su comportamiento normal de no
-- revelar si un correo está o no registrado.
create or replace function public.resolver_correo_recuperacion(p_correo text)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ya_es_principal boolean;
  v_correo_principal text;
begin
  select exists(select 1 from auth.users where email = p_correo) into v_ya_es_principal;
  if v_ya_es_principal then
    return p_correo;
  end if;

  -- Se lee auth.users.email (la fuente de verdad real), no
  -- profiles.email -- ese último es solo un espejo de comodidad que
  -- no necesariamente se actualiza si la cuenta cambió de correo.
  select au.email into v_correo_principal
  from public.profiles p
  join auth.users au on au.id = p.id
  where p.correo_recuperacion = p_correo
  limit 1;

  return coalesce(v_correo_principal, p_correo);
end;
$$;

grant execute on function public.resolver_correo_recuperacion(text) to anon, authenticated;
