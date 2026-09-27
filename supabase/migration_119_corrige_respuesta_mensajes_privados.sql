-- ------------------------------------------------------------
-- Migración 119: corrige un bug real de la migración 118 -- nadie
-- podía responder un mensaje privado iniciado por un admin/staff/dueño,
-- ni siquiera el propio dueño de la plataforma en un hilo donde YA
-- había mensajes (violaba la política de RLS).
--
-- Causa: la política de insert tenía una subconsulta correlacionada
--   exists (
--     select 1 from mensajes_privados_lideres m
--     where m.de_usuario_id = para_usuario_id   -- ⚠️ ambiguo
--       and m.para_usuario_id = auth.uid()
--       and es_privilegiado_chat(para_usuario_id)  -- ⚠️ ambiguo
--   )
-- "para_usuario_id" (sin calificar) DEBÍA referirse a la fila nueva que
-- se está insertando, pero como la subconsulta también lee de
-- mensajes_privados_lideres (que tiene su propia columna
-- para_usuario_id), Postgres resuelve el nombre contra el alcance más
-- interno (m.para_usuario_id) en vez de la fila nueva -- la condición
-- terminaba comparando la fila de la subconsulta contra sí misma
-- (de_usuario_id = para_usuario_id), algo que el check
-- "de_usuario_id <> para_usuario_id" de la tabla vuelve imposible.
-- El exists() daba false siempre, sin importar el caso.
--
-- Se soluciona moviendo toda la lógica a una función con parámetros de
-- nombre distinto (p_de/p_para) -- ahí no hay forma de que se
-- confundan con las columnas de la tabla que lee la subconsulta.
-- ------------------------------------------------------------

create or replace function public.puede_enviar_mensaje_privado_lider(p_de uuid, p_para uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (public.esta_habilitado_chat_lideres(p_de) and public.esta_habilitado_chat_lideres(p_para))
    or public.es_privilegiado_chat(p_de)
    or exists (
      select 1 from public.mensajes_privados_lideres m
      where m.de_usuario_id = p_para
        and m.para_usuario_id = p_de
        and public.es_privilegiado_chat(p_para)
    );
$$;

grant execute on function public.puede_enviar_mensaje_privado_lider(uuid, uuid) to authenticated;

drop policy if exists "mensajes_privados_lideres_insert" on public.mensajes_privados_lideres;

create policy "mensajes_privados_lideres_insert"
  on public.mensajes_privados_lideres for insert
  to authenticated
  with check (
    de_usuario_id = auth.uid()
    and not public.esta_suspendido()
    and public.puede_enviar_mensaje_privado_lider(de_usuario_id, para_usuario_id)
  );
