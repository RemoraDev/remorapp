-- ============================================================
-- Migración 034: Perfiles de juego agnósticos -- hoy solo StarCraft
-- II, pero con estructura lista para agregar otros juegos después sin
-- rehacer nada: catalogo_juegos es el catálogo de juegos soportados,
-- y perfiles_juego guarda los datos específicos de cada juego por
-- usuario en un jsonb libre (nunca se agrega una columna nueva a
-- profiles por cada juego que se sume más adelante).
--
-- A propósito, "datos" no tiene ningún check constraint sobre su
-- forma: esta tabla es compartida entre todos los juegos futuros, así
-- que validar la forma exacta (por ejemplo, que raza_principal sea
-- 'Terran'/'Zerg'/'Protoss') queda del lado del frontend -- el mismo
-- <select> que ya restringe las opciones. Agregar un constraint acá
-- específico de StarCraft II hubiera sido exactamente lo que se pidió
-- evitar ("sin rehacer nada" al sumar el próximo juego).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

create table public.catalogo_juegos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true
);

alter table public.catalogo_juegos enable row level security;

create policy "catalogo_juegos_select_publico"
  on public.catalogo_juegos for select
  using (true);

grant select on public.catalogo_juegos to anon, authenticated;

insert into public.catalogo_juegos (nombre, activo) values ('StarCraft II', true);

create table public.perfiles_juego (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  juego_id uuid not null references public.catalogo_juegos (id),
  datos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Un usuario no puede tener dos filas para el mismo juego.
  unique (user_id, juego_id)
);

alter table public.perfiles_juego enable row level security;

-- Público: se muestra en el roster del equipo y en el perfil público
-- del jugador, igual que el resto de la identidad de SC2.
create policy "perfiles_juego_select_publico"
  on public.perfiles_juego for select
  using (true);

create policy "perfiles_juego_insert_propio"
  on public.perfiles_juego for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "perfiles_juego_update_propio"
  on public.perfiles_juego for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.perfiles_juego to anon, authenticated;
grant insert, update on public.perfiles_juego to authenticated;
