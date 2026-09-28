-- Migración 132: cooldown para Clan Wars "en curso" -- si nadie la
-- cierra a mano, se cierra sola 3 horas después de arrancar (evita que
-- una guerra abandonada quede "en vivo" para siempre). En los últimos
-- 10 minutos antes de ese plazo aparece un botón para extenderlo 1 hora
-- más (las veces que haga falta); en cualquier momento mientras está en
-- curso, "Guardar y cerrar Clan War" (cerrar_clan_war(), ya existía)
-- la cierra a mano y computa el resultado. El cierre automático no
-- puede simplemente "elegir un ganador" sin resultados completos -- por
-- eso, a diferencia de un cierre manual, cae en el status "cancelada"
-- (definido desde siempre en el check de status, pero nunca usado
-- hasta ahora), marcada aparte con cerrada_automaticamente para
-- distinguirla de una cancelación real.
--
-- Sin cron: el mismo espíritu perezoso que ya usa el resto de la app
-- (revelado_lineup_cw()/plazo_edicion_lineup_cw(), intentar_iniciar_
-- clan_war() llamado desde otras mutaciones) -- intentar_cancelar_
-- clan_war_vencida() se llama desde el frontend cada vez que alguien
-- carga la página del lineup, no hace falta un job aparte.

alter table public.clan_wars
  add column en_curso_vence_en timestamptz,
  add column cerrada_automaticamente boolean not null default false;

-- intentar_iniciar_clan_war(): mismo cuerpo de siempre, ahora además
-- arranca el plazo de 3 horas al pasar a en_curso.
create or replace function public.intentar_iniciar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;

  if v_reto.status = 'aceptada'
     and v_reto.challenger_confirmado
     and v_reto.challenged_confirmado
     and v_reto.tiene_delay is not null
  then
    update public.clan_wars
      set status = 'en_curso', en_curso_vence_en = now() + interval '3 hours'
      where id = p_clan_war_id;

    -- Migración 042: en formato WTL, al arrancar la guerra se generan
    -- los 3 sets emparejando la posición N del lineup de un lado
    -- contra la posición N del otro.
    if v_reto.formato = 'wtl' then
      insert into public.clan_war_wtl_sets (clan_war_id, posicion, jugador_challenger_id, jugador_challenged_id)
      select
        p_clan_war_id,
        c.posicion,
        c.jugador_id,
        d.jugador_id
      from public.clan_war_lineup c
      join public.clan_war_lineup d
        on d.clan_war_id = c.clan_war_id and d.posicion = c.posicion and d.team_id = v_reto.challenged_team_id
      where c.clan_war_id = p_clan_war_id and c.team_id = v_reto.challenger_team_id
      on conflict (clan_war_id, posicion) do nothing;
    end if;
  end if;
end;
$$;

