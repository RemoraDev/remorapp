-- ============================================================
-- Migración 042: formato WTL/chino para Clan Wars -- 3 sets Bo2 en
-- posiciones fijas, con ACE si el marcador global de mapas queda 3-3.
--
-- 1) clan_wars.formato ('simple' default / 'wtl'): el formato que ya
--    existe (clan_war_matches, agregar_partida_cw, reportar_partida_cw)
--    queda intacto y sigue siendo el default -- WTL es un modo
--    alternativo, no un reemplazo.
-- 2) Dos columnas que el pedido no nombró, pero que hacen falta para
--    que el resto funcione, disclosuadas acá:
--    - clan_war_lineup.posicion: el lineup ya existía, pero no tenía
--      ningún concepto de orden -- sin esto, armar_lineup_cw() no
--      puede pedir "posición 1/2/3" como se pidió en el punto 2.
--    - clan_wars.ace_ganador_id: el pedido definió ace_challenger_id/
--      ace_challenged_id (QUIÉN es cada ACE) pero no una columna para
--      guardar quién ganó el mapa decisivo -- sin eso,
--      cerrar_clan_war() no podría saber "el resultado del ACE" como
--      pide el punto 5.
-- 3) clan_war_wtl_sets: los 3 sets (posición 1/2/3) se generan solos,
--    apenas la guerra pasa a 'en_curso' (intentar_iniciar_clan_war()),
--    emparejando la posición N del lineup de un lado contra la
--    posición N del otro. Por eso el lineup en formato WTL exige
--    jugadores REALES (no temporales) con posición: el esquema pedido
--    para clan_war_wtl_sets tiene jugador_challenger_id/
--    jugador_challenged_id como una sola columna cada uno (no el par
--    jugador_id/jugador_temporal_id que sí tiene clan_war_lineup para
--    el formato simple), así que no hay dónde guardar un jugador
--    temporal ahí -- se disclosea como una restricción real, no un
--    descuido.
-- 4) reportar_mapa_wtl(): un mapa a la vez (hasta 2 por set, Bo2 real
--    -- los dos mapas siempre se juegan, así que un set termina 2-0 o
--    1-1, nunca en 1). Ajusta mmr_equipos por cada mapa, como se pidió
--    -- NO toca valentia_jugador ni responsabilidad_cw (el pedido solo
--    mencionó mmr_equipos "por cada mapa"; esas otras dos estadísticas
--    quedan fuera del formato WTL por ahora, es una decisión a
--    confirmar, no un olvido).
-- 5) designar_ace_wtl() + reportar_mapa_ace_wtl(): solo se pueden usar
--    cuando el marcador global quedó exactamente 3-3 con los 3 sets
--    jugados.
-- 6) cerrar_clan_war() (la misma función, extendida): en formato WTL
--    el ganador sale del marcador global de mapas (o del ACE si hubo
--    empate) en vez de contar partidas ganadas -- exige que los 3
--    sets estén jugados, y si hay empate 3-3, exige que el ACE ya
--    tenga resultado antes de cerrar.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas en clan_wars
-- ------------------------------------------------------------
alter table public.clan_wars add column if not exists formato text not null default 'simple'
  check (formato in ('simple', 'wtl'));
alter table public.clan_wars add column if not exists ace_challenger_id uuid references public.profiles (id);
alter table public.clan_wars add column if not exists ace_challenged_id uuid references public.profiles (id);
-- Ver punto 2 del comentario de arriba -- necesaria para que
-- cerrar_clan_war() pueda leer "el resultado del ACE".
alter table public.clan_wars add column if not exists ace_ganador_id uuid references public.profiles (id);
alter table public.clan_wars add column if not exists resultado_mapas_challenger integer not null default 0;
alter table public.clan_wars add column if not exists resultado_mapas_challenged integer not null default 0;

-- ------------------------------------------------------------
-- 2) Posición en el lineup (ver punto 2 del comentario de arriba).
--    Nullable a propósito: en formato 'simple' el lineup sigue sin
--    orden, como siempre -- varios NULL no chocan contra el unique.
-- ------------------------------------------------------------
alter table public.clan_war_lineup add column if not exists posicion integer
  check (posicion is null or posicion in (1, 2, 3));

alter table public.clan_war_lineup
  add constraint clan_war_lineup_posicion_unica unique (clan_war_id, team_id, posicion);

