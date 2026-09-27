-- Migración 121: dos features nuevas pedidas junto con la reorganización
-- de "Panel de control" en el perfil de jugador y la ficha de equipo.
--
-- 1) estado_presencia: estado manual (disponible/ausente/ocupado) que
--    el usuario elige desde el menú del avatar del header -- pensado
--    para más adelante mostrarlo en el chat de líderes. "Desconectado"
--    NO es un valor de esta columna: se infiere en el cliente cuando
--    no hay sesión activa.
--
-- 2) eliminar_jugadores_temporales_vencidos(): hasta ahora un jugador
--    temporal (team_temp_players) no se borraba NUNCA, ni siquiera si
--    jamás se llegó a usar en un lineup -- de ahí que un temporal
--    creado por error o abandonado se quedara para siempre. Se borra
--    automáticamente a los 30 días de creado SI Y SOLO SI nunca
--    apareció en ningún lineup (clan_war_lineup) -- si alguna vez se
--    usó, se conserva para siempre (integridad del historial de
--    resultados), igual criterio que ya usa reemplazar_jugador_temporal()
--    al no borrar la fila. Mismo patrón que restaurar_banca_rota_perfil()/
--    expirar_titulos_vencidos(): barrido global, se llama solo desde el
--    cliente en cada carga de perfil, sin depender de un cron.

alter table public.profiles
  add column estado_presencia text not null default 'disponible'
    check (estado_presencia in ('disponible', 'ausente', 'ocupado'));

grant update (estado_presencia) on public.profiles to authenticated;

create or replace function public.eliminar_jugadores_temporales_vencidos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_temp_players t
  where t.created_at < now() - interval '30 days'
    and not exists (
      select 1 from public.clan_war_lineup l where l.jugador_temporal_id = t.id
    );
end;
$$;

grant execute on function public.eliminar_jugadores_temporales_vencidos() to authenticated;
