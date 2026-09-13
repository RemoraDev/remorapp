-- ------------------------------------------------------------
-- Segunda corrección sobre la migración 090: confirmar_lineup_cw()
-- también tenía hardcodeado "el lineup WTL necesita exactamente 3
-- jugadores" -- se detectó recién al jugar en vivo un torneo formato
-- 'wtl' con jugadores_por_set = 2. Se generaliza al mismo criterio que
-- ya usa armar_lineup_cw(): el límite lo define jugadores_por_set del
-- torneo (o 3 por default, para los usos previos de WTL que no vienen
-- de un torneo formato 'wtl').
-- ------------------------------------------------------------

create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid, p_team_id_como_admin uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_posiciones_completas boolean;
  v_jugadores_por_set int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede confirmar el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_confirmar_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  if v_reto.formato = 'wtl' then
    v_jugadores_por_set := coalesce((select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t), 3);

    select (count(distinct posicion) = v_jugadores_por_set) into v_posiciones_completas
    from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion is not null;

    if not v_posiciones_completas then
      raise exception 'En formato WTL el lineup necesita exactamente % jugadores titulares.', v_jugadores_por_set;
    end if;
  end if;

  if v_mi_team_id = v_reto.challenger_team_id then
    update public.clan_wars
      set lineup_visto_bueno_challenger = true, visto_bueno_dado_por_challenger = auth.uid()
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = true, visto_bueno_dado_por_challenged = auth.uid()
      where id = p_clan_war_id;
  end if;

  update public.clan_wars
    set check_in_abierto = true
    where id = p_clan_war_id
      and lineup_visto_bueno_challenger
      and lineup_visto_bueno_challenged;
end;
$$;

grant execute on function public.confirmar_lineup_cw(uuid, uuid) to authenticated;
