-- ------------------------------------------------------------
-- Migración 102c: falta una política de DELETE para el bucket
-- "guerra-razas" -- sin ella, ni siquiera quien subió una imagen puede
-- borrarla (se descubrió al intentar limpiar las imágenes de prueba
-- de la migración 102: la API de Storage devolvía éxito pero sin
-- borrar nada, por RLS). Mismo alcance que la política de subida: solo
-- la propia carpeta (uid del que subió).
-- ------------------------------------------------------------

create policy "guerra_razas_imagenes_borrado_propio"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'guerra-razas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
