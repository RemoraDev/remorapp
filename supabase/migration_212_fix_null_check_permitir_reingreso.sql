-- Migración 212, corrección cosmética encontrada en la pasada de QA
-- de las migraciones 209/210/211: permitir_reingreso_comunidad() no
-- validaba "comunidad no encontrada" como sí hacen las otras 3
-- funciones nuevas de la 209 -- con un p_comunidad_id inexistente,
-- v_creador_id queda null y "null <> auth.uid()" evalúa a null (no
-- true), así que la excepción no se disparaba y la función seguía
-- hasta un delete que no afecta ninguna fila (no-op silencioso, sin
-- riesgo de seguridad, pero inconsistente con el resto del archivo).
create or replace function public.permitir_reingreso_comunidad(p_comunidad_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
begin
  select creador_id into v_creador_id from public.comunidades where id = p_comunidad_id;

  if v_creador_id is null then
    raise exception 'Comunidad no encontrada.';
  end if;
  if v_creador_id <> auth.uid() then
    raise exception 'Solo el creador puede permitir el reingreso.';
  end if;

  delete from public.comunidad_kicks_log
  where comunidad_id = p_comunidad_id and user_id = p_user_id;
end;
$$;

grant execute on function public.permitir_reingreso_comunidad(uuid, uuid) to authenticated;
