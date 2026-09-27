-- ------------------------------------------------------------
-- Migración 118: dos pedidos del usuario sobre mensajes privados del
-- chat de líderes.
--
-- 1) Hoy mensajes_privados_lideres_insert exige que los DOS
-- participantes califiquen para el chat de líderes
-- (esta_habilitado_chat_lideres() de los dos lados) -- el dueño de la
-- plataforma no podía escribirle a un jugador cualquiera. Se agrega:
-- un admin/staff/dueño puede iniciar una conversación con CUALQUIERA,
-- califique o no; quien recibe ese primer mensaje queda habilitado
-- para responder DENTRO de ese hilo puntual (no gana acceso al chat
-- grupal ni puede iniciar otras conversaciones nuevas).
--
-- 2) Las conversaciones ya se guardaban para siempre (nunca hay un
-- delete ni un TTL sobre mensajes_privados_lideres), y
-- es_dueno_plataforma() ya podía leer cualquier fila por RLS -- lo que
-- faltaba era una forma de CONSULTARLAS agrupadas por conversación
-- desde el Panel de Administración, para revisar denuncias de trampa
-- entre líderes de clan. admin_listar_conversaciones_privadas() y
-- admin_ver_conversacion_privada() cubren eso.
-- ------------------------------------------------------------

create or replace function public.es_privilegiado_chat(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select es_admin or es_staff or es_dueno_plataforma from public.profiles where id = p_user_id),
    false
  );
$$;

grant execute on function public.es_privilegiado_chat(uuid) to authenticated;

drop policy if exists "mensajes_privados_lideres_insert" on public.mensajes_privados_lideres;

create policy "mensajes_privados_lideres_insert"
  on public.mensajes_privados_lideres for insert
  to authenticated
  with check (
    de_usuario_id = auth.uid()
    and not public.esta_suspendido()
    and (
      -- Camino normal: los dos participantes califican para el chat de líderes.
      (public.esta_habilitado_chat_lideres() and public.esta_habilitado_chat_lideres(para_usuario_id))
      -- Un admin/staff/dueño puede escribirle a cualquiera.
      or public.es_privilegiado_chat(auth.uid())
      -- Quien no califica puede responder, pero SOLO dentro de un hilo
      -- que un admin/staff/dueño ya inició con él/ella.
      or exists (
        select 1 from public.mensajes_privados_lideres m
        where m.de_usuario_id = para_usuario_id
          and m.para_usuario_id = auth.uid()
          and public.es_privilegiado_chat(para_usuario_id)
      )
    )
  );

-- buscar_lideres_chat(): un admin/staff/dueño puede encontrar a
-- CUALQUIER jugador (para iniciar una conversación con alguien que no
-- califica) -- el resto sigue viendo solo a otra gente que también
-- califica, como antes.
create or replace function public.buscar_lideres_chat(p_query text)
returns table (id uuid, nick text, unique_id text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.nick, p.unique_id, p.avatar_url
  from public.profiles p
  where public.esta_habilitado_chat_lideres()
    and p.id <> auth.uid()
    and p.nick is not null
    and not p.suspendido
    and p.nick ilike '%' || p_query || '%'
    and (public.esta_habilitado_chat_lideres(p.id) or public.es_privilegiado_chat(auth.uid()))
  order by p.nick
  limit 10;
$$;

-- tengo_conversacion_privada_activa(): para el frontend -- alguien que
-- NO califica en general para el chat de líderes puede, aun así, tener
-- una conversación privada activa (porque un admin/staff/dueño le
-- escribió primero). Se usa en ChatLideresPage.tsx para decidir si se
-- muestra, aunque sea, la pestaña de Mensajes privados.
create or replace function public.tengo_conversacion_privada_activa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mensajes_privados_lideres
    where auth.uid() in (de_usuario_id, para_usuario_id)
  );
$$;

grant execute on function public.tengo_conversacion_privada_activa() to authenticated;

-- admin_listar_conversaciones_privadas(): una fila por CONVERSACIÓN
-- (no por mensaje), con el último mensaje y el total -- pensada para
-- revisar denuncias de trampa entre líderes de clan, no para leer todo
-- letra por letra desde acá.
create or replace function public.admin_listar_conversaciones_privadas()
returns table (
  usuario_a_id uuid,
  usuario_a_nick text,
  usuario_b_id uuid,
  usuario_b_nick text,
  ultimo_mensaje text,
  ultimo_mensaje_en timestamptz,
  cantidad_mensajes bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.es_staff() or public.es_dueno_plataforma()) then
    raise exception 'No autorizado: se requiere ser staff, admin o el dueño de la plataforma.';
  end if;

  return query
    with pares as (
      select
        least(de_usuario_id, para_usuario_id) as usuario_a_id,
        greatest(de_usuario_id, para_usuario_id) as usuario_b_id,
        contenido,
        created_at
      from public.mensajes_privados_lideres
    ),
    ultimos as (
      select distinct on (usuario_a_id, usuario_b_id) usuario_a_id, usuario_b_id, contenido, created_at
      from pares
      order by usuario_a_id, usuario_b_id, created_at desc
    ),
    conteos as (
      select usuario_a_id, usuario_b_id, count(*) as cantidad
      from pares
      group by usuario_a_id, usuario_b_id
    )
    select
      u.usuario_a_id, pa.nick,
      u.usuario_b_id, pb.nick,
      u.contenido, u.created_at,
      c.cantidad
    from ultimos u
    join conteos c on c.usuario_a_id = u.usuario_a_id and c.usuario_b_id = u.usuario_b_id
    join public.profiles pa on pa.id = u.usuario_a_id
    join public.profiles pb on pb.id = u.usuario_b_id
    order by u.created_at desc;
end;
$$;

grant execute on function public.admin_listar_conversaciones_privadas() to authenticated;

-- admin_ver_conversacion_privada(): la conversación completa entre dos
-- personas puntuales, para cuando una denuncia apunta a un par
-- específico.
create or replace function public.admin_ver_conversacion_privada(p_usuario_a uuid, p_usuario_b uuid)
returns table (
  id uuid,
  de_usuario_id uuid,
  de_nick text,
  para_usuario_id uuid,
  contenido text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.es_staff() or public.es_dueno_plataforma()) then
    raise exception 'No autorizado: se requiere ser staff, admin o el dueño de la plataforma.';
  end if;

  return query
    select m.id, m.de_usuario_id, p.nick, m.para_usuario_id, m.contenido, m.created_at
    from public.mensajes_privados_lideres m
    join public.profiles p on p.id = m.de_usuario_id
    where (m.de_usuario_id = p_usuario_a and m.para_usuario_id = p_usuario_b)
       or (m.de_usuario_id = p_usuario_b and m.para_usuario_id = p_usuario_a)
    order by m.created_at asc;
end;
$$;

grant execute on function public.admin_ver_conversacion_privada(uuid, uuid) to authenticated;
