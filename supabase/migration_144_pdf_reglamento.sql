-- Migración 144: reglamento en PDF para un torneo/liga -- subido en
-- cualquier momento (no obligatorio al crear) desde el Panel de
-- organizador, y mostrado embebido con PDF.js (sin redirigir afuera de
-- RemorApp) en la ficha pública del torneo.
--
-- Va en tournaments, no en ligas: "ligas" (la tabla) es apenas un
-- catálogo compartido (id + nombre, sin dueño ni Panel de control
-- propio -- ver "StarLeague Latam"/"BTL"/"VTL" ya insertados) que
-- varias temporadas pueden referenciar por liga_id; el reglamento es
-- por EDICIÓN/temporada concreta, que sí tiene organizador
-- (tournaments.creador_id) y ya tiene su propio Panel de organizador.
--
-- Sin RPC propia: tournaments_update_organizador (RLS, ya existe)
-- permite al organizador actualizar cualquier columna de su propio
-- torneo -- alcanza con un update directo desde el frontend, mismo
-- patrón que fondo_bracket/banner_url/etc.

alter table public.tournaments add column pdf_reglamento_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reglamentos',
  'reglamentos',
  true,
  10485760,
  array['application/pdf']
)
on conflict (id) do nothing;

create policy "reglamentos_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'reglamentos');

create policy "reglamentos_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'reglamentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
