-- ============================================================
-- Migración 018: saca perfil_tipo de la lista de columnas que
-- cualquier usuario autenticado puede editar en su propia fila.
--
-- Error en la migración 017: perfil_tipo quedó en el "grant update
-- (...) to authenticated" general, lo que significaba que cualquier
-- usuario podía cambiarse su propio perfil_tipo con un update directo
-- a su propia fila (profiles_update_propio ya deja editar la fila
-- propia, y el permiso de columna no distingue "el dueño de la fila"
-- de "un admin"). Eso contradice la migración 011: perfil_tipo nunca
-- se elige a mano, solo pasa a 'lider_clan' automáticamente al crear
-- un equipo.
--
-- Arreglo: perfil_tipo sale del todo de la lista de columnas
-- editables por "authenticated" -- ni siquiera un admin puede
-- tocarlo con un update directo desde ahora. La única puerta pasa a
-- ser admin_cambiar_perfil_tipo(), mismo patrón que
-- admin_listar_usuarios(), resolver_disputa(), etc.: security
-- definer, verifica is_admin() antes de hacer nada.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- No se puede "revocar solo perfil_tipo" de un grant que ya la
-- incluye (mismo problema explicado en la migración 017) -- hay que
-- volver a otorgar la lista completa, esta vez sin perfil_tipo.
revoke update on public.profiles from authenticated;

grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url, suspendido
) on public.profiles to authenticated;

create or replace function public.admin_cambiar_perfil_tipo(p_usuario_id uuid, p_nuevo_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar el rol de un usuario.';
  end if;

  if p_nuevo_rol not in ('jugador', 'lider_clan') then
    raise exception 'Ese rol no es válido.';
  end if;

  update public.profiles set perfil_tipo = p_nuevo_rol where id = p_usuario_id;
end;
$$;

grant execute on function public.admin_cambiar_perfil_tipo(uuid, text) to authenticated;
