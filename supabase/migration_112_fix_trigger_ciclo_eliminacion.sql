-- ------------------------------------------------------------
-- Migración 112: corrige un bug real encontrado al probar en vivo la
-- migración 111.
--
-- Bug: al eliminar una Race War completa (tournaments -> cascada a
-- guerra_razas -> cascada a guerra_razas_jugadores), el trigger AFTER
-- DELETE de recalcular_duracion_ciclo_guerra_razas() se sigue
-- disparando por cada jugador borrado e intenta hacer upsert en
-- guerra_razas_ciclos -- pero, dentro de esa misma transacción, la
-- fila padre de guerra_razas ya fue borrada (el cascade la borra
-- primero, y luego dispara el cascade sobre guerra_razas_jugadores).
-- El insert/update resultante viola la llave foránea
-- guerra_razas_ciclos_guerra_id_fkey, y toda la eliminación falla.
--
-- Confirmado en vivo con un script de prueba: crear una Race War con
-- jugadores y 2 ciclos jugados, y luego llamar eliminar_race_war()
-- fallaba con exactamente este error.
--
-- Corrección: al inicio del trigger, si la guerra_razas referenciada
-- ya no existe, no hacer nada (la fila de guerra_razas_ciclos de
-- todos modos se va a borrar en cascada un instante después, al
-- completarse la eliminación de guerra_razas).
-- ------------------------------------------------------------

create or replace function public.recalcular_duracion_ciclo_guerra_razas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guerra_id uuid := coalesce(new.guerra_id, old.guerra_id);
  v_categoria text := coalesce(new.categoria, old.categoria);
  v_duracion integer;
begin
  if not exists (select 1 from public.guerra_razas where id = v_guerra_id) then
    return coalesce(new, old);
  end if;

  select greatest(
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'protoss'),
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'terran'),
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'zerg')
  ) into v_duracion;

  insert into public.guerra_razas_ciclos (guerra_id, categoria, duracion_ciclo_actual)
  values (v_guerra_id, v_categoria, v_duracion)
  on conflict (guerra_id, categoria) do update set duracion_ciclo_actual = excluded.duracion_ciclo_actual;

  if TG_OP = 'UPDATE' and (old.categoria is distinct from new.categoria or old.raza is distinct from new.raza)
     and exists (select 1 from public.guerra_razas where id = old.guerra_id) then
    select greatest(
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'protoss'),
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'terran'),
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'zerg')
    ) into v_duracion;

    insert into public.guerra_razas_ciclos (guerra_id, categoria, duracion_ciclo_actual)
    values (old.guerra_id, old.categoria, v_duracion)
    on conflict (guerra_id, categoria) do update set duracion_ciclo_actual = excluded.duracion_ciclo_actual;
  end if;

  return coalesce(new, old);
end;
$$;
