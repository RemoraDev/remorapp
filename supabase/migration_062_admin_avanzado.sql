-- ------------------------------------------------------------
-- Migración 062: cuatro facultades nuevas para el Panel de
-- Administración, más el traslado definitivo de "Administración"
-- fuera del header (ver ProfilePage.tsx/PlayerDetailPage.tsx/
-- Header.tsx -- sin cambios de base para ese punto).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Eliminar cualquier torneo de forma permanente (exclusivo admin).
--
-- Todas las tablas dependientes de tournaments ya tienen
-- "on delete cascade" hacia tournaments (tournament_maps,
-- tournament_participants, bracket_matches, tournament_groups,
-- tournament_group_matches, tournament_group_participants,
-- temporadas) -- nunca existía antes una función que de verdad
-- llamara a un DELETE sobre tournaments, así que ese cascade nunca se
-- había ejercitado en la práctica. A diferencia de
-- eliminar_equipo_definitivo() (que protege el historial bloqueando
-- el borrado si hay Clan Wars o torneos de por medio), acá se pidió
-- explícitamente que funcione para CUALQUIER torneo, tenga o no
-- participantes -- sin esa protección.
-- ------------------------------------------------------------
create or replace function public.admin_eliminar_torneo(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar un torneo.';
  end if;

  delete from public.tournaments where id = p_tournament_id;

  if not found then
    raise exception 'Ese torneo no existe.';
  end if;
end;
$$;

grant execute on function public.admin_eliminar_torneo(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Listas negras y baja de cuenta.
--
-- correos_bloqueados: privada (solo select para is_admin()) -- no se
-- expone la lista completa a nadie más, ni siquiera a authenticated
-- en general. La verificación puntual de un correo (para /register)
-- pasa por correo_esta_bloqueado(), que solo devuelve un booleano,
-- nunca la lista.
-- ------------------------------------------------------------
create table public.correos_bloqueados (
  id uuid primary key default gen_random_uuid(),
  correo text not null unique,
  motivo text,
  bloqueado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.correos_bloqueados enable row level security;

create policy "correos_bloqueados_select_admin"
  on public.correos_bloqueados for select
  to authenticated
  using (public.is_admin());

grant select on public.correos_bloqueados to authenticated;

create or replace function public.correo_esta_bloqueado(p_correo text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.correos_bloqueados where correo = p_correo);
$$;

grant execute on function public.correo_esta_bloqueado(text) to anon, authenticated;

-- handle_new_user() (migración 001): mismo trigger de siempre, con un
-- solo agregado al principio -- si el correo está en la lista negra,
-- se aborta con una excepción. Es un trigger AFTER INSERT sobre
-- auth.users, así que la excepción revierte la transacción COMPLETA,
-- incluida la fila de auth.users recién creada -- no queda una cuenta
-- de acceso a medio crear sin su fila de profiles. Esto es la barrera
-- real (a nivel de base); el chequeo en RegisterPage.tsx (llamando a
-- correo_esta_bloqueado() antes de intentar el registro) es solo para
-- mostrar el mensaje genérico sin depender del error crudo que
-- devolvería Supabase Auth en este punto.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_id text;
begin
  if exists (select 1 from public.correos_bloqueados where correo = new.email) then
    raise exception 'Este correo no puede registrarse.';
  end if;

  loop
    v_unique_id := (floor(random() * 90000) + 10000)::int::text;
    exit when not exists (select 1 from public.profiles where unique_id = v_unique_id);
  end loop;

  insert into public.profiles (id, nombre, unique_id, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    v_unique_id,
    new.email
  );
  return new;
end;
$$;

-- admin_dar_de_baja_cuenta(): borra lo que se puede borrar sin romper
-- historial ajeno (membresía de equipo, invitaciones pendientes) y,
-- para el resto -- participaciones en torneos, Clan Wars, títulos,
-- que otros jugadores siguen necesitando como parte de SU propio
-- historial -- en vez de borrar la fila de profiles entera (rompería
-- decenas de referencias en toda la base, empezando por el propio
-- historial de rivales), se le borra todo dato personal identificable
-- y se marca suspendida. nick_history NO se toca a propósito: es
-- justamente el registro de qué nicks usó esta cuenta, útil para
-- moderación futura (investigar_jugador()), y borrar esta cuenta no
-- debería borrar ese rastro.
--
-- Sobre auth.users: se intenta eliminar también la cuenta de acceso
-- real (no solo profiles) -- una función security definer corre con
-- los privilegios del rol que la creó (postgres, vía el SQL Editor),
-- no con la anon/service key, así que la falta de la service role key
-- (que es una restricción del SDK cliente, no de Postgres) no bloquea
-- esto en principio. Igual queda en un bloque try/catch: si por algún
-- motivo el rol no tiene el privilegio necesario sobre el schema auth
-- en este proyecto puntual, el resto de la baja (bloqueo del correo +
-- limpieza de profiles) se aplica igual -- no se revierte todo por
-- esa sola parte.
create or replace function public.admin_dar_de_baja_cuenta(p_user_id uuid, p_motivo text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text;
  v_auth_users_borrado boolean := true;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede dar de baja una cuenta.';
  end if;

  select email into v_correo from auth.users where id = p_user_id;
  if v_correo is null then
    raise exception 'Esa cuenta no existe.';
  end if;

  insert into public.correos_bloqueados (correo, motivo, bloqueado_por)
  values (v_correo, p_motivo, auth.uid());

  delete from public.team_members where user_id = p_user_id;
  delete from public.team_invitations where invited_user_id = p_user_id;
  delete from public.perfiles_juego where user_id = p_user_id;

  update public.profiles
    set nick = null,
        avatar_url = null,
        banner_url = null,
        bio = null,
        links_transmision = '[]'::jsonb,
        horario_stream = null,
        sc2_region = null,
        sc2_id = null,
        country = null,
        es_caster = false,
        correo_recuperacion = null
    where id = p_user_id;

  perform public.admin_suspender_usuario(p_user_id, true, coalesce(p_motivo, 'Cuenta dada de baja por administración'));

  begin
    delete from auth.users where id = p_user_id;
  exception
    when others then
      v_auth_users_borrado := false;
  end;

  if public.es_dueno_plataforma() then
    perform public.registrar_actividad_dueno(
      'dar_de_baja_cuenta',
      'user_id=' || p_user_id::text || ' correo=' || v_correo || ' auth_users_borrado=' || v_auth_users_borrado::text
    );
  end if;

  return v_auth_users_borrado;
end;
$$;

grant execute on function public.admin_dar_de_baja_cuenta(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 3. Gestión de Clan War: la marca visible ("Intervenido por
-- administración de la plataforma") vive en la propia clan_wars.
-- ------------------------------------------------------------
alter table public.clan_wars add column intervenido_por_admin boolean not null default false;

-- Las políticas de select de clan_wars/clan_war_lineup/clan_war_wtl_sets
-- no se pueden "reemplazar" in place -- hay que borrarlas y crearlas
-- de nuevo con la condición agregada (mismo patrón que la migración
-- del modo escenario de prueba). Se agrega is_admin() a las tres: sin
-- esto, un admin que no sea capitán/dueño de ninguno de los dos
-- equipos no podría ver siquiera que una Clan War quedó marcada como
-- intervenida.
drop policy if exists "clan_wars_select_propio" on public.clan_wars;

create policy "clan_wars_select_propio"
  on public.clan_wars for select
  to authenticated
  using (
    public.es_capitan_o_dueno(challenger_team_id)
    or public.es_capitan_o_dueno(challenged_team_id)
    or public.es_dueno_plataforma()
    or public.is_admin()
  );

drop policy if exists "clan_war_lineup_select_propio" on public.clan_war_lineup;

create policy "clan_war_lineup_select_propio"
  on public.clan_war_lineup for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (
          public.es_capitan_o_dueno(cw.challenger_team_id)
          or public.es_capitan_o_dueno(cw.challenged_team_id)
          or public.is_admin()
        )
    )
  );

drop policy if exists "clan_war_wtl_sets_select_propio" on public.clan_war_wtl_sets;

create policy "clan_war_wtl_sets_select_propio"
  on public.clan_war_wtl_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.clan_wars cw
      where cw.id = clan_war_id
        and (
          public.es_capitan_o_dueno(cw.challenger_team_id)
          or public.es_capitan_o_dueno(cw.challenged_team_id)
          or public.is_admin()
        )
    )
  );

-- armar_lineup_cw() y confirmar_lineup_cw(): mismo cuerpo de siempre,
-- con un parámetro nuevo al final (p_team_id_como_admin) -- exclusivo
-- del dueño de la plataforma (no de cualquier admin: coincide con
-- quién puede escribir en dueno_actividad_log). Con ese parámetro en
-- null (el caso normal, para cualquier jugador) el comportamiento
-- queda exactamente igual que antes. El cambio de firma exige borrar
-- las funciones primero -- si no, Postgres crea un segundo overload en
-- silencio en vez de reemplazar la función.
drop function if exists public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer);

create or replace function public.armar_lineup_cw(
  p_clan_war_id uuid,
  p_accion text,
  p_jugador_id uuid default null,
  p_jugador_temporal_id uuid default null,
  p_link_verificacion text default null,
  p_lineup_id uuid default null,
  p_posicion integer default null,
  p_team_id_como_admin uuid default null
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

  if p_accion = 'agregar' then
    if v_reto.formato = 'wtl' then
      if p_jugador_id is null or p_jugador_temporal_id is not null then
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
      select 1 from public.roster_elegible_cw(v_mi_team_id, v_reto.temporada_id) where jugador_id = p_jugador_id
    ) then
      raise exception 'Ese jugador no es miembro de ese equipo, ni su mercenario, ni miembro de un equipo aliado para esta temporada.';
    end if;

    if p_jugador_temporal_id is not null and not exists (
      select 1 from public.team_temp_players where id = p_jugador_temporal_id and team_id = v_mi_team_id
    ) then
      raise exception 'Ese jugador temporal no es de ese equipo.';
    end if;

    if v_reto.formato = 'wtl' and v_reto.temporada_id is not null and p_jugador_id is not null then
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

grant execute on function public.armar_lineup_cw(uuid, text, uuid, uuid, text, uuid, integer, uuid) to authenticated;

drop function if exists public.confirmar_lineup_cw(uuid);

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
    select (count(distinct posicion) = 3) into v_posiciones_completas
    from public.clan_war_lineup
    where clan_war_id = p_clan_war_id and team_id = v_mi_team_id and posicion is not null;

    if not v_posiciones_completas then
      raise exception 'En formato WTL el lineup necesita exactamente 3 jugadores, en las posiciones 1, 2 y 3.';
    end if;
  end if;

  -- visto_bueno_dado_por_* siempre queda en auth.uid(), sea o no una
  -- intervención -- cuando es el dueño de la plataforma actuando como
  -- admin, auth.uid() es su propio id real (está con su propia
  -- sesión, solo indicó explícitamente el equipo), así que esa
  -- columna termina mostrando, de forma honesta, quién dio el visto
  -- bueno de verdad -- lo mismo que ya hace intervenido_por_admin,
  -- pero a nivel de esta fila puntual.
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
