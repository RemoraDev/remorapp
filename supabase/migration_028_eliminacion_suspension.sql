-- ============================================================
-- Migración 028: eliminación definitiva de equipos, torneos vacíos
-- tras abandono del creador, y suspensión administrada (con motivo,
-- quién y cuándo).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Diagnóstico de "sigo viendo el equipo disuelto": no era
--    obtenerEquipoDelUsuario() (esa consulta va por team_members, que
--    salir_equipo() ya borra bien). El problema real es que
--    TeamDetailPage.tsx no distinguía un equipo disuelto de uno vivo
--    -- lo mostraba entero, con Panel de control y todo, porque
--    equipo.owner_id nunca se limpia al disolverse. Lo mismo pasaba
--    en proponer_clan_war()/proponer_titulo_padre_hijo(): buscaban
--    "mi equipo" con "teams where owner_id = auth.uid()" sin excluir
--    disuelto, así que un ex-dueño podía seguir proponiendo retos
--    como si el equipo siguiera vivo. La corrección del frontend va
--    en TeamDetailPage.tsx; acá van las dos funciones.
-- ------------------------------------------------------------
create or replace function public.proponer_clan_war(p_challenged_team_id uuid, p_fecha_hora_cet timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
begin
  select * into v_challenger from public.teams where owner_id = auth.uid() and not disuelto;
  if v_challenger is null then
    raise exception 'No eres dueño de ningún equipo.';
  end if;

  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
  end if;
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet);
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz) to authenticated;

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
    select id into v_retador_id from public.teams where owner_id = auth.uid() and not disuelto;
    if v_retador_id is null then
      raise exception 'No eres dueño de ningún equipo.';
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

