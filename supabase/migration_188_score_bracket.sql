alter table public.bracket_matches add column resultado_participant1 integer;
alter table public.bracket_matches add column resultado_participant2 integer;

drop function if exists public.reportar_resultado(uuid, uuid);

create or replace function public.reportar_resultado(
  p_match_id uuid,
  p_ganador_id uuid,
  p_resultado_participant1 integer default null,
  p_resultado_participant2 integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_torneo record;
  v_es_organizador boolean;
  v_soy_p1 boolean;
  v_soy_p2 boolean;
begin
  select * into v_match from public.bracket_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.clan_war_id is not null then
    raise exception 'Este partido se juega como Clan War -- reportalo desde ahí, no con este botón.';
  end if;
  if v_match.status = 'jugado' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;
  if v_match.status = 'en_disputa' then
    raise exception 'Resultado en disputa, un administrador debe resolverlo.';
  end if;
  if v_match.participant2_id is null then
    raise exception 'Esta partida es un bye, no se reporta.';
  end if;
  if p_ganador_id <> v_match.participant1_id and p_ganador_id <> v_match.participant2_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  select * into v_torneo from public.tournaments where id = v_match.tournament_id;
  v_es_organizador := (v_torneo.creador_id = auth.uid());

  v_soy_p1 := public.es_dueno_del_participante(v_match.participant1_id);
  v_soy_p2 := public.es_dueno_del_participante(v_match.participant2_id);

  if not v_es_organizador and not v_soy_p1 and not v_soy_p2 then
    raise exception 'No tienes permiso para reportar esta partida.';
  end if;

  if not v_es_organizador and not v_torneo.permite_autoreporte then
    raise exception 'El organizador de este torneo desactivó el autoreporte -- solo él puede cargar resultados.';
  end if;

  if v_es_organizador then
    update public.bracket_matches
      set winner_id = p_ganador_id, status = 'jugado',
        resultado_participant1 = p_resultado_participant1,
        resultado_participant2 = p_resultado_participant2
      where id = p_match_id;
  else
    if v_soy_p1 then
      update public.bracket_matches set reported_p1_winner = p_ganador_id where id = p_match_id;
    else
      update public.bracket_matches set reported_p2_winner = p_ganador_id where id = p_match_id;
    end if;

    select * into v_match from public.bracket_matches where id = p_match_id;

    if v_match.reported_p1_winner is not null and v_match.reported_p2_winner is not null then
      if v_match.reported_p1_winner = v_match.reported_p2_winner then
        update public.bracket_matches
          set winner_id = v_match.reported_p1_winner, status = 'jugado',
            resultado_participant1 = p_resultado_participant1,
            resultado_participant2 = p_resultado_participant2
          where id = p_match_id;
      else
        update public.bracket_matches set status = 'en_disputa' where id = p_match_id;
      end if;
    end if;
  end if;

  select * into v_match from public.bracket_matches where id = p_match_id;

  if v_match.status = 'jugado' then
    perform public.avanzar_ganador(p_match_id);
  end if;
end;
$$;

grant execute on function public.reportar_resultado(uuid, uuid, integer, integer) to authenticated;
