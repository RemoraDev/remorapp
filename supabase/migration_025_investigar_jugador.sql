-- ============================================================
-- Migración 025: "Investigar jugador" -- revisar el historial
-- completo de un jugador antes de invitarlo. Solo para líderes de
-- clan (dueños de algún equipo) o administradores.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- Historial de nicks: quién se llamaba cómo antes de cambiarse el
-- nick -- se llena solo, desde proteger_es_admin() (más abajo), cada
-- vez que un update de profiles cambia el nick. Nadie la lee
-- directo (sin política de select, sin grant): la única puerta es
-- investigar_jugador().
create table public.nick_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  nick_anterior text not null,
  cambiado_en timestamptz not null default now()
);

alter table public.nick_history enable row level security;

-- Se extiende proteger_es_admin() (migración 016/017), no se duplica
-- lógica -- ya es el trigger que intercepta cada update de profiles.
-- El registro de nick_history se hace siempre que el nick cambia, sin
-- importar el camino por el que se guardó -- no es una protección de
-- seguridad como el resto de esta función, es un registro para
-- investigar_jugador().
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nick is distinct from old.nick and old.nick is not null then
    insert into public.nick_history (user_id, nick_anterior, cambiado_en)
    values (old.id, old.nick, now());
  end if;

  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;

    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    elsif new.suspendido is distinct from old.suspendido and not public.is_admin() then
      new.suspendido := old.suspendido;
    end if;
  end if;
  return new;
end;
$$;

-- team_kicks_log: entrada_en guarda team_members.joined_at antes de
-- que se pierda al borrar la fila (al salir de un equipo) -- así
-- investigar_jugador() puede mostrar el historial de equipos
-- completo, no solo la fecha de salida. Nullable: los registros de
-- antes de esta migración no lo tienen.
alter table public.team_kicks_log add column entrada_en timestamptz;

-- quitar_miembro() y salir_equipo() se extienden para guardar
-- entrada_en -- mismo patrón de siempre, no se duplica la función.
create or replace function public.quitar_miembro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_entrada_en timestamptz;
begin
  select owner_id into v_owner_id from public.teams where id = p_team_id;

  if v_owner_id is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_owner_id <> auth.uid() then
    raise exception 'Solo el dueño del equipo puede quitar miembros.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No te puedes sacar a ti mismo del equipo.';
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

grant execute on function public.quitar_miembro(uuid, uuid) to authenticated;

create or replace function public.salir_equipo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_roles text[];
  v_entrada_en timestamptz;
  v_total_miembros int;
begin
  select tm.team_id, tm.roles, tm.joined_at into v_team_id, v_roles, v_entrada_en
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'No perteneces a ningún equipo.';
  end if;

  perform 1 from public.teams where id = v_team_id for update;

  if v_roles @> array['owner']::text[] then
    select count(*) into v_total_miembros from public.team_members where team_id = v_team_id;

    if v_total_miembros > 1 then
      raise exception 'Como dueño del equipo, primero debes transferir el liderazgo a otro miembro antes de salir.';
    end if;

    insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
    values (v_team_id, auth.uid(), auth.uid(), 'renuncia', v_entrada_en);

    delete from public.team_members where user_id = auth.uid();
    update public.teams set disuelto = true where id = v_team_id;
    update public.profiles set perfil_tipo = 'jugador' where id = auth.uid();
    return;
  end if;

  insert into public.team_kicks_log (team_id, user_id, kicked_by, motivo, entrada_en)
  values (v_team_id, auth.uid(), auth.uid(), 'renuncia', v_entrada_en);

  delete from public.team_members where user_id = auth.uid();
end;
$$;

grant execute on function public.salir_equipo() to authenticated;

-- investigar_jugador(): security definer, solo dueños de algún equipo
-- o admins. Devuelve todo junto en un jsonb -- identidad, historial
-- de nicks, historial de equipos (actual + los que team_kicks_log
-- recuerda), y reportes de 'no_se_presento' en su contra.
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
  select exists (select 1 from public.teams where owner_id = auth.uid()) or public.is_admin()
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

grant execute on function public.investigar_jugador(uuid) to authenticated;
