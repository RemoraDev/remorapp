-- ------------------------------------------------------------
-- Migración 065: tabla noticias -- todavía no existe ningún sistema
-- de publicaciones en la plataforma (NewsSection.tsx hoy solo muestra
-- un aviso "Próximamente", sin tabla detrás). Esta migración crea la
-- tabla mínima necesaria para que el Panel de Administración pueda
-- listar y eliminar noticias -- NO agrega ninguna pantalla de
-- publicar/redactar noticias (no fue parte de este pedido), solo la
-- base de datos y la facultad de eliminar. La política de insert
-- queda igual restringida a is_admin(), lista para cuando exista esa
-- pantalla más adelante.
-- ------------------------------------------------------------
create table public.noticias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 3 and 120),
  contenido text not null check (char_length(contenido) between 1 and 4000),
  publicado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.noticias enable row level security;

create policy "noticias_select_publico"
  on public.noticias for select
  using (true);

create policy "noticias_insert_admin"
  on public.noticias for insert
  to authenticated
  with check (public.is_admin());

grant select on public.noticias to anon, authenticated;
grant insert on public.noticias to authenticated;

create or replace function public.admin_eliminar_noticia(p_noticia_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar una noticia.';
  end if;

  delete from public.noticias where id = p_noticia_id;
end;
$$;

grant execute on function public.admin_eliminar_noticia(uuid) to authenticated;
