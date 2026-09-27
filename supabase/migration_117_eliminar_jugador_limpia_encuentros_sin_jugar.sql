-- ------------------------------------------------------------
-- Migración 117: SNK (un jugador de prueba) quedó imposible de
-- eliminar aunque "todavía no jugó nada" -- la migración 111 dejó la
-- llave foránea de guerra_razas_encuentros.jugador_*_id SIN on delete
-- cascade a propósito, para proteger el historial real, pero eso
-- también bloquea a un jugador que solo quedó referenciado por un
-- encuentro generado y JAMÁS finalizado (sin resultados cargados, sin
-- puntos repartidos) -- no hay ningún historial ahí que proteger.
--
-- eliminar_jugador_guerra_razas() reemplaza al delete directo de la
-- tabla: antes de borrar al jugador, limpia cualquier encuentro SIN
-- FINALIZAR que lo referencie (en cualquiera de las 3 razas, no
-- necesariamente en la propia -- por si el organizador cambió de raza
-- a un jugador con un encuentro generado a medias). Si el jugador
-- sigue sin poder borrarse después de esa limpieza, es porque
-- realmente participó en un encuentro YA FINALIZADO -- ahí sí se
-- respeta el bloqueo (la llave foránea sigue sin cascada para eso).
--
-- De paso, se redeclara eliminar_encuentro_guerra_razas() por si la
-- migración 113 no se llegó a correr todavía -- create or replace es
-- seguro de aplicar de nuevo aunque ya exista.
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

create or replace function public.eliminar_jugador_guerra_razas(p_jugador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jugador record;
  v_creador_id uuid;
begin
  select gj.* into v_jugador
  from public.guerra_razas_jugadores gj
  where gj.id = p_jugador_id
  for update of gj;

  if v_jugador is null then
    raise exception 'Ese jugador no existe.';
  end if;

  select creado_por into v_creador_id from public.guerra_razas where id = v_jugador.guerra_id;
  if v_creador_id is null or v_creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede eliminar jugadores.';
  end if;

  -- Limpia cualquier encuentro SIN finalizar que lo referencie, en
  -- cualquiera de las 3 razas -- no representa historial real, nunca
  -- se repartieron puntos por él.
  delete from public.guerra_razas_encuentros
  where guerra_id = v_jugador.guerra_id
    and not finalizado
    and (
      jugador_protoss_id = p_jugador_id
      or jugador_terran_id = p_jugador_id
      or jugador_zerg_id = p_jugador_id
    );

  -- Si el jugador participó en un encuentro YA finalizado, esto sigue
  -- fallando por la llave foránea (a propósito: eso sí es historial
  -- real, no se toca).
  delete from public.guerra_razas_jugadores where id = p_jugador_id;
end;
$$;

grant execute on function public.eliminar_jugador_guerra_razas(uuid) to authenticated;
