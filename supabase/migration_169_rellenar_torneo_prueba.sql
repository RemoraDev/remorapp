-- Migración 169: botón "Rellenar con equipos y jugadores" (Panel de
-- control, visible solo para staff/admin) -- a pedido del usuario,
-- para probar funciones sin tener que armar participantes a mano
-- cada vez. Completa los cupos que falten del torneo usando el pool
-- de cuentas reales creado una vez por scripts/sembrar-pool-qa.mjs
-- (RemorApp exige que todo participante sea una cuenta real, no hay
-- forma de inventar "jugadores fantasma" sueltos).
create or replace function public.rellenar_torneo_prueba(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_faltan integer;
  v_agregados integer := 0;
  v_candidato_id uuid;
begin
  if not (public.is_admin() or public.es_staff()) then
    raise exception 'Solo staff o administradores pueden usar esto.';
  end if;

  select * into v_torneo from public.tournaments where id = p_tournament_id for update;
  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;

  v_faltan := v_torneo.cupos_totales - v_torneo.cupos_ocupados;
  if v_faltan <= 0 then
    return 0;
  end if;

  if v_torneo.formato = '1v1' then
    for v_candidato_id in
      select p.id
      from public.profiles p
      where p.nick like 'QAPoolJugador%'
        and not exists (
          select 1 from public.tournament_participants tp
          where tp.tournament_id = p_tournament_id and tp.user_id = p.id
        )
      order by p.nick
      limit v_faltan
    loop
      insert into public.tournament_participants (tournament_id, user_id)
      values (p_tournament_id, v_candidato_id);
      v_agregados := v_agregados + 1;
    end loop;
  else
    for v_candidato_id in
      select t.id
      from public.teams t
      where t.name like 'QA Pool Equipo%'
        and not t.disuelto
        and not exists (
          select 1 from public.tournament_participants tp
          where tp.tournament_id = p_tournament_id and tp.team_id = t.id
        )
      order by t.name
      limit v_faltan
    loop
      insert into public.tournament_participants (tournament_id, team_id)
      values (p_tournament_id, v_candidato_id);
      v_agregados := v_agregados + 1;
    end loop;
  end if;

  return v_agregados;
end;
$$;

grant execute on function public.rellenar_torneo_prueba(uuid) to authenticated;
