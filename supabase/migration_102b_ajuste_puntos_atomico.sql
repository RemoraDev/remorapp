-- ------------------------------------------------------------
-- Migración 102b: corrige una condición de carrera real encontrada en
-- la prueba en vivo de Guerra de Razas -- el botón +1/-1 hacía un
-- "leer valor actual en el cliente, sumar, escribir" (UPDATE con el
-- valor ya calculado). Con clics rápidos, el eco de Realtime de una
-- actualización anterior podía llegar y pisar el estado local justo
-- antes de que se calculara el siguiente clic, perdiendo incrementos
-- (probado: 15 clics de +1 sobre 10 dieron 23 en vez de 25).
--
-- La solución es que el incremento se calcule DENTRO de la base, en
-- una sola sentencia atómica (puntos_x = puntos_x + delta), para que
-- no importe en qué orden ni con qué latencia lleguen los ecos de
-- Realtime -- cada clic parte siempre del valor real ya confirmado.
-- ------------------------------------------------------------

create function public.ajustar_puntos_guerra_razas(p_guerra_id uuid, p_raza text, p_delta integer)
returns public.guerra_razas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado public.guerra_razas;
begin
  if p_raza not in ('protoss', 'terran', 'zerg') then
    raise exception 'Raza inválida: %', p_raza;
  end if;

  update public.guerra_razas
  set
    puntos_protoss = case when p_raza = 'protoss' then puntos_protoss + p_delta else puntos_protoss end,
    puntos_terran = case when p_raza = 'terran' then puntos_terran + p_delta else puntos_terran end,
    puntos_zerg = case when p_raza = 'zerg' then puntos_zerg + p_delta else puntos_zerg end
  where id = p_guerra_id and creado_por = auth.uid()
  returning * into v_resultado;

  if v_resultado is null then
    raise exception 'No se encontró la Guerra de Razas, o no sos el organizador.';
  end if;

  return v_resultado;
end;
$$;

grant execute on function public.ajustar_puntos_guerra_razas(uuid, text, integer) to authenticated;
