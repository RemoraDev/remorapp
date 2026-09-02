-- ============================================================
-- Migración 026: títulos Padre/Hijo, entre clanes y entre jugadores
-- 1v1. Se resuelven solos con un enfrentamiento real -- una Clan War
-- que se cierra (clanes) o una partida 1v1 que se resuelve en
-- cualquier torneo (jugadores) -- reutilizando cerrar_clan_war() y
-- avanzar_ganador(), no funciones nuevas paralelas.
--
-- retador_id/retado_id son polimórficos (team_id o profile_id, según
-- tipo) -- no llevan foreign key porque apuntan a una tabla u otra
-- según el caso; cada función valida que el id exista adentro.
--
-- Sobre "queda pendiente hasta que se resuelve": aceptar NO cambia el
-- status (sigue en 'pendiente' -- así lo pediste). La columna
-- aceptado es la única forma de distinguir "todavía sin responder" de
-- "ya se acordó, esperando el partido/CW que lo resuelva" -- sin
-- ella, cerrar_clan_war()/avanzar_ganador() no podrían saber si
-- corresponde resolver un título todavía no aceptado.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create table public.titulos_padre_hijo (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('clan', 'jugador')),
  retador_id uuid not null,
  retado_id uuid not null,
  duracion_dias integer not null check (duracion_dias between 7 and 90),
  -- Obligatorios solo para tipo = 'jugador' -- el check de abajo lo
  -- exige.
  caster_nombre text,
  caster_link text,
  status text not null default 'pendiente' check (status in ('pendiente', 'activo', 'expirado', 'rechazado')),
  aceptado boolean not null default false,
  -- null hasta resolverse.
  ganador_id uuid,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  created_at timestamptz not null default now(),
  check (retador_id <> retado_id),
  check (tipo <> 'jugador' or (caster_nombre is not null and caster_link is not null)),
  check (ganador_id is null or ganador_id in (retador_id, retado_id))
);

alter table public.titulos_padre_hijo enable row level security;

-- Cualquiera ve los títulos donde participa su propio equipo o su
-- propia cuenta -- esto cubre las propuestas pendientes de responder
-- y las suyas propias, en el Panel de control / en /perfil. Los
-- títulos ACTIVOS que se muestran en el perfil público de un tercero
-- (punto 5 del pedido) van por una función aparte, más abajo
-- (titulos_activos_de()), que sí es pública -- no por esta política.
create policy "titulos_padre_hijo_select_propio"
  on public.titulos_padre_hijo for select
  to authenticated
  using (
    (tipo = 'jugador' and (retador_id = auth.uid() or retado_id = auth.uid()))
    or (tipo = 'clan' and (
      exists (select 1 from public.teams where id = retador_id and owner_id = auth.uid())
      or exists (select 1 from public.teams where id = retado_id and owner_id = auth.uid())
    ))
  );

grant select on public.titulos_padre_hijo to authenticated;

-- Sin política de insert/update para authenticated a propósito -- la
-- única forma de escribir acá es proponer_titulo_padre_hijo(),
-- responder_titulo_padre_hijo(), y la resolución automática desde
-- cerrar_clan_war()/avanzar_ganador(), todas security definer.

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
    select id into v_retador_id from public.teams where owner_id = auth.uid();
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

-- responder_titulo_padre_hijo(): aceptar no cambia el status (sigue
-- pendiente hasta el enfrentamiento real) -- ver la explicación larga
-- al principio del archivo. La duración queda fija, tal como se
-- propuso: no hay parámetro para cambiarla acá.
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
    select exists (select 1 from public.teams where id = v_titulo.retado_id and owner_id = auth.uid())
      into v_soy_retado;
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

grant execute on function public.responder_titulo_padre_hijo(uuid, boolean) to authenticated;

-- Cuando fecha_fin ya pasó, un título activo deja de mostrarse como
-- tal -- se evalúa al cargar el perfil o el equipo (mismo patrón que
-- restaurar_banca_rota_perfil()/_equipo()), no hace falta un proceso
-- en segundo plano. Barrido global -- no depende de quién mira.
create or replace function public.expirar_titulos_vencidos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.titulos_padre_hijo
    set status = 'expirado'
    where status = 'activo' and fecha_fin < now();
end;
$$;

grant execute on function public.expirar_titulos_vencidos() to authenticated;

-- Títulos activos de un equipo o jugador, para mostrar en su perfil
-- público -- se acumulan, no se reemplazan (un mismo equipo puede ser
-- Padre de varios e Hijo de otros a la vez). A propósito NO usa la
-- política de RLS de arriba (esa es "solo los involucrados"): esto es
-- información pública, se muestra en el perfil de cualquiera.
create or replace function public.titulos_activos_de(p_tipo text, p_id uuid)
returns table (
  id uuid,
  otro_id uuid,
  soy_padre boolean,
  fecha_fin timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.id,
    case when t.retador_id = p_id then t.retado_id else t.retador_id end as otro_id,
    (t.ganador_id = p_id) as soy_padre,
    t.fecha_fin
  from public.titulos_padre_hijo t
  where t.tipo = p_tipo and t.status = 'activo' and (t.retador_id = p_id or t.retado_id = p_id);
$$;

grant execute on function public.titulos_activos_de(text, uuid) to anon, authenticated;
