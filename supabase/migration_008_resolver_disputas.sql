-- ============================================================
-- Migración 008: resolver disputas de resultado de bracket.
--
-- Hasta ahora, si los dos participantes de una partida reportaban
-- ganadores distintos, la partida quedaba en_disputa para siempre --
-- ni el organizador ni nadie podía tocarla de nuevo (reportar_resultado
-- la rechaza explícitamente una vez en ese estado). Esta migración
-- agrega la única puerta de salida: resolver_disputa(), que solo puede
-- llamar un administrador (es_admin = true), verificado adentro de la
-- función -- no alcanza con esconder el botón en /admin.
--
-- No toca nada de lo que ya existe.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create or replace function public.resolver_disputa(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver una disputa.';
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id for update;

  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'en_disputa' then
    raise exception 'Esta partida no está en disputa.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  update public.bracket_matches
    set winner_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;

  -- Mismo camino que un reporte normal ya resuelto: mete al ganador en
  -- la siguiente ronda (o cierra el torneo si era la final).
  perform public.avanzar_ganador(p_match_id);
end;
$$;

grant execute on function public.resolver_disputa(uuid, uuid) to authenticated;