grant execute on function public.proponer_titulo_padre_hijo(text, uuid, integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- 2) eliminar_equipo_definitivo(): solo el dueño (o un admin, para
--    /admin) -- y solo si el equipo ya está disuelto, o si no tiene
--    otros miembros además del dueño. team_members, team_invitations
--    y team_kicks_log caen en cascada solos (on delete cascade).
--    clan_wars/tournament_participants NO tienen cascade a propósito
--    -- si el equipo tiene historial de Clan Wars o de torneos, la
--    eliminación se bloquea para no perder esa historia.
--    titulos_padre_hijo no tiene foreign key (es polimórfica) así que
--    se limpia a mano antes de borrar.
-- ------------------------------------------------------------
create or replace function public.eliminar_equipo_definitivo(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_otros_miembros int;
begin
  select * into v_team from public.teams where id = p_team_id for update;
  if v_team is null then
    raise exception 'Ese equipo no existe.';
  end if;

  if v_team.owner_id <> auth.uid() and not public.is_admin() then
    raise exception 'No tienes permiso para eliminar este equipo.';
  end if;

  if not v_team.disuelto then
    select count(*) into v_otros_miembros
    from public.team_members
    where team_id = p_team_id and user_id <> v_team.owner_id;

    if v_otros_miembros > 0 then
      raise exception 'Este equipo todavía tiene otros miembros -- primero tiene que disolverse (o quedar sin otros miembros) antes de poder eliminarlo definitivamente.';
    end if;
  end if;

  if exists (
    select 1 from public.clan_wars where challenger_team_id = p_team_id or challenged_team_id = p_team_id
  ) or exists (
    select 1 from public.tournament_participants where team_id = p_team_id
  ) then
    raise exception 'Este equipo tiene historial de Clan Wars o de torneos y no se puede eliminar definitivamente -- esa historia queda protegida.';
  end if;

  delete from public.titulos_padre_hijo where tipo = 'clan' and (retador_id = p_team_id or retado_id = p_team_id);

  delete from public.teams where id = p_team_id;
end;
$$;

grant execute on function public.eliminar_equipo_definitivo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) abandonar_torneo(): si quien abandona es el propio organizador y
--    el torneo queda sin NINGÚN participante, se borra por completo
--    en vez de quedar vacío y visible -- tournament_maps,
--    tournament_results, organizer_points y bracket_matches caen en
--    cascada solos (todos con on delete cascade hacia tournaments).
--    Si queda algún otro participante, el torneo sigue existiendo tal
--    cual -- esto no cambia ese caso.
-- ------------------------------------------------------------
create or replace function public.abandonar_torneo(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participante record;
  v_torneo record;
  v_match record;
  v_rival_id uuid;
begin
  select * into v_participante
  from public.tournament_participants
  where id = p_participant_id
  for update;

  if v_participante is null then
    raise exception 'Esa inscripción no existe.';
  end if;

  if not public.es_dueno_del_participante(p_participant_id) then
    raise exception 'No tienes permiso para abandonar esta inscripción.';
  end if;

  select * into v_torneo from public.tournaments where id = v_participante.tournament_id for update;

  if v_torneo.estado = 'abierto' then
    delete from public.tournament_participants where id = p_participant_id;

    if v_torneo.creador_id = auth.uid()
       and not exists (select 1 from public.tournament_participants where tournament_id = v_torneo.id)
    then
      delete from public.tournaments where id = v_torneo.id;
    end if;

    return;
  end if;

  if v_torneo.estado = 'finalizado' then
    raise exception 'Este torneo ya terminó, no puedes abandonarlo.';
  end if;

  select * into v_match
  from public.bracket_matches
  where tournament_id = v_torneo.id
    and (participant1_id = p_participant_id or participant2_id = p_participant_id)
    and status = 'pendiente'
  for update
  limit 1;

  if v_match is null then
    raise exception 'No tienes ninguna partida pendiente en este torneo para abandonar.';
  end if;

  if v_match.participant1_id is null or v_match.participant2_id is null then
    raise exception 'Esta partida todavía no tiene rival asignado.';
  end if;

  v_rival_id := case
    when v_match.participant1_id = p_participant_id then v_match.participant2_id
    else v_match.participant1_id
  end;

  update public.bracket_matches
    set winner_id = v_rival_id, status = 'jugado'
    where id = v_match.id;

  perform public.avanzar_ganador(v_match.id);
end;
$$;

grant execute on function public.abandonar_torneo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Suspensión administrada: quién, por qué, y cuándo. No son
--    públicas (sin grant select para nadie): la única forma de
--    leerlas es admin_listar_usuarios(), y la única forma de
--    escribirlas es admin_suspender_usuario().
-- ------------------------------------------------------------
alter table public.profiles add column if not exists suspendido_por uuid references public.profiles (id);
alter table public.profiles add column if not exists suspendido_motivo text;
alter table public.profiles add column if not exists suspendido_en timestamptz;

-- suspendido sale del grant de columnas editables -- mismo motivo que
-- perfil_tipo en su momento: hace falta guardar más que un booleano
-- atómicamente, y eso solo lo puede hacer una función.
revoke update on public.profiles from authenticated;
grant update (
  nombre, es_caster, nick, country, sc2_region,
  sc2_id, liga, avatar_url
) on public.profiles to authenticated;

create or replace function public.admin_suspender_usuario(
  p_usuario_id uuid,
  p_suspender boolean,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede suspender o reactivar una cuenta.';
  end if;

  if p_suspender and (p_motivo is null or trim(p_motivo) = '') then
    raise exception 'Tienes que escribir un motivo para suspender la cuenta.';
  end if;

  if exists (select 1 from public.profiles where id = p_usuario_id and es_dueno_plataforma) then
    raise exception 'No se puede suspender al dueño de la plataforma.';
  end if;

  update public.profiles
    set suspendido = p_suspender,
        suspendido_por = case when p_suspender then auth.uid() else null end,
        suspendido_motivo = case when p_suspender then trim(p_motivo) else null end,
        suspendido_en = case when p_suspender then now() else null end
    where id = p_usuario_id;
end;
$$;

grant execute on function public.admin_suspender_usuario(uuid, boolean, text) to authenticated;

-- Postgres no deja cambiar el tipo de retorno de una función existente
-- con CREATE OR REPLACE cuando cambian las columnas de un "returns
-- table" -- hay que borrarla primero.
drop function if exists public.admin_listar_usuarios();

create or replace function public.admin_listar_usuarios()
returns table (
  id uuid,
  nick text,
  unique_id text,
  email text,
  country text,
  perfil_tipo text,
  cuenta_validada boolean,
  suspendido boolean,
  es_admin boolean,
  suspendido_por_nick text,
  suspendido_motivo text,
  suspendido_en timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado: se requiere ser administrador.';
  end if;

  return query
    select p.id, p.nick, p.unique_id, p.email, p.country, p.perfil_tipo,
           p.cuenta_validada, p.suspendido, p.es_admin,
           sp.nick, p.suspendido_motivo, p.suspendido_en
    from public.profiles p
    left join public.profiles sp on sp.id = p.suspendido_por
    order by p.creado_en desc;
end;
$$;

grant execute on function public.admin_listar_usuarios() to authenticated;
