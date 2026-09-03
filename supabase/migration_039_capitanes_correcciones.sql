-- ============================================================
-- Migración 039: correcciones al rol de Capitán (migración 038) +
-- nuevas delegaciones + valores iniciales.
--
-- 1) quitar_miembro(): un capitán ya no puede expulsar a OTRO
--    capitán -- eso queda exclusivo del dueño real. Sigue pudiendo
--    expulsar a cualquier jugador sin el rol.
-- 2) Delegación nueva a capitanes: investigar_jugador(),
--    proponer_titulo_padre_hijo()/responder_titulo_padre_hijo()
--    (rama "clan"), y la política de SELECT de team_kicks_log
--    ("Jugadores expulsados").
-- 3) Valores iniciales: profiles.valentia_jugador, teams.valentia y
--    profiles.carisma pasan a nacer en 100 en vez de 50 -- SOLO el
--    default de la columna, sin tocar las filas que ya existen.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) quitar_miembro(): un capitán no puede expulsar a otro capitán.
-- ------------------------------------------------------------
create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_objetivo_es_capitan boolean;
  v_entrada_en timestamptz;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
  end if;

  if p_user_id = v_owner_id then
    raise exception 'No se puede quitar al dueño del equipo.';
  end if;

  -- Migración 039: un capitán puede expulsar a un jugador normal,
  -- pero no a OTRO capitán -- eso queda exclusivo del dueño real.
  select es_capitan into v_objetivo_es_capitan
  from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  if v_objetivo_es_capitan and auth.uid() <> v_owner_id then
    raise exception 'Solo el dueño del equipo puede expulsar a un capitán.';
  end if;

  select joined_at into v_entrada_en
  from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
  values (p_team_id, p_user_id, auth.uid(), 'expulsado', v_entrada_en);

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- 2) Delegación nueva a capitanes
-- ------------------------------------------------------------

-- investigar_jugador(): dueño de cualquier equipo O capitán de
-- cualquier equipo (la función no recibe team_id -- es un permiso
-- general de "sos líder de algún equipo", no de un equipo puntual).
create or replace function public.investigar_jugador(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puede_investigar boolean;
  v_resultado jsonb;
begin
  select
    exists (select 1 from public.teams where owner_id = auth.uid())
    or exists (select 1 from public.team_members where user_id = auth.uid() and es_capitan)
    or public.is_admin()
    into v_puede_investigar;

  if not v_puede_investigar then
    raise exception 'No tienes permiso para investigar jugadores.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  select jsonb_build_object(
    'identidad', (
      select jsonb_build_object(
        'id', p.id,
        'nick', p.nick,
        'unique_id', p.unique_id,
        'suspendido', p.suspendido,
        'poco_confiable', p.poco_confiable,
        'valentia_jugador', p.valentia_jugador,
        'responsabilidad_cw', p.responsabilidad_cw,
        'responsabilidad_torneos', p.responsabilidad_torneos,
        'liga_1v1', p.liga_1v1
      )
      from public.profiles p
      where p.id = p_user_id
    ),
    'historial_nicks', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('nick_anterior', nh.nick_anterior, 'cambiado_en', nh.cambiado_en)
          order by nh.cambiado_en desc
        ),
        '[]'::jsonb
      )
      from public.nick_history nh
      where nh.user_id = p_user_id
    ),
    'historial_equipos', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', team_id, 'nombre', nombre, 'tag', tag,
            'entrada_en', entrada_en, 'salida_en', salida_en, 'motivo_salida', motivo_salida
          )
          order by entrada_en desc nulls last
        ),
        '[]'::jsonb
      )
      from (
        select t.id as team_id, t.name as nombre, t.tag as tag, tm.joined_at as entrada_en,
               null::timestamptz as salida_en, null::text as motivo_salida
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where tm.user_id = p_user_id

        union all

        select t.id, t.name, t.tag, tkl.entrada_en, tkl.kicked_at, tkl.motivo
        from public.team_kicks_log tkl
        join public.teams t on t.id = tkl.team_id
        where tkl.user_id = p_user_id
      ) historial
    ),
    'reportes_no_presentado', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'clan_war_id', cwr.clan_war_id,
            'reportado_por_nombre', rt.name || ' [' || rt.tag || ']',
            'created_at', cwr.created_at
          )
          order by cwr.created_at desc
        ),
        '[]'::jsonb
      )
      from public.clan_war_reportes cwr
      join public.teams rt on rt.id = cwr.reportado_por
      where cwr.jugador_afectado_id = p_user_id and cwr.motivo = 'no_se_presento'
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

