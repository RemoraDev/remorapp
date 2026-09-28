-- Migración 136: el plazo de edición del lineup (30 minutos antes de
-- la hora del reto, o una extensión aprobada) es para coordinar la
-- revelación simultánea en Clan Wars DE TORNEO -- una Clan War
-- amistosa (sin torneo detrás) ya podía cambiar la cantidad de
-- jugadores por lado en cualquier momento (cambiar_jugadores_por_set_cw,
-- migración 093), así que armar_lineup_cw() tiene que seguir el mismo
-- criterio: agregar/quitar jugadores del lineup nunca debería
-- bloquearse por plazo en una amistosa.
--
-- No se toca plazo_edicion_lineup_cw() en sí -- revelado_lineup_cw()
-- también lo usa para forzar la revelación del lineup si alguno de los
-- dos capitanes nunca da el visto bueno, y esa protección sí tiene que
-- seguir aplicando en amistosas (si no, el lineup podría quedar oculto
-- para siempre). El cambio es puntual, solo en el chequeo de
-- armar_lineup_cw().

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null,
  p_team_id_como_admin uuid default null,
  p_es_suplente boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_soy_challenger boolean;
  v_rangos jsonb;
  v_rango record;
  v_mmr_jugador int;
  v_jugadores_por_set int;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if p_team_id_como_admin is not null then
    if not public.es_dueno_plataforma() then
      raise exception 'Solo el dueño de la plataforma puede intervenir el lineup en nombre de un equipo.';
    end if;
    if p_team_id_como_admin not in (v_reto.challenger_team_id, v_reto.challenged_team_id) then
      raise exception 'Ese equipo no participa en esta Clan War.';
    end if;
    v_mi_team_id := p_team_id_como_admin;
    v_soy_challenger := (p_team_id_como_admin = v_reto.challenger_team_id);
    update public.clan_wars set intervenido_por_admin = true where id = p_clan_war_id;
    perform public.registrar_actividad_dueno(
      'intervenir_lineup_cw',
      'clan_war_id=' || p_clan_war_id::text || ' team_id=' || p_team_id_como_admin::text || ' accion=' || p_accion
    );
  elsif public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  -- Corrección (migración 136): el plazo solo aplica cuando hay un
  -- torneo detrás -- una Clan War amistosa se puede editar sin límite
  -- de tiempo, igual que la cantidad de jugadores por lado.
  if p_team_id_como_admin is null
     and (select t.id from public.torneo_de_clan_war(p_clan_war_id) t) is not null
     and now() >= public.plazo_edicion_lineup_cw(p_clan_war_id)
  then
    raise exception 'El plazo para editar el lineup ya venció. Pídele al staff una extensión, o solicítasela al equipo rival desde el panel de control.';
  end if;

  if p_accion = 'agregar' then
    -- Corrección (migración 120): el bloqueo de jugadores temporales en
    -- WTL solo tiene sentido cuando hay una temporada de torneo detrás
    -- (es lo único que exige validar el MMR de equipos por posición,
    -- más abajo) -- una Clan War amistosa suelta en WTL ahora admite
    -- temporales igual que el formato simple.
    if v_reto.formato = 'wtl' and v_reto.temporada_id is not null and p_jugador_temporal_id is not null then
      raise exception 'En formato WTL, dentro de una temporada de torneo, el lineup solo admite jugadores reales, no temporales.';
    end if;

    if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
      raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
    end if;

    if v_reto.formato = 'wtl' and not p_es_suplente then
      v_jugadores_por_set := coalesce(
        (select t.jugadores_por_set from public.torneo_de_clan_war(p_clan_war_id) t),
        v_reto.jugadores_por_set,
        3
      );

      if p_posicion is null or p_posicion < 1 or p_posicion > v_jugadores_por_set then
        raise exception 'En formato WTL hay que indicar una posición entre 1 y % para esta Clan War.', v_jugadores_por_set;
      end if;
      if exists (
        select 1 from public.clan_war_lineup
        where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion = p_posicion
      ) then
        raise exception 'Ya asignaste esa posición a otro jugador.';
      end if;
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) where jugador_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de ese equipo, ni su mercenario, ni miembro de un equipo aliado para esta temporada.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de ese equipo.';
    end if;

    if v_reto.formato = 'wtl' and not p_es_suplente and v_reto.temporada_id is not null and p_jugador_id is not null then
      select rangos_mmr_por_posicion into v_rangos from public.temporadas where id = v_reto.temporada_id;

      if v_rangos is not null then
        select (elem->>'mmr_min')::int as mmr_min, (elem->>'mmr_max')::int as mmr_max
          into v_rango
          from jsonb_array_elements(v_rangos) as elem
          where (elem->>'posicion')::int = p_posicion;

        if v_rango is not null then
          select mmr_equipos into v_mmr_jugador from public.profiles where id = p_jugador_id;

          if v_mmr_jugador < v_rango.mmr_min or v_mmr_jugador > v_rango.mmr_max then
            raise exception 'El jugador para la posición % debe tener entre % y % de MMR de equipos (tiene %).',
              p_posicion, v_rango.mmr_min, v_rango.mmr_max, v_mmr_jugador;
          end if;
        end if;
      end if;
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por, posicion, es_suplente
    )
    values (
      p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid(),
      case when v_reto.formato = 'wtl' and not p_es_suplente then p_posicion else null end,
      p_es_suplente
    );

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de ese equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  if v_soy_challenger then
    update public.clan_wars
      set lineup_visto_bueno_challenger = false,
          visto_bueno_dado_por_challenger = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  else
    update public.clan_wars
      set lineup_visto_bueno_challenged = false,
          visto_bueno_dado_por_challenged = null,
          check_in_abierto = false
      where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid, boolean) to authenticated;
