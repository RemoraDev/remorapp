-- ------------------------------------------------------------
-- Migración 102: "Guerra de Razas" -- marcador en vivo con temática
-- StarCraft II (Protoss/Terran/Zerg), como complemento opcional de un
-- torneo. Es independiente del propio bracket: no participa en el
-- avance de partidas ni en generar_llave(), es solo un panel de
-- puntaje y jugadores destacados por raza que el organizador controla
-- y que cualquiera con el link ve actualizarse en vivo (Realtime).
--
-- guerra_razas: una fila por torneo (unique en tournament_id). Los
-- puntajes iniciales (19/18/10) son el default que pidió el
-- organizador, no un cálculo -- se ajustan a mano desde ahí en
-- adelante con los botones +1/-1.
--
-- guerra_razas_jugadores: jugadores "destacados" que el organizador
-- carga a mano por categoría (rango de MMR) y raza, sin relación con
-- tournament_participants -- es una lista informativa para el
-- marcador, no inscripción real a nada.
-- ------------------------------------------------------------

create table public.guerra_razas (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  creado_por uuid not null references public.profiles (id),
  puntos_protoss integer not null default 19,
  puntos_terran integer not null default 18,
  puntos_zerg integer not null default 10,
  imagen_protoss_url text,
  imagen_terran_url text,
  imagen_zerg_url text,
  creado_en timestamptz not null default now(),
  unique (tournament_id)
);

create table public.guerra_razas_jugadores (
  id uuid primary key default gen_random_uuid(),
  guerra_id uuid not null references public.guerra_razas (id) on delete cascade,
  categoria text not null check (categoria in ('3500', '4000', '4500', '5000', 'sin_limite')),
  raza text not null check (raza in ('protoss', 'terran', 'zerg')),
  nombre text not null check (char_length(trim(nombre)) between 1 and 40),
  elegido boolean not null default false,
  creado_en timestamptz not null default now()
);

create index guerra_razas_jugadores_guerra_id_idx on public.guerra_razas_jugadores (guerra_id);

alter table public.guerra_razas enable row level security;
alter table public.guerra_razas_jugadores enable row level security;

-- Lectura pública en ambas tablas: es un marcador para compartir por
-- link, cualquiera que lo abra (con sesión o sin ella) tiene que
-- poder verlo sin pedir permiso.
create policy "guerra_razas_select_publico"
  on public.guerra_razas for select
  using (true);

create policy "guerra_razas_jugadores_select_publico"
  on public.guerra_razas_jugadores for select
  using (true);

-- Solo se crea una fila al activar el checkbox al crear el torneo, y
-- solo el propio organizador de ESE torneo puede hacerlo (no cualquier
-- usuario autenticado apuntando a un tournament_id ajeno).
create policy "guerra_razas_insert_organizador"
  on public.guerra_razas for insert
  to authenticated
  with check (
    creado_por = auth.uid()
    and exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.creador_id = auth.uid()
    )
  );

create policy "guerra_razas_update_organizador"
  on public.guerra_razas for update
  to authenticated
  using (creado_por = auth.uid())
  with check (creado_por = auth.uid());

create policy "guerra_razas_jugadores_insert_organizador"
  on public.guerra_razas_jugadores for insert
  to authenticated
  with check (
    exists (
      select 1 from public.guerra_razas g
      where g.id = guerra_id and g.creado_por = auth.uid()
    )
  );

create policy "guerra_razas_jugadores_update_organizador"
  on public.guerra_razas_jugadores for update
  to authenticated
  using (
    exists (
      select 1 from public.guerra_razas g
      where g.id = guerra_id and g.creado_por = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.guerra_razas g
      where g.id = guerra_id and g.creado_por = auth.uid()
    )
  );

create policy "guerra_razas_jugadores_delete_organizador"
  on public.guerra_razas_jugadores for delete
  to authenticated
  using (
    exists (
      select 1 from public.guerra_razas g
      where g.id = guerra_id and g.creado_por = auth.uid()
    )
  );

grant select on public.guerra_razas to anon, authenticated;
grant insert, update on public.guerra_razas to authenticated;
grant select on public.guerra_razas_jugadores to anon, authenticated;
grant insert, update, delete on public.guerra_razas_jugadores to authenticated;

-- Realtime: mismo mecanismo que ya se dejó habilitado para
-- mensajes_equipo (migración 071, "Delfin Mode") -- cualquiera con la
-- página abierta recibe los cambios de puntaje/jugadores sin recargar.
alter publication supabase_realtime add table public.guerra_razas;
alter publication supabase_realtime add table public.guerra_razas_jugadores;

-- Bucket para las 3 imágenes de mascota (Protoss/Terran/Zerg), mismo
-- patrón que team-logos: carpeta por uid de quien sube, público para
-- lectura.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guerra-razas',
  'guerra-razas',
  true,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "guerra_razas_imagenes_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'guerra-razas');

create policy "guerra_razas_imagenes_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'guerra-razas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
