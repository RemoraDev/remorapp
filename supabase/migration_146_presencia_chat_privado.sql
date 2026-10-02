-- Migración 146: estado de presencia (disponible/ausente/ocupado) en
-- la lista de conversaciones privadas del chat de líderes -- a pedido
-- del usuario, hoy no se veía si la otra persona estaba conectada.
-- Mismo cuerpo de la función de siempre, solo suma
-- otro_estado_presencia (profiles.estado_presencia, ya existe desde
-- la migración 121 -- ver Header.tsx).
--
-- drop primero: create or replace no alcanza cuando cambian las
-- columnas de retorno (los "OUT parameters"), hace falta borrarla y
-- crearla de nuevo.
drop function if exists public.mis_conversaciones_chat_lideres();

create or replace function public.mis_conversaciones_chat_lideres()
returns table (
  otro_usuario_id uuid,
  otro_nick text,
  otro_avatar_url text,
  otro_estado_presencia text,
  ultimo_mensaje text,
  ultimo_mensaje_en timestamptz,
  no_leidos integer
)
language sql
security definer
set search_path = public
as $$
  with mis_mensajes as (
    select
      case when de_usuario_id = auth.uid() then para_usuario_id else de_usuario_id end as otro_usuario_id,
      contenido,
      created_at,
      leido,
      para_usuario_id
    from public.mensajes_privados_lideres
    where auth.uid() in (de_usuario_id, para_usuario_id)
  ),
  ultimos as (
    select distinct on (otro_usuario_id) otro_usuario_id, contenido, created_at
    from mis_mensajes
    order by otro_usuario_id, created_at desc
  ),
  no_leidos_por_conversacion as (
    select otro_usuario_id, count(*)::integer as cantidad
    from mis_mensajes
    where para_usuario_id = auth.uid() and not leido
    group by otro_usuario_id
  )
  select
    u.otro_usuario_id,
    p.nick,
    p.avatar_url,
    p.estado_presencia,
    u.contenido,
    u.created_at,
    coalesce(nl.cantidad, 0)
  from ultimos u
  join public.profiles p on p.id = u.otro_usuario_id
  left join no_leidos_por_conversacion nl on nl.otro_usuario_id = u.otro_usuario_id
  order by u.created_at desc;
$$;

grant execute on function public.mis_conversaciones_chat_lideres() to authenticated;
