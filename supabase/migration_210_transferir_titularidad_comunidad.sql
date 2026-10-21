-- Migración 210, corrección QA/UX: Comunidades solo tiene un rol
-- posible (el creador, comunidades.creador_id) sin ninguna forma de
-- transferirlo -- si el creador deja de jugar o pierde acceso a su
-- cuenta, la comunidad queda sin nadie que pueda editar banner/logo/
-- streamer ni eliminarla (punto único de falla). Mismo criterio que
-- transferir_liderazgo() de Equipos, simplificado: comunidad_miembros
-- no tiene roles, así que esto solo cambia comunidades.creador_id --
-- el resto de las políticas de RLS ya comparan contra esa columna en
-- tiempo real, no hace falta tocar ninguna otra.
create or replace function public.transferir_titularidad_comunidad(p_comunidad_id uuid, p_nuevo_creador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
  v_es_miembro boolean;
begin
  select creador_id into v_creador_id from public.comunidades where id = p_comunidad_id for update;

  if v_creador_id is null then
    raise exception 'Comunidad no encontrada.';
  end if;
  if v_creador_id <> auth.uid() then
    raise exception 'No eres el creador de esta comunidad.';
  end if;
  if p_nuevo_creador_id = auth.uid() then
    raise exception 'Ya eres el creador de esta comunidad.';
  end if;

  select exists (
    select 1 from public.comunidad_miembros where comunidad_id = p_comunidad_id and user_id = p_nuevo_creador_id
  ) into v_es_miembro;

  if not v_es_miembro then
    raise exception 'Esa persona no es integrante de la comunidad.';
  end if;

  update public.comunidades set creador_id = p_nuevo_creador_id where id = p_comunidad_id;
end;
$$;

grant execute on function public.transferir_titularidad_comunidad(uuid, uuid) to authenticated;
