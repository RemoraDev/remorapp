-- ------------------------------------------------------------
-- Migración 071: Delfin Mode -- primera versión real. Chat de texto en
-- tiempo real por equipo, usando Supabase Realtime (Postgres Changes).
-- La voz en tiempo real queda deliberadamente afuera de esta migración
-- -- requiere decidir infraestructura externa (LiveKit/Agora) que hoy
-- no está disponible, no se puede construir solo con lo que ya
-- tenemos.
-- ------------------------------------------------------------

create table public.mensajes_equipo (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  autor_id uuid not null references public.profiles (id) on delete cascade,
  contenido text not null check (char_length(contenido) between 1 and 500),
  created_at timestamptz not null default now()
);

-- La lectura siempre pagina/filtra por equipo y ordena por fecha: este
-- índice cubre exactamente ese acceso.
create index mensajes_equipo_team_id_created_at_idx
  on public.mensajes_equipo (team_id, created_at);

alter table public.mensajes_equipo enable row level security;

-- team_members.user_id es la primary key de esa tabla (un jugador
-- pertenece a un solo equipo a la vez) -- el subselect siempre trae
-- como máximo una fila, y si el usuario no tiene equipo, team_id da
-- null y la comparación nunca es verdadera para ninguna fila.
create policy "mensajes_equipo_select_miembros"
  on public.mensajes_equipo for select
  to authenticated
  using (
    team_id = (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
  );

create policy "mensajes_equipo_insert_miembros"
  on public.mensajes_equipo for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and not public.esta_suspendido()
    and team_id = (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
  );

grant select, insert on public.mensajes_equipo to authenticated;

-- Habilita Supabase Realtime (Postgres Changes) para esta tabla. Cada
-- cliente conectado sigue sujeto al RLS de arriba: solo recibe los
-- INSERT de las filas que su propia política de select ya le
-- permitiría leer, así que un jugador de otro equipo nunca ve estos
-- mensajes en tiempo real aunque esté suscripto al canal.
alter publication supabase_realtime add table public.mensajes_equipo;