-- ------------------------------------------------------------
-- Títulos Padre/Hijo entre clanes: rama "clan" ahora acepta también a
-- un capitán, no solo al dueño.
-- ------------------------------------------------------------

drop policy if exists "titulos_padre_hijo_select_propio" on public.titulos_padre_hijo;
create policy "titulos_padre_hijo_select_propio"
  on public.titulos_padre_hijo for select
  to authenticated
  using (
    (tipo = 'jugador' and (retador_id = auth.uid() or retado_id = auth.uid()))
    or (tipo = 'clan' and (
      public.es_capitan_o_dueno(retador_id) or public.es_capitan_o_dueno(retado_id)
    ))
  );

create or replace function public.proponer_titulo_padre_hijo(
  p_tipo text,
  p_retado_id uuid,
  p_duracion_dias integer,
  p_caster_nombre text default null,
  p_caster_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retador_id uuid;
begin
  if p_tipo not in ('clan', 'jugador') then
    raise exception 'Ese tipo de título no es válido.';
  end if;

  if p_duracion_dias < 7 or p_duracion_dias > 90 then
    raise exception 'La duración tiene que ser entre 7 y 90 días.';
  end if;

  if p_tipo = 'clan' then
    -- Migración 039: dueño o capitán, ya no solo dueño.
    select t.id into v_retador_id
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    where tm.user_id = auth.uid()
      and (t.owner_id = auth.uid() or tm.es_capitan)
      and not t.disuelto;

    if v_retador_id is null then
      raise exception 'No eres dueño ni capitán de ningún equipo.';
    end if;
    if not exists (select 1 from public.teams where id = p_retado_id) then
      raise exception 'Ese equipo no existe.';
    end if;
  else
    v_retador_id := auth.uid();
    if not exists (select 1 from public.profiles where id = p_retado_id) then
      raise exception 'Ese jugador no existe.';
    end if;
    if p_caster_nombre is null or trim(p_caster_nombre) = '' then
      raise exception 'El caster es obligatorio para un título entre jugadores.';
    end if;
    if p_caster_link is null or trim(p_caster_link) = '' then
      raise exception 'El link del caster es obligatorio para un título entre jugadores.';
    end if;
  end if;

  if v_retador_id = p_retado_id then
    raise exception 'No puedes retarte a ti mismo.';
  end if;

  insert into public.titulos_padre_hijo (
    tipo, retador_id, retado_id, duracion_dias, caster_nombre, caster_link
  ) values (
    p_tipo, v_retador_id, p_retado_id, p_duracion_dias,
    case when p_tipo = 'jugador' then p_caster_nombre else null end,
    case when p_tipo = 'jugador' then p_caster_link else null end
  );
end;
$$;

create or replace function public.responder_titulo_padre_hijo(p_titulo_id uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo record;
  v_soy_retado boolean;
begin
  select * into v_titulo from public.titulos_padre_hijo where id = p_titulo_id for update;
  if v_titulo is null then
    raise exception 'Ese título no existe.';
  end if;

  if v_titulo.status <> 'pendiente' or v_titulo.aceptado then
    raise exception 'Este título ya fue respondido.';
  end if;

  if v_titulo.tipo = 'clan' then
    -- Migración 039: dueño o capitán del equipo retado.
    v_soy_retado := public.es_capitan_o_dueno(v_titulo.retado_id);
  else
    v_soy_retado := (v_titulo.retado_id = auth.uid());
  end if;

  if not v_soy_retado then
    raise exception 'Solo el retado puede responder este título.';
  end if;

  if p_aceptar then
    update public.titulos_padre_hijo set aceptado = true where id = p_titulo_id;
  else
    update public.titulos_padre_hijo set status = 'rechazado' where id = p_titulo_id;
  end if;
end;
$$;

-- "Jugadores expulsados" (team_kicks_log): visible también para
-- capitanes, no solo para el dueño.
drop policy if exists "team_kicks_log_select_propio" on public.team_kicks_log;
create policy "team_kicks_log_select_propio"
  on public.team_kicks_log for select
  to authenticated
  using (public.es_capitan_o_dueno(team_id));

-- ------------------------------------------------------------
-- 3) Valores iniciales: nacen en 100, no en 50. Solo el default de la
--    columna -- las filas que ya existen se quedan como están.
-- ------------------------------------------------------------
alter table public.profiles alter column valentia_jugador set default 100;
alter table public.teams alter column valentia set default 100;
alter table public.profiles alter column carisma set default 100;
