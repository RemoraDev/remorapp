-- ------------------------------------------------------------
-- Migración 096: el contador de notificaciones del header (la
-- pastillita roja sobre el avatar) solo sumaba invitaciones de equipo
-- y retos de Clan War pendientes -- notificaciones_pendientes_count()
-- suma, además, invitaciones de torneo a algún equipo del que soy
-- dueño o capitán, solicitudes de reprogramación de Clan War
-- propuestas por el rival, y retos de título Padre/Hijo (tanto de
-- jugador como de clan) pendientes de mi respuesta. Solo cuenta lo
-- que espera MI acción -- no lo que yo mismo propuse y todavía espera
-- la respuesta del otro lado (mismo criterio que ya usaba
-- retos_clan_war_pendientes_count() con las Clan Wars).
-- ------------------------------------------------------------

create or replace function public.notificaciones_pendientes_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::integer from public.team_invitations
      where invited_user_id = auth.uid() and status = 'pendiente'
    )
    +
    (
      select count(*)::integer from public.torneo_invitaciones_equipo ti
      where ti.status = 'pendiente' and public.es_capitan_o_dueno(ti.equipo_id)
    )
    +
    public.retos_clan_war_pendientes_count()
    +
    (
      select count(*)::integer
      from public.clan_war_reschedules r
      join public.clan_wars cw on cw.id = r.clan_war_id
      where r.status = 'pendiente'
        and (
          (cw.challenger_team_id = r.propuesto_por and public.es_capitan_o_dueno(cw.challenged_team_id))
          or (cw.challenged_team_id = r.propuesto_por and public.es_capitan_o_dueno(cw.challenger_team_id))
        )
    )
    +
    (
      select count(*)::integer from public.titulos_padre_hijo
      where status = 'pendiente' and tipo = 'jugador' and retado_id = auth.uid()
    )
    +
    (
      select count(*)::integer from public.titulos_padre_hijo
      where status = 'pendiente' and tipo = 'clan' and public.es_capitan_o_dueno(retado_id)
    );
$$;

grant execute on function public.notificaciones_pendientes_count() to authenticated;
