create policy "comunidad_miembros_quitar_creador"
  on public.comunidad_miembros for delete
  to authenticated
  using (
    exists (
      select 1 from public.comunidades c
      where c.id = comunidad_miembros.comunidad_id and c.creador_id = auth.uid()
    )
  );