-- ------------------------------------------------------------
-- 3) clan_war_wtl_sets
-- ------------------------------------------------------------
create table public.clan_war_wtl_sets (
  id uuid primary key default gen_random_uuid(),
  clan_war_id uuid not null references public.clan_wars (id) on delete cascade,
  posicion integer not null check (posicion in (1, 2, 3)),
  jugador_challenger_id uuid not null references public.profiles (id),
  jugador_challenged_id uuid not null references public.profiles (id),
  mapas_ganados_challenger integer not null default 0,
  mapas_ganados_challenged integer not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente', 'jugado')),
  unique (clan_war_id, posicion),
  check (jugador_challenger_id <> jugador_challenged_id)
);

alter table public.clan_war_wtl_sets enable row level security;

create policy "clan_war_wtl_sets_select_propio"
  on public.clan_war_wtl_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (public.es_capitan_o_dueno(cw.challenger_team_id) or public.es_capitan_o_dueno(cw.challenged_team_id))
    )
  );

-- Sin política de insert/update para authenticated a propósito -- los
-- sets se generan solos desde intentar_iniciar_clan_war(), y se
-- actualizan desde reportar_mapa_wtl(), las dos security definer.
grant select on public.clan_war_wtl_sets to authenticated;

-- ------------------------------------------------------------
-- armar_lineup_cw(): pide posición cuando el formato es 'wtl'.
--
-- CREATE OR REPLACE no alcanza acá: agregar un parámetro nuevo al
-- final (aunque tenga default) cambia la firma de la función para
-- Postgres, así que en vez de reemplazarla crearía una SEGUNDA
-- función superpuesta (misma firma de siempre + la nueva de 7
-- parámetros) -- y PostgREST no sabría cuál de las dos usar al
-- llamarla por nombre desde el cliente. Se borra la versión vieja
-- primero para que quede una sola.
-- ------------------------------------------------------------
drop function if exists public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid);

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null
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
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El lineup solo se arma después de aceptar el reto.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
    v_soy_challenger := true;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
    v_soy_challenger := false;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede armar el lineup.';
  end if;

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' then
      if p_jugador_id is null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;
      if p_jugador_temporal_id is not null then
        raise exception 'En formato WTL el lineup solo admite jugadores reales, no temporales.';
      end if;
      if p_posicion is null or p_posicion not in (1, 2, 3) then
        raise exception 'En formato WTL hay que indicar la posición (1, 2 o 3) de cada jugador.';
      end if;
      if exists (
        select 1 from public.clan_war_lineup
        where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion = p_posicion
      ) then
        raise exception 'Ya asignaste esa posición a otro jugador.';
      end if;
    else
      if (p_jugador_id is null) = (p_jugador_temporal_id is null) then
        raise exception 'Tiene que ser un jugador real o uno temporal, nunca los dos ni ninguno.';
      end if;
    end if;

    if p_jugador_id is not null and not exists (
      select 1 from public.team_members where team_id = v_mi_team_id and user_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de tu equipo.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de tu equipo.';
    end if;

    insert into public.clan_war_lineup (
      clan_war_id, team_id, jugador_id, jugador_temporal_id, link_verificacion, agregado_por, posicion
    )
    values (
      p_clan_war_id, v_mi_team_id, p_jugador_id, p_jugador_temporal_id, p_link_verificacion, auth.uid(),
      case when v_reto.formato = 'wtl' then p_posicion else null end
    );

  elsif p_accion = 'quitar' then
    if p_lineup_id is null then
      raise exception 'Falta indicar qué fila del lineup quitar.';
    end if;

    delete from public.clan_war_lineup
    where id = p_lineup_id and clan_war_id = p_clan_war_id and team_id = v_mi_team_id;

    if not found then
      raise exception 'Esa fila del lineup no existe o no es de tu equipo.';
    end if;

  else
    raise exception 'Acción inválida: tiene que ser agregar o quitar.';
  end if;

  -- Cualquier cambio en el lineup resetea el visto bueno (y quién lo
  -- dio) del lado que lo cambió -- hay que volver a confirmarlo.
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

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- confirmar_lineup_cw(): en formato WTL exige que el lineup del lado
-- que confirma tenga exactamente 3 jugadores, en las 3 posiciones.
-- ------------------------------------------------------------
create or replace function public.confirmar_lineup_cw(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_mi_team_id uuid;
  v_posiciones_completas boolean;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede confirmar el lineup.';
  end if;

  if v_reto.formato = 'wtl' then
    select (count(distinct posicion) = 3) into v_posiciones_completas
    from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion is not null;

    if not v_posiciones_completas then
      raise exception 'En formato WTL el lineup necesita exactamente 3 jugadores, en las posiciones 1, 2 y 3.';
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

-- ------------------------------------------------------------
-- intentar_iniciar_clan_war(): al pasar a 'en_curso', si el formato es
-- 'wtl', genera los 3 sets emparejando posición por posición.
-- ------------------------------------------------------------
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
    update public.clan_wars set status = 'en_curso' where id = p_clan_war_id;

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

-- ------------------------------------------------------------
-- 4) reportar_mapa_wtl(): un mapa del Bo2 de un set. Bo2 real -- los
--    dos mapas siempre se juegan (2-0 o 1-1), nunca corta en 1.
-- ------------------------------------------------------------
create or replace function public.reportar_mapa_wtl(p_set_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_gano_challenger boolean;
  v_total_mapas int;
begin
  select * into v_set from public.clan_war_wtl_sets where id = p_set_id for update;
  if v_set is null then
    raise exception 'Ese set no existe.';
  end if;
  if v_set.status = 'jugado' then
    raise exception 'Este set ya jugó sus 2 mapas.';
  end if;

  select * into v_reto from public.clan_wars where id = v_set.clan_war_id;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_set.jugador_challenger_id and p_ganador_id <> v_set.jugador_challenged_id then
    raise exception 'Ese jugador no juega este set.';
  end if;

  v_gano_challenger := (p_ganador_id = v_set.jugador_challenger_id);
  v_perdedor_id := case when v_gano_challenger then v_set.jugador_challenged_id else v_set.jugador_challenger_id end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;
  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  if v_gano_challenger then
    update public.clan_war_wtl_sets set mapas_ganados_challenger = mapas_ganados_challenger + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenger = resultado_mapas_challenger + 1 where id = v_set.clan_war_id;
  else
    update public.clan_war_wtl_sets set mapas_ganados_challenged = mapas_ganados_challenged + 1 where id = p_set_id;
    update public.clan_wars set resultado_mapas_challenged = resultado_mapas_challenged + 1 where id = v_set.clan_war_id;
  end if;

  select mapas_ganados_challenger + mapas_ganados_challenged into v_total_mapas
  from public.clan_war_wtl_sets where id = p_set_id;

  if v_total_mapas >= 2 then
    update public.clan_war_wtl_sets set status = 'jugado' where id = p_set_id;
  end if;
end;
$$;

grant execute on function public.reportar_mapa_wtl(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) designar_ace_wtl() + reportar_mapa_ace_wtl()
-- ------------------------------------------------------------
create or replace function public.designar_ace_wtl(p_clan_war_id uuid, p_jugador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_mi_team_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;
  if v_reto.formato <> 'wtl' then
    raise exception 'Esta guerra no usa el formato WTL.';
  end if;

  if public.es_capitan_o_dueno(v_reto.challenger_team_id) then
    v_soy_challenger := true;
    v_mi_team_id := v_reto.challenger_team_id;
  elsif public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    v_soy_challenger := false;
    v_mi_team_id := v_reto.challenged_team_id;
  else
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if exists (
    select 1 from public.clan_war_wtl_sets where clan_war_id = p_clan_war_id and status <> 'jugado'
  ) then
    raise exception 'Todavía faltan sets por jugarse.';
  end if;

  if v_reto.resultado_mapas_challenger <> v_reto.resultado_mapas_challenged then
    raise exception 'El marcador global no está empatado -- no hace falta designar un ACE.';
  end if;

  if not exists (
    select 1 from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and jugador_id = p_jugador_id
  ) then
    raise exception 'Ese jugador no es parte de tu lineup en esta guerra.';
  end if;

  if v_soy_challenger then
    update public.clan_wars set ace_challenger_id = p_jugador_id where id = p_clan_war_id;
  else
    update public.clan_wars set ace_challenged_id = p_jugador_id where id = p_clan_war_id;
  end if;
end;
$$;

grant execute on function public.designar_ace_wtl(uuid, uuid) to authenticated;

create or replace function public.reportar_mapa_ace_wtl(p_clan_war_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;
  if v_reto.formato <> 'wtl' then
    raise exception 'Esta guerra no usa el formato WTL.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.ace_challenger_id is null or v_reto.ace_challenged_id is null then
    raise exception 'Todavía falta que los dos equipos designen a su ACE.';
  end if;
  if v_reto.ace_ganador_id is not null then
    raise exception 'El mapa decisivo del ACE ya tiene resultado.';
  end if;
  if p_ganador_id <> v_reto.ace_challenger_id and p_ganador_id <> v_reto.ace_challenged_id then
    raise exception 'Ese jugador no es ninguno de los dos ACE.';
  end if;

  v_perdedor_id := case when p_ganador_id = v_reto.ace_challenger_id then v_reto.ace_challenged_id else v_reto.ace_challenger_id end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;
  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  update public.clan_wars set ace_ganador_id = p_ganador_id where id = p_clan_war_id;
end;
$$;

grant execute on function public.reportar_mapa_ace_wtl(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- agregar_partida_cw() / reportar_partida_cw(): bloqueadas en formato
-- WTL -- ese formato usa clan_war_wtl_sets + reportar_mapa_wtl(), no
-- clan_war_matches.
-- ------------------------------------------------------------
create or replace function public.agregar_partida_cw(
  p_clan_war_id uuid,
  p_jugador_challenger_id uuid,
  p_jugador_challenged_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.formato <> 'simple' then
    raise exception 'Esta guerra usa el formato WTL -- los partidos se registran con reportar_mapa_wtl().';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra todavía no está en curso.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenger_team_id and user_id = p_jugador_challenger_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiante.';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = v_reto.challenged_team_id and user_id = p_jugador_challenged_id
  ) then
    raise exception 'Ese jugador no pertenece al roster del equipo desafiado.';
  end if;

  insert into public.clan_war_matches (clan_war_id, jugador_challenger_id, jugador_challenged_id)
  values (p_clan_war_id, p_jugador_challenger_id, p_jugador_challenged_id);
end;
$$;

create or replace function public.reportar_partida_cw(p_match_id uuid, p_ganador_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_reto record;
  v_perdedor_id uuid;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
begin
  select * into v_match from public.clan_war_matches where id = p_match_id for update;
  if v_match is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_match.status <> 'pendiente' then
    raise exception 'Esta partida ya tiene resultado.';
  end if;

  select * into v_reto from public.clan_wars where id = v_match.clan_war_id;

  if v_reto.formato <> 'simple' then
    raise exception 'Esta guerra usa el formato WTL -- los partidos se registran con reportar_mapa_wtl().';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if p_ganador_id <> v_match.jugador_challenger_id and p_ganador_id <> v_match.jugador_challenged_id then
    raise exception 'Ese jugador no juega esta partida.';
  end if;

  v_perdedor_id := case
    when p_ganador_id = v_match.jugador_challenger_id then v_match.jugador_challenged_id
    else v_match.jugador_challenger_id
  end;

  select mmr_equipos into v_mmr_ganador from public.profiles where id = p_ganador_id;
  select mmr_equipos into v_mmr_perdedor from public.profiles where id = v_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_ganador)
    where id = p_ganador_id;
  update public.profiles
    set mmr_equipos = greatest(500, mmr_equipos + v_ajuste.ajuste_perdedor)
    where id = v_perdedor_id;

  update public.profiles
    set valentia_jugador = greatest(0, least(100, valentia_jugador + 1))
    where id in (v_match.jugador_challenger_id, v_match.jugador_challenged_id);

  if v_reto.challenger_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenger_id;
  end if;
  if v_reto.challenged_confirmado then
    update public.profiles
      set responsabilidad_cw = greatest(0, least(100, responsabilidad_cw + 1))
      where id = v_match.jugador_challenged_id;
  end if;

  update public.clan_war_matches
    set ganador_id = p_ganador_id, status = 'jugado'
    where id = p_match_id;
end;
$$;

-- ------------------------------------------------------------
-- 6) cerrar_clan_war(): reconoce el formato.
-- ------------------------------------------------------------
create or replace function public.cerrar_clan_war(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
  v_soy_challenger boolean;
  v_soy_challenged boolean;
  v_ganadas_challenger int;
  v_ganadas_challenged int;
  v_mmr_ganador int;
  v_mmr_perdedor int;
  v_ajuste record;
  v_team_ganador_id uuid;
  v_team_perdedor_id uuid;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Esa guerra no existe.';
  end if;

  if v_reto.status <> 'en_curso' then
    raise exception 'Esta guerra no está en curso.';
  end if;

  v_soy_challenger := public.es_capitan_o_dueno(v_reto.challenger_team_id);
  v_soy_challenged := public.es_capitan_o_dueno(v_reto.challenged_team_id);

  if not v_soy_challenger and not v_soy_challenged then
    raise exception 'No eres dueño ni capitán de ninguno de los dos equipos de esta guerra.';
  end if;

  if v_reto.formato = 'wtl' then
    if exists (
      select 1 from public.clan_war_wtl_sets where clan_war_id = p_clan_war_id and status <> 'jugado'
    ) then
      raise exception 'Todavía faltan sets de la Clan War por jugarse.';
    end if;
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged
       and v_reto.ace_ganador_id is null
    then
      raise exception 'El marcador global quedó empatado -- todavía falta jugar el mapa decisivo del ACE.';
    end if;
  end if;

  if v_soy_challenger then
    update public.clan_wars set challenger_cierre_confirmado = true where id = p_clan_war_id;
  else
    update public.clan_wars set challenged_cierre_confirmado = true where id = p_clan_war_id;
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id;
  if not (v_reto.challenger_cierre_confirmado and v_reto.challenged_cierre_confirmado) then
    -- Falta que confirme el otro capitán -- todavía no se cierra.
    return;
  end if;

  if v_reto.formato = 'wtl' then
    if v_reto.resultado_mapas_challenger = v_reto.resultado_mapas_challenged then
      -- Ya se validó arriba que el ACE tiene resultado.
      if v_reto.ace_ganador_id = v_reto.ace_challenger_id then
        v_team_ganador_id := v_reto.challenger_team_id;
        v_team_perdedor_id := v_reto.challenged_team_id;
      else
        v_team_ganador_id := v_reto.challenged_team_id;
        v_team_perdedor_id := v_reto.challenger_team_id;
      end if;
    elsif v_reto.resultado_mapas_challenger > v_reto.resultado_mapas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  else
    select count(*) into v_ganadas_challenger
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenger_id;

    select count(*) into v_ganadas_challenged
    from public.clan_war_matches
    where clan_war_id = p_clan_war_id and status = 'jugado' and ganador_id = jugador_challenged_id;

    if v_ganadas_challenger = v_ganadas_challenged then
      update public.clan_wars set status = 'empatada' where id = p_clan_war_id;
      return;
    end if;

    if v_ganadas_challenger > v_ganadas_challenged then
      v_team_ganador_id := v_reto.challenger_team_id;
      v_team_perdedor_id := v_reto.challenged_team_id;
    else
      v_team_ganador_id := v_reto.challenged_team_id;
      v_team_perdedor_id := v_reto.challenger_team_id;
    end if;
  end if;

  select mmr into v_mmr_ganador from public.teams where id = v_team_ganador_id;
  select mmr into v_mmr_perdedor from public.teams where id = v_team_perdedor_id;

  select * into v_ajuste from public.calcular_ajuste_mmr(v_mmr_ganador, v_mmr_perdedor);

  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_ganador) where id = v_team_ganador_id;
  update public.teams set mmr = greatest(500, mmr + v_ajuste.ajuste_perdedor) where id = v_team_perdedor_id;

  update public.clan_wars
    set status = 'finalizada', ganador_team_id = v_team_ganador_id
    where id = p_clan_war_id;

  update public.titulos_padre_hijo
    set status = 'activo',
        ganador_id = v_team_ganador_id,
        fecha_inicio = now(),
        fecha_fin = now() + (duracion_dias || ' days')::interval
    where tipo = 'clan'
      and aceptado = true
      and status = 'pendiente'
      and (
        (retador_id = v_reto.challenger_team_id and retado_id = v_reto.challenged_team_id)
        or (retador_id = v_reto.challenged_team_id and retado_id = v_reto.challenger_team_id)
      );
end;
$$;
