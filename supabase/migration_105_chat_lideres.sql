-- ------------------------------------------------------------
-- Migración 105: Chat de líderes -- canal de texto (grupal y privado)
-- exclusivo para quien califica HOY como líder de un clan grande,
-- Staff, admin o dueño de la plataforma. Reutiliza exactamente el
-- mismo mecanismo de Supabase Realtime (Postgres Changes sobre RLS)
-- que ya se usó en el chat de equipo (migración 071, "Delfin Mode",
-- eliminado por completo en la migración 075) -- no se reinventa la
-- mecánica, solo se aplica a un público distinto y con permisos más
-- finos (chat privado, silenciar, visibilidad total del dueño).
--
-- El filtro de lenguaje inapropiado a nivel de base (contiene_lengua-
-- je_inapropiado) también se había eliminado junto con Delfin Mode
-- (migración 075 hizo drop function) -- esta migración lo recrea
-- idéntico (misma lista, misma normalización) porque hace falta de
-- nuevo acá, no porque haya quedado un rastro de la versión vieja.
--
-- Orden de este archivo: usuarios_silenciados se crea ANTES que
-- mensajes_lideres a propósito -- su política de select referencia
-- usuarios_silenciados en una subconsulta, y CREATE POLICY exige que
-- la tabla referenciada ya exista (a diferencia de una vista, no
-- alcanza con que exista recién al momento de consultar).
-- ------------------------------------------------------------

-- unaccent ya está instalada (se dejó instalada e inerte en la
-- migración 075) -- "if not exists" por las dudas de que este archivo
-- se corra de punta a punta en un esquema nuevo.
create extension if not exists unaccent;

create or replace function public.contiene_lenguaje_inapropiado(p_texto text)
returns boolean
language sql
immutable
as $$
  -- Misma lista que PALABRAS_BLOQUEADAS en src/lib/profanityFilter.ts --
  -- si se amplía una, hay que ampliar la otra a mano, no hay una
  -- fuente única compartida entre TypeScript y SQL.
  select exists (
    select 1
    from unnest(array[
      'puta', 'puto', 'mierda', 'pendejo', 'pendeja', 'conchatumadre', 'hueon', 'weon',
      'maricon', 'marica', 'verga', 'culiao', 'culiado', 'chucha', 'cabron', 'cabrona',
      'perra', 'zorra', 'polla',
      'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'nigger', 'nigga', 'faggot',
      'whore', 'slut', 'dick', 'cock', 'pussy'
    ]) as palabra
    where position(
      palabra in regexp_replace(
        -- Mismos reemplazos "leet" que REEMPLAZOS_LEET en
        -- profanityFilter.ts: 4->a, 3->e, 1->i, 0->o, 5->s, $->s, @->a.
        translate(unaccent(lower(p_texto)), '43105$@', 'aeiossa'),
        '[^a-z0-9]', '', 'g'
      )
    ) > 0
  );
$$;

