-- ------------------------------------------------------------
-- Migración 116: corrige un agujero de seguridad real que quedó
-- abierto en la migración 114.
--
-- tournaments tiene "grant insert, update on public.tournaments to
-- authenticated" de tabla completa (sin lista de columnas), y
-- tournaments_update_organizador (RLS) deja al organizador tocar
-- CUALQUIER columna de su propio torneo, sin restricción -- ver el
-- comentario largo junto a esa política ("sin restricción de qué
-- columnas puede tocar ni en qué estado"). Como en Postgres un revoke
-- de columna NO recorta un grant de tabla completa (son entradas
-- independientes -- ver el comentario de la migración 017, junto al
-- grant de profiles), agregar la columna aprobado_para_ranking sin
-- nada más dejaba a CUALQUIER organizador aprobar su propio torneo
-- para el ranking con un simple .update() directo, sin pasar nunca
-- por admin_aprobar_torneo_ranking() -- exactamente lo que la
-- migración 114 quería impedir.
--
-- Se protege con el mismo patrón que ya usa profiles para es_admin/
-- suspendido: un trigger BEFORE UPDATE que revierte en silencio
-- cualquier cambio a esta columna si quien llama no es staff, admin
-- ni el dueño de la plataforma -- así el resto de un guardado del
-- organizador (fecha, cupos, etc.) sigue funcionando normal, solo este
-- campo puntual queda protegido.
-- ------------------------------------------------------------

create or replace function public.proteger_aprobado_para_ranking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.aprobado_para_ranking is distinct from old.aprobado_para_ranking
     and not (public.is_admin() or public.es_staff() or public.es_dueno_plataforma()) then
    new.aprobado_para_ranking := old.aprobado_para_ranking;
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_proteger_aprobado_ranking on public.tournaments;

create trigger before_update_proteger_aprobado_ranking
  before update on public.tournaments
  for each row execute function public.proteger_aprobado_para_ranking();
