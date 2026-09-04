-- ============================================================
-- Migración 051: catálogo de fondos para la sala de lineup de Clan
-- War -- distinto y separado del catálogo de fondos del bracket de
-- torneos (tournaments.fondo_bracket, migración 040), que no se toca.
--
-- Decisión sobre el camino elegido (el pedido daba a elegir entre dos):
-- reutilizar exactamente el componente/selectores CSS de fondo_bracket
-- hubiera exigido EDITAR esas reglas existentes para agregar la nueva
-- clase de la sala de lineup a sus selectores compuestos (por ejemplo
-- ".tournament-bracket-wrap[data-fondo-bracket=...], .bracket-fondo-preview[...]"
-- son selectores cerrados, atados a esas clases puntuales) -- eso
-- significaba tocar ese catálogo, que el pedido pidió explícitamente
-- no tocar. Se optó entonces por una columna nueva (clan_wars.fondo_lineup),
-- un tipo/constante nuevos en el frontend, y un bloque de CSS aparte
-- bajo su propio atributo (data-fondo-lineup), reutilizando la MISMA
-- técnica visual (los mismos gradientes/SVG, copiados, no compartidos)
-- para no reinventar algo que ya funciona bien.
--
-- clan_wars no tiene política de UPDATE para authenticated (todo pasa
-- por funciones, como el resto de la tabla) -- de ahí
-- cambiar_fondo_lineup_cw(), mismo patrón que completar_datos_transmision().
-- ============================================================

alter table public.clan_wars add column if not exists fondo_lineup text not null default 'ninguno'
  check (fondo_lineup in ('ninguno', 'campo_estrellas', 'nebulosa', 'constelacion', 'vortice'));

create or replace function public.cambiar_fondo_lineup_cw(p_clan_war_id uuid, p_fondo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_fondo not in ('ninguno', 'campo_estrellas', 'nebulosa', 'constelacion', 'vortice') then
    raise exception 'Ese fondo no es válido.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar el fondo.';
  end if;

  -- "Cambiable en cualquier momento antes de que la Clan War termine"
  -- -- la sala de lineup existe mientras el reto está aceptado o en
  -- curso; antes de aceptarse no hay lineup que armar, y una vez
  -- resuelta (finalizada/empatada/rechazada/cancelada) ya no tiene
  -- sentido seguir cambiando la decoración.
  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El fondo de la sala de lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set fondo_lineup = p_fondo where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_fondo_lineup_cw(uuid, text) to authenticated;
