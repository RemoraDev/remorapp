-- ------------------------------------------------------------
-- Migración 086: rediseño del panel de administración -- soporte de
-- base para las piezas que faltaban en el frontend.
--
-- 1) admin_listar_usuarios() traía TODA la tabla profiles de una, sin
--    buscador ni límite -- con cientos de cuentas (muchas de prueba,
--    de esta misma sesión) la pestaña "Usuarios" quedaba mostrando a
--    todo el mundo de encima. Pasa a aceptar una búsqueda opcional
--    (nick/email/unique_id) y un límite -- sin búsqueda, muestra los
--    más recientes primero (útil para ver altas nuevas), no toda la
--    base.
--
-- 2) reportes_staff no tenía forma de marcarse como resuelto -- un
--    reporte quedaba ahí para siempre, sin ninguna acción posible
--    desde /admin. Se agrega el estado y una política para que
--    cualquier admin lo pueda resolver.
-- ------------------------------------------------------------

create or replace function public.admin_listar_usuarios(p_busqueda text default null, p_limite int default 30)
returns table (
  id uuid,
  nick text,
  unique_id text,
  email text,
  country text,
  perfil_tipo text,
  cuenta_validada boolean,
  suspendido boolean,
  es_admin boolean,
  suspendido_por_nick text,
  suspendido_motivo text,
  suspendido_en timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado: se requiere ser administrador.';
  end if;

  return query
    select p.id, p.nick, p.unique_id, p.email, p.country, p.perfil_tipo,
           p.cuenta_validada, p.suspendido, p.es_admin,
           sp.nick, p.suspendido_motivo, p.suspendido_en
    from public.profiles p
    left join public.profiles sp on sp.id = p.suspendido_por
    where
      p_busqueda is null or trim(p_busqueda) = ''
      or p.nick ilike '%' || p_busqueda || '%'
      or p.email ilike '%' || p_busqueda || '%'
      or p.unique_id ilike '%' || p_busqueda || '%'
    order by p.creado_en desc
    limit greatest(1, least(coalesce(p_limite, 30), 200));
end;
$$;

grant execute on function public.admin_listar_usuarios(text, int) to authenticated;

-- ---------- reportes_staff: estado de resolución ----------
alter table public.reportes_staff
  add column resuelto boolean not null default false,
  add column resuelto_por uuid references public.profiles (id),
  add column resuelto_en timestamptz;

create policy "reportes_staff_update_admin"
  on public.reportes_staff for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update on public.reportes_staff to authenticated;
