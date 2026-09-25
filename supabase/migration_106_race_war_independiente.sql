-- ------------------------------------------------------------
-- Migración 106: "Race War" (antes "Guerra de Razas", migración 102)
-- pasa a ser un evento independiente -- ya no un complemento que se
-- activa al crear un torneo de verdad (el checkbox "Activar Guerra de
-- Razas" en /tournaments/create se elimina del lado del cliente).
--
-- crear_race_war() arma, en un solo paso atómico, un torneo mínimo
-- OCULTO (publico = false, nunca aparece en /tournaments -- ver la
-- política de select ya existente y el filtro publico=true del
-- listado) que sirve solo de anfitrión técnico para reutilizar
-- guerra_razas.tournament_id tal cual está -- el organizador nunca lo
-- ve ni lo gestiona como torneo, entra directo a /guerra-razas/:id.
--
-- No se toca la tabla guerra_razas ni su RLS: ya funcionaba igual de
-- bien colgando de un torneo oculto que de uno real, el permiso de
-- edición siempre fue guerra_razas.creado_por, no algo del torneo.
-- ------------------------------------------------------------

create or replace function public.crear_race_war()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_race_war_id uuid;
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  -- Valores placeholder en las columnas que exige tournaments pero que
  -- un Race War nunca usa (formato/modo/cupos_totales/fecha_inicio) --
  -- nadie se inscribe ni juega partidas acá, es solo el anfitrión
  -- técnico del marcador.
  insert into public.tournaments (
    nombre, formato, modo, publico, cupos_totales, fecha_inicio, creador_id
  ) values (
    'Race War', '1v1', 'eliminacion_simple', false, 2, now(), auth.uid()
  )
  returning id into v_tournament_id;

  insert into public.guerra_razas (tournament_id, creado_por)
  values (v_tournament_id, auth.uid())
  returning id into v_race_war_id;

  return v_race_war_id;
end;
$$;

grant execute on function public.crear_race_war() to authenticated;
