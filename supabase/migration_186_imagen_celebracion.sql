alter table public.tournaments add column imagen_celebracion_url text;

alter table public.teams add column imagen_celebracion_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'celebraciones',
  'celebraciones',
  true,
  3145728,
  array['image/webp']
)
on conflict (id) do nothing;

create policy "celebraciones_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'celebraciones');

create policy "celebraciones_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'celebraciones'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

grant update (imagen_celebracion_url) on public.teams to authenticated;
