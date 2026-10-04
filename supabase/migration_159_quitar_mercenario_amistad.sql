-- Migración 159: permitir quitar un mercenario fichado y deshacer una
-- amistad entre equipos ya aceptada -- a pedido del usuario, ninguna
-- de las dos tenía forma de deshacerse antes (solo fichar/solicitar,
-- sin vuelta atrás). Mismo patrón que el resto de las escrituras de
-- estas tablas: una función security definer, nada de policy directa
-- de delete para authenticated.

create or replace function public.quitar_mercenario(p_mercenario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mercenario record;
begin
  select * into v_mercenario from public.team_mercenarios where id = p_mercenario_id for update;
  if v_mercenario is null then
    raise exception 'Ese mercenario no existe.';
  end if;
  if not public.es_capitan_o_dueno(v_mercenario.team_id) then
    raise exception 'Solo el dueño o un capitán puede quitar un mercenario.';
  end if;

  delete from public.team_mercenarios where id = p_mercenario_id;
end;
$$;

grant execute on function public.quitar_mercenario(uuid) to authenticated;

create or replace function public.eliminar_amistad_equipo(p_amistad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amistad record;
begin
  select * into v_amistad from public.team_amistades where id = p_amistad_id for update;
  if v_amistad is null then
    raise exception 'Esa amistad no existe.';
  end if;
  if v_amistad.status <> 'aceptada' then
    raise exception 'Solo se puede eliminar una amistad ya aceptada.';
  end if;
  -- Dueño de cualquiera de los dos equipos puede deshacer la amistad
  -- -- mismo criterio permisivo que para iniciar relaciones entre
  -- equipos (es_capitan_o_dueno de uno de los dos lados alcanza).
  if not (public.es_capitan_o_dueno(v_amistad.equipo_solicitante_id)
       or public.es_capitan_o_dueno(v_amistad.equipo_destinatario_id)) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede eliminar la amistad.';
  end if;

  delete from public.team_amistades where id = p_amistad_id;
end;
$$;

grant execute on function public.eliminar_amistad_equipo(uuid) to authenticated;
