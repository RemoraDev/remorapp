-- ------------------------------------------------------------
-- Migración 113: dos correcciones reales reportadas por un usuario
-- probando Guerra de Razas en vivo.
--
-- 1) eliminar_encuentro_guerra_razas(): un Enfrentamiento ya generado
-- pero NO finalizado queda con sus 3 jugadores fijos desde el momento
-- en que se generó -- si el organizador cambia después cuál jugador
-- está "elegido" (la estrella) en Marcador, el Enfrentamiento abierto
-- no se entera, porque nunca se vuelve a leer esa estrella hasta la
-- próxima vez que se genera un encuentro. Esto causó confusión real
-- ("el sistema insiste en poner a SNK como terran" aunque ya se había
-- elegido a otro jugador). Como un encuentro no finalizado todavía no
-- repartió ningún punto, es seguro borrarlo por completo y dejar que
-- el organizador genere uno nuevo, que sí va a tomar los jugadores
-- elegidos actuales.
-- ------------------------------------------------------------

create or replace function public.eliminar_encuentro_guerra_razas(p_encuentro_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  select ge.* into v_enc
  from public.guerra_razas_encuentros ge
  join public.guerra_razas g on g.id = ge.guerra_id
  where ge.id = p_encuentro_id and g.creado_por = auth.uid()
  for update of ge;

  if v_enc is null then
    raise exception 'No tienes permiso sobre este encuentro, o no existe.';
  end if;
  if v_enc.finalizado then
    raise exception 'Un encuentro ya finalizado no se puede deshacer -- sus puntos ya se repartieron.';
  end if;

  delete from public.guerra_razas_encuentros where id = p_encuentro_id;
end;
$$;

grant execute on function public.eliminar_encuentro_guerra_razas(uuid) to authenticated;