-- Extiende el plazo 1 hora más -- solo dentro de los últimos 10
-- minutos antes de que se cierre sola, para que no se use como una
-- forma de posponerla indefinidamente desde el principio.
create or replace function public.extender_plazo_clan_war_en_curso(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta Clan War no está en curso.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede extender el plazo.';
  end if;

  if v_reto.en_curso_vence_en is null or now() < v_reto.en_curso_vence_en - interval '10 minutes' then
    raise exception 'Todavía no se puede extender -- el botón aparece 10 minutos antes de que se cierre sola.';
  end if;

  update public.clan_wars
    set en_curso_vence_en = v_reto.en_curso_vence_en + interval '1 hour'
    where id = p_clan_war_id;
end;
$$;

grant execute on function public.extender_plazo_clan_war_en_curso(uuid) to authenticated;

-- Se llama desde el frontend al cargar la página del lineup (mismo
-- espíritu que intentar_iniciar_clan_war(), pero disparado por una
-- visita en vez de por otra mutación) -- si el plazo ya venció y
-- nadie la cerró a mano, la cancela. No hace nada si todavía no
-- venció, o si ya no está en curso.
create or replace function public.intentar_cancelar_clan_war_vencida(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    return;
  end if;

  if v_reto.status = 'en_curso'
     and v_reto.en_curso_vence_en is not null
     and now() >= v_reto.en_curso_vence_en
  then
    update public.clan_wars
      set status = 'cancelada', cerrada_automaticamente = true
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.intentar_cancelar_clan_war_vencida(uuid) to authenticated;

-- lineup_editor_clan_war(): suma en_curso_vence_en y el estado de
-- confirmación de cierre de cada lado (mismo dato que ya usa el
-- "Cerrar Clan War" de la ficha del equipo, ahora también disponible
-- acá para el botón "Guardar y cerrar Clan War").
create or replace function public.lineup_editor_clan_war(p_clan_war_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
  v_rival_team_id uuid;
  v_torneo record;
  v_revelado boolean;
  v_resultado jsonb;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
    v_rival_team_id := v_reto.challenged_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
    v_rival_team_id := v_reto.challenger_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede gestionar este lineup.';
  end if;

  select * into v_torneo from public.torneo_de_clan_war(p_clan_war_id);
  v_revelado := public.revelado_lineup_cw(p_clan_war_id);

  select jsonb_build_object(
    'mi_team_id', v_mi_team_id,
    'soy_challenger', v_soy_challenger,
    'rival_team_id', v_rival_team_id,
    'rival_nombre', (select name || ' [' || tag || ']' from public.teams where id = v_rival_team_id),
    'formato', v_reto.formato,
    'status', v_reto.status,
    'es_de_torneo', v_torneo.id is not null,
    'jugadores_por_set', coalesce(v_torneo.jugadores_por_set, v_reto.jugadores_por_set, 3),
    'fondo_lineup', v_reto.fondo_lineup,
    'fondo_lineup_imagen_id', v_reto.fondo_lineup_imagen_id,
    'estructura_lineup', v_reto.estructura_lineup,
    'aspecto_lineup', v_reto.aspecto_lineup,
    'fecha_hora_cet', v_reto.fecha_hora_cet,
    'lineup_plazo_extendido_hasta', v_reto.lineup_plazo_extendido_hasta,
    'ventana_revelacion_minutos', coalesce(v_torneo.ventana_revelacion_minutos, 30),
    'lineup_revelado', v_revelado,
    'lineup_aprobado', v_reto.lineup_visto_bueno_challenger and v_reto.lineup_visto_bueno_challenged,
    'mi_visto_bueno', case when v_soy_challenger then v_reto.lineup_visto_bueno_challenger else v_reto.lineup_visto_bueno_challenged end,
    'visto_bueno_rival', case when v_soy_challenger then v_reto.lineup_visto_bueno_challenged else v_reto.lineup_visto_bueno_challenger end,
    'mi_stream_link', case when v_soy_challenger then v_reto.challenger_stream_link else v_reto.challenged_stream_link end,
    'mi_stream_delay', case when v_soy_challenger then v_reto.challenger_stream_delay else v_reto.challenged_stream_delay end,
    'rival_stream_link', case when v_soy_challenger then v_reto.challenged_stream_link else v_reto.challenger_stream_link end,
    'rival_stream_delay', case when v_soy_challenger then v_reto.challenged_stream_delay else v_reto.challenger_stream_delay end,
    'en_curso_vence_en', v_reto.en_curso_vence_en,
    'mi_cierre_confirmado', case when v_soy_challenger then v_reto.challenger_cierre_confirmado else v_reto.challenged_cierre_confirmado end,
    'cierre_confirmado_rival', case when v_soy_challenger then v_reto.challenged_cierre_confirmado else v_reto.challenger_cierre_confirmado end,
    'roster_elegible', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jugador_id', re.jugador_id,
        'nombre', coalesce(p.nick, 'Jugador de RemorApp') || (case when p.nick is not null then '#' || p.unique_id else '' end),
        'es_mercenario', re.es_mercenario,
        'es_aliado', re.es_aliado
      ))
      from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) re
      join public.profiles p on p.id = re.jugador_id
    ), '[]'::jsonb),
    'temporales_propios', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'nick_temporal', t.nick_temporal))
      from public.team_temp_players t
      where t.team_id = v_mi_team_id and t.reemplazado_por is null
    ), '[]'::jsonb),
    'lineup_propio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'nombre', coalesce(
          (select coalesce(pr.nick, 'Jugador de RemorApp') || (case when pr.nick is not null then '#' || pr.unique_id else '' end) from public.profiles pr where pr.id = l.jugador_id),
          (select tp.nick_temporal from public.team_temp_players tp where tp.id = l.jugador_temporal_id)
        ),
        'posicion', l.posicion,
        'es_temporal', l.jugador_temporal_id is not null,
        'es_suplente', l.es_suplente,
        'link_verificacion', l.link_verificacion
      ) order by l.posicion nulls last)
      from public.clan_war_lineup l
      where l.clan_war_id = p_clan_war_id and l.team_id = v_mi_team_id
    ), '[]'::jsonb),
    'lineup_rival', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', l.posicion,
        'es_suplente', l.es_suplente,
        'nombre', case when v_revelado then coalesce(
          (select coalesce(pr.nick, 'Jugador de RemorApp') || (case when pr.nick is not null then '#' || pr.unique_id else '' end) from public.profiles pr where pr.id = l.jugador_id),
          (select tp.nick_temporal from public.team_temp_players tp where tp.id = l.jugador_temporal_id)
        ) else null end,
        'es_temporal', case when v_revelado then l.jugador_temporal_id is not null else null end,
        'link_verificacion', case when v_revelado then l.link_verificacion else null end
      ) order by l.posicion nulls last)
      from public.clan_war_lineup l
      where l.clan_war_id = p_clan_war_id and l.team_id = v_rival_team_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

grant execute on function public.lineup_editor_clan_war(uuid) to authenticated;
