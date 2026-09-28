-- Migración 137: nombre propio para un Race War, mismo criterio que
-- clan_wars.titulo (migración 109) -- un texto libre, calculado una
-- sola vez al crearse (con 'Race War' como default si se deja en
-- blanco), guardado en una columna normal (no generada) para que se
-- pueda editar a mano más adelante sin perder lo que el organizador
-- haya escrito. La política guerra_razas_update_organizador ya cubre
-- cualquier columna (mismo mecanismo que ya usan las imágenes de
-- mascota y el efecto neón) -- no hace falta ninguna RPC nueva para
-- editarlo después de creado, alcanza con un update directo desde el
-- frontend.

alter table public.guerra_razas add column titulo text;

drop function if exists public.crear_race_war();

create or replace function public.crear_race_war(p_titulo text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_race_war_id uuid;
  v_titulo text;
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  v_titulo := nullif(trim(p_titulo), '');

  -- Valores placeholder en las columnas que exige tournaments pero que
  -- un Race War nunca usa (formato/modo/cupos_totales/fecha_inicio) --
  -- nadie se inscribe ni juega partidas acá, es solo el anfitrión
  -- técnico del marcador.
  insert into public.tournaments (
    nombre, formato, modo, publico, cupos_totales, fecha_inicio, creador_id
  ) values (
    coalesce(v_titulo, 'Race War'), '1v1', 'eliminacion_simple', false, 2, now(), auth.uid()
  )
  returning id into v_tournament_id;

  insert into public.guerra_razas (tournament_id, creado_por, titulo)
  values (v_tournament_id, auth.uid(), v_titulo)
  returning id into v_race_war_id;

  return v_race_war_id;
end;
$$;

grant execute on function public.crear_race_war(text) to authenticated;

-- eventos_publicos(): el listado público ya no muestra el literal
-- 'Race War' fijo para todas -- usa el título propio si lo hay, y cae
-- al mismo default de siempre si no (mismo patrón que ya usa
-- clan_war_amistosa con coalesce(cw.titulo, ...)).
create or replace function public.eventos_publicos()
returns table (
  tipo text,
  id uuid,
  titulo text,
  formato text,
  modo text,
  fecha timestamptz,
  cupos_totales integer,
  cupos_ocupados integer,
  pozo_premio numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select
      'torneo'::text as tipo,
      t.id,
      t.nombre as titulo,
      t.formato,
      t.modo,
      t.fecha_inicio as fecha,
      t.cupos_totales,
      t.cupos_ocupados,
      t.pozo_premio
    from public.tournaments t
    where t.publico = true and t.estado = 'abierto' and t.excluido_de_busqueda = false

    union all

    select
      'race_war'::text,
      g.id,
      coalesce(g.titulo, 'Race War'),
      null::text,
      null::text,
      g.creado_en,
      null::integer,
      null::integer,
      null::numeric
    from public.guerra_razas g

    union all

    select
      'clan_war_amistosa'::text,
      cw.id,
      coalesce(cw.titulo, ct.tag || ' vs ' || cd.tag),
      null::text,
      null::text,
      cw.fecha_hora_cet,
      null::integer,
      null::integer,
      null::numeric
    from public.clan_wars cw
    join public.teams ct on ct.id = cw.challenger_team_id
    join public.teams cd on cd.id = cw.challenged_team_id
    where cw.status in ('pendiente', 'aceptada', 'en_curso')
      and (select tdc.id from public.torneo_de_clan_war(cw.id) tdc) is null
  ) eventos
  order by fecha asc;
$$;

grant execute on function public.eventos_publicos() to anon, authenticated;