-- ------------------------------------------------------------
-- esta_habilitado_chat_lideres(): acceso EN VIVO, no un logro que se
-- guarda -- se vuelve a evaluar cada vez que se llama (RLS la invoca
-- en cada consulta), así que si el equipo del dueño baja de 15
-- miembros reales, el acceso se pierde solo la próxima vez que se
-- consulte, sin ningún proceso ni cron que lo actualice.
--
-- "Miembros reales": team_members.user_id ya es FOREIGN KEY NOT NULL
-- contra profiles(id) (on delete cascade), así que técnicamente nunca
-- puede haber una fila de team_members sin un perfil real detrás --
-- los jugadores temporales (team_temp_players) son una tabla aparte,
-- solo para lineups de Clan War, y nunca entran acá. El join contra
-- profiles de abajo es, por lo tanto, una defensa explícita (no un
-- filtro que hoy cambie el resultado): deja documentado el criterio y
-- protege el conteo si algún día team_members admitiera otra cosa.
--
-- p_user_id tiene default auth.uid() para el caso más común (¿puedo
-- yo entrar al chat?), pero también se usa con un id ajeno para
-- verificar, al mandar un mensaje privado o buscar gente, que el
-- OTRO participante siga calificando hoy.
-- ------------------------------------------------------------
create or replace function public.esta_habilitado_chat_lideres(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    coalesce((select es_staff from public.profiles where id = p_user_id), false)
    or coalesce((select es_admin from public.profiles where id = p_user_id), false)
    or coalesce((select es_dueno_plataforma from public.profiles where id = p_user_id), false)
    or exists (
      select 1
      from public.teams t
      where t.owner_id = p_user_id
        and (
          select count(*)
          from public.team_members tm
          join public.profiles p on p.id = tm.user_id
          where tm.team_id = t.id
        ) >= 15
    );
$$;

grant execute on function public.esta_habilitado_chat_lideres(uuid) to authenticated;

-- ------------------------------------------------------------
-- usuarios_silenciados: "ensordecer" a alguien en el chat grupal --
-- solo afecta lo que YO veo, la otra persona nunca se entera (no hay
-- ninguna política de select que le permita ver que apareció acá como
-- usuario_silenciado_id, solo quien silenció puede leer sus propias
-- filas). Se crea antes que mensajes_lideres porque su política de
-- select la referencia -- ver nota de orden arriba.
-- ------------------------------------------------------------
create table public.usuarios_silenciados (
  id uuid primary key default gen_random_uuid(),
  silenciado_por uuid not null references public.profiles (id) on delete cascade,
  usuario_silenciado_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (silenciado_por <> usuario_silenciado_id)
);

-- Como máximo una fila por par (silenciar dos veces a la misma
-- persona no debe duplicar la fila).
create unique index usuarios_silenciados_unico
  on public.usuarios_silenciados (silenciado_por, usuario_silenciado_id);

alter table public.usuarios_silenciados enable row level security;

create policy "usuarios_silenciados_select_propio"
  on public.usuarios_silenciados for select
  to authenticated
  using (silenciado_por = auth.uid());

create policy "usuarios_silenciados_insert_propio"
  on public.usuarios_silenciados for insert
  to authenticated
  with check (silenciado_por = auth.uid() and public.esta_habilitado_chat_lideres());

create policy "usuarios_silenciados_delete_propio"
  on public.usuarios_silenciados for delete
  to authenticated
  using (silenciado_por = auth.uid());

grant select, insert, delete on public.usuarios_silenciados to authenticated;

-- ------------------------------------------------------------
-- mensajes_lideres: el chat grupal, todos los líderes/Staff/admin
-- habilitados juntos en un solo canal.
-- ------------------------------------------------------------
create table public.mensajes_lideres (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references public.profiles (id) on delete cascade,
  contenido text not null check (char_length(contenido) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint mensajes_lideres_sin_lenguaje_inapropiado check (not public.contiene_lenguaje_inapropiado(contenido))
);

create index mensajes_lideres_created_at_idx on public.mensajes_lideres (created_at);

alter table public.mensajes_lideres enable row level security;

create policy "mensajes_lideres_select"
  on public.mensajes_lideres for select
  to authenticated
  using (
    public.esta_habilitado_chat_lideres()
    and not exists (
      select 1 from public.usuarios_silenciados us
      where us.silenciado_por = auth.uid() and us.usuario_silenciado_id = mensajes_lideres.autor_id
    )
  );

create policy "mensajes_lideres_insert"
  on public.mensajes_lideres for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and not public.esta_suspendido()
    and public.esta_habilitado_chat_lideres()
  );

grant select, insert on public.mensajes_lideres to authenticated;

-- Mismo mecanismo que mensajes_equipo en su momento: cada cliente
-- conectado a este canal de Realtime sigue sujeto al RLS de arriba,
-- así que alguien que no califica (o que silenció al autor) nunca
-- recibe el INSERT en vivo, aunque esté suscripto.
alter publication supabase_realtime add table public.mensajes_lideres;

-- ------------------------------------------------------------
-- mensajes_privados_lideres: conversación 1 a 1 entre dos personas
-- habilitadas. El dueño de la plataforma puede LEER cualquier
-- conversación ajena (mismo mecanismo de invisibilidad que ya existe
-- para él: una política de select más, sin ningún registro ni aviso
-- -- ver dueno_actividad_log/es_dueno_plataforma() más arriba en este
-- archivo), pero no puede escribir en nombre de otro: el insert exige
-- de_usuario_id = auth.uid() sin excepción.
-- ------------------------------------------------------------
create table public.mensajes_privados_lideres (
  id uuid primary key default gen_random_uuid(),
  de_usuario_id uuid not null references public.profiles (id) on delete cascade,
  para_usuario_id uuid not null references public.profiles (id) on delete cascade,
  contenido text not null check (char_length(contenido) between 1 and 500),
  created_at timestamptz not null default now(),
  leido boolean not null default false,
  check (de_usuario_id <> para_usuario_id),
  constraint mensajes_privados_lideres_sin_lenguaje_inapropiado check (not public.contiene_lenguaje_inapropiado(contenido))
);

-- Cubre "traer toda mi conversación con tal persona, ordenada por
-- fecha" sin importar quién mandó qué -- least/greatest normaliza el
-- par de ids (mismo patrón que team_amistades_pendiente_unica).
create index mensajes_privados_lideres_conversacion_idx
  on public.mensajes_privados_lideres (
    least(de_usuario_id, para_usuario_id),
    greatest(de_usuario_id, para_usuario_id),
    created_at
  );

alter table public.mensajes_privados_lideres enable row level security;

create policy "mensajes_privados_lideres_select"
  on public.mensajes_privados_lideres for select
  to authenticated
  using (
    auth.uid() in (de_usuario_id, para_usuario_id)
    or public.es_dueno_plataforma()
  );

create policy "mensajes_privados_lideres_insert"
  on public.mensajes_privados_lideres for insert
  to authenticated
  with check (
    de_usuario_id = auth.uid()
    and not public.esta_suspendido()
    and public.esta_habilitado_chat_lideres()
    and public.esta_habilitado_chat_lideres(para_usuario_id)
  );

-- Solo el destinatario puede tocar una fila, y solo para marcarla
-- leída -- el trigger de abajo fuerza el resto de las columnas a su
-- valor anterior, así que ni el destinatario puede reescribir el
-- contenido de un mensaje ajeno vía un UPDATE directo contra la API.
create policy "mensajes_privados_lideres_update_leido"
  on public.mensajes_privados_lideres for update
  to authenticated
  using (para_usuario_id = auth.uid())
  with check (para_usuario_id = auth.uid());

grant select, insert, update on public.mensajes_privados_lideres to authenticated;

create or replace function public.proteger_mensaje_privado_lider()
returns trigger
language plpgsql
as $$
begin
  new.id := old.id;
  new.de_usuario_id := old.de_usuario_id;
  new.para_usuario_id := old.para_usuario_id;
  new.contenido := old.contenido;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger before_update_mensajes_privados_lideres_proteger
  before update on public.mensajes_privados_lideres
  for each row execute function public.proteger_mensaje_privado_lider();

alter publication supabase_realtime add table public.mensajes_privados_lideres;

-- ------------------------------------------------------------
-- buscar_lideres_chat(): autocompletar del buscador de "nueva
-- conversación" -- solo devuelve gente que califica HOY (igual que
-- todo lo demás acá, se reevalúa en cada búsqueda), nunca a mí mismo.
-- security definer para poder llamar esta_habilitado_chat_lideres()
-- sobre cada candidato sin que column-level RLS de profiles estorbe.
-- ------------------------------------------------------------
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
    and public.esta_habilitado_chat_lideres(p.id)
  order by p.nick
  limit 10;
$$;

grant execute on function public.buscar_lideres_chat(text) to authenticated;

-- ------------------------------------------------------------
-- mis_conversaciones_chat_lideres(): lista de conversaciones privadas
-- existentes (última línea + no leídos), para la pestaña de mensajes
-- privados -- evita traer todos los mensajes al cliente y agruparlos
-- ahí.
-- ------------------------------------------------------------
create or replace function public.mis_conversaciones_chat_lideres()
returns table (
  otro_usuario_id uuid,
  otro_nick text,
  otro_avatar_url text,
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
    u.contenido,
    u.created_at,
    coalesce(nl.cantidad, 0)
  from ultimos u
  join public.profiles p on p.id = u.otro_usuario_id
  left join no_leidos_por_conversacion nl on nl.otro_usuario_id = u.otro_usuario_id
  order by u.created_at desc;
$$;

grant execute on function public.mis_conversaciones_chat_lideres() to authenticated;
