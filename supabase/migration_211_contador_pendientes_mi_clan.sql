-- Migración 211, corrección QA/UX: TeamDetailPage.tsx acumula varias
-- colas de "pendiente de respuesta" (solicitudes de unión, retos de
-- Clan War, títulos padre/hijo, alianzas, reprogramaciones,
-- extensiones de lineup, consentimiento de torneos históricos) que
-- hoy no generan ninguna señal fuera del Panel de control -- el dueño
-- tiene que acordarse de entrar y revisar pestaña por pestaña, varias
-- de ellas sensibles a plazo. Esta función suma el total para mostrar
-- un contador simple en la barra de navegación.
--
-- Alcance a propósito: hoy, de estas 7 colas, el FRONTEND solo carga
-- 6 de ellas para el dueño LITERAL del equipo (team_members con rol
-- "owner" vía teams.owner_id), no para un capitán -- solo la cola de
-- solicitudes de unión es visible para capitanes vía su propia
-- política de RLS. Para no inventar un alcance nuevo que el resto de
-- la UI no tiene, este contador también queda acotado al dueño
-- literal; un capitán recibe 0 aunque técnicamente podría ver algo de
-- la cola de solicitudes de unión si se abriera esa página.
create or replace function public.contar_pendientes_mi_clan()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_total int := 0;
begin
  select id into v_team_id from public.teams where owner_id = auth.uid() and disuelto = false;

  if v_team_id is null then
    return 0;
  end if;

  -- 1) Solicitudes de unión pendientes.
  select v_total + count(*) into v_total
    from public.team_join_requests
    where team_id = v_team_id and status = 'pendiente';

  -- 2) Retos de Clan War que me llegaron, pendientes de aceptar/rechazar.
  select v_total + count(*) into v_total
    from public.clan_wars
    where challenged_team_id = v_team_id and status = 'pendiente';

  -- 3) Títulos padre/hijo (clan) pendientes de responder.
  select v_total + count(*) into v_total
    from public.titulos_padre_hijo
    where tipo = 'clan' and status = 'pendiente' and retado_id = v_team_id;

  -- 4) Alianzas propuestas por el OTRO equipo, pendientes de mi confirmación.
  select v_total + count(*) into v_total
    from public.team_alianzas
    where team_b_id = v_team_id and status = 'pendiente' and aprobado_por_equipo_b = false;

  -- 5) y 6) Reprogramaciones/extensiones de lineup propuestas por el
  -- RIVAL (propuesto_por <> mi equipo), solo de Clan Wars activas.
  select v_total + count(*) into v_total
    from public.clan_war_reschedules r
    join public.clan_wars cw on cw.id = r.clan_war_id
    where r.status = 'pendiente'
      and r.propuesto_por <> v_team_id
      and cw.status in ('aceptada', 'en_curso')
      and (cw.challenger_team_id = v_team_id or cw.challenged_team_id = v_team_id);

  select v_total + count(*) into v_total
    from public.clan_war_lineup_extensiones e
    join public.clan_wars cw on cw.id = e.clan_war_id
    where e.status = 'pendiente'
      and e.propuesto_por <> v_team_id
      and cw.status in ('aceptada', 'en_curso')
      and (cw.challenger_team_id = v_team_id or cw.challenged_team_id = v_team_id);

  -- 7) Consentimiento de torneos históricos pendiente.
  select v_total + count(*) into v_total
    from public.historical_tournament_participants
    where team_id = v_team_id and consentimiento is null;

  return v_total;
end;
$$;

grant execute on function public.contar_pendientes_mi_clan() to authenticated;
