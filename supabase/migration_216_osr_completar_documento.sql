-- ============================================================
-- Migración 216: "¿Quién es tu papi?" -- cierra lo que quedaba
-- pendiente del documento original (no era parte de la Etapa 2 que
-- ya se armó): listas detalladas de hijos/padres por jugador
-- (paternidad HISTÓRICA, cruzando todas las temporadas -- sección 15
-- del documento: "se puede consultar la paternidad histórica"),
-- activar/desactivar un jugador sin borrar su historial, y
-- estadísticas generales para el Panel de moderador.
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de la 215.
-- ============================================================

-- ------------------------------------------------------------
-- osr_hijos_de() / osr_padres_de(): lista detallada para los íconos
-- interactivos de la sección 9 del documento. Paternidad HISTÓRICA
-- (cruza todas las temporadas, igual que osr_paternidades_historial())
-- -- "categoria_actual" sale de la temporada activa, si el jugador
-- sigue inscripto en ella (si no, viene null).
-- ------------------------------------------------------------

create or replace function public.osr_hijos_de(p_user_id uuid)
returns table (
  hijo_user_id uuid,
  nick text,
  victorias_jugador integer,
  victorias_hijo integer,
  diferencia integer,
  categoria_actual text
)
language sql
stable
set search_path = public
as $$
  with normalizado as (
    select
      case when estado = 'papa_a' then jugador_a else jugador_b end as papa_id,
      case when estado = 'papa_a' then jugador_b else jugador_a end as hijo_id,
      case when estado = 'papa_a' then victorias_a else victorias_b end as victorias_papa,
      case when estado = 'papa_a' then victorias_b else victorias_a end as victorias_hijo_v
    from public.osr_paternidades_historial()
    where estado in ('papa_a', 'papa_b')
  )
  select
    n.hijo_id,
    pr.nick,
    n.victorias_papa,
    n.victorias_hijo_v,
    n.victorias_papa - n.victorias_hijo_v,
    oj.categoria
  from normalizado n
  join public.profiles pr on pr.id = n.hijo_id
  left join public.osr_temporadas t on t.activa
  left join public.osr_jugadores oj on oj.user_id = n.hijo_id and oj.temporada_id = t.id
  where n.papa_id = p_user_id;
$$;

grant execute on function public.osr_hijos_de(uuid) to anon, authenticated;

create or replace function public.osr_padres_de(p_user_id uuid)
returns table (
  padre_user_id uuid,
  nick text,
  victorias_jugador integer,
  victorias_padre integer,
  diferencia integer,
  categoria_actual text
)
language sql
stable
set search_path = public
as $$
  with normalizado as (
    select
      case when estado = 'papa_a' then jugador_a else jugador_b end as papa_id,
      case when estado = 'papa_a' then jugador_b else jugador_a end as hijo_id,
      case when estado = 'papa_a' then victorias_a else victorias_b end as victorias_papa,
      case when estado = 'papa_a' then victorias_b else victorias_a end as victorias_hijo_v
    from public.osr_paternidades_historial()
    where estado in ('papa_a', 'papa_b')
  )
  select
    n.papa_id,
    pr.nick,
    n.victorias_hijo_v,
    n.victorias_papa,
    n.victorias_papa - n.victorias_hijo_v,
    oj.categoria
  from normalizado n
  join public.profiles pr on pr.id = n.papa_id
  left join public.osr_temporadas t on t.activa
  left join public.osr_jugadores oj on oj.user_id = n.papa_id and oj.temporada_id = t.id
  where n.hijo_id = p_user_id;
$$;

grant execute on function public.osr_padres_de(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- osr_activar_jugador(): "crear, editar y desactivar perfiles de
-- jugadores" (sección 18) -- desactivar NO borra nada, solo lo saca
-- de los rankings/formularios de "registrar partida" (osr_jugadores
-- ya se filtraba por "activo" en todas las lecturas).
-- ------------------------------------------------------------

create or replace function public.osr_activar_jugador(p_jugador_id uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede activar o desactivar jugadores.';
  end if;

  update public.osr_jugadores set activo = p_activo where id = p_jugador_id;
end;
$$;

grant execute on function public.osr_activar_jugador(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- osr_estadisticas_generales(): resumen para el Panel de moderador
-- (sección 18: "consultar estadísticas generales de la competición").
-- ------------------------------------------------------------

create or replace function public.osr_estadisticas_generales(p_temporada_id uuid)
returns table (
  jugadores_activos bigint,
  partidas_verificadas bigint,
  partidas_pendientes bigint,
  partidas_rechazadas bigint,
  paternidades_consolidadas bigint,
  paternidades_disputadas bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.osr_jugadores where temporada_id = p_temporada_id and activo),
    (select count(*) from public.osr_partidas where temporada_id = p_temporada_id and estado in ('verificada', 'corregida')),
    (select count(*) from public.osr_partidas where temporada_id = p_temporada_id and estado = 'pendiente'),
    (select count(*) from public.osr_partidas where temporada_id = p_temporada_id and estado = 'rechazada'),
    (select count(*) from public.osr_paternidades_temporada(p_temporada_id) where estado in ('papa_a', 'papa_b')),
    (select count(*) from public.osr_paternidades_temporada(p_temporada_id) where estado = 'disputando');
$$;

grant execute on function public.osr_estadisticas_generales(uuid) to authenticated;
