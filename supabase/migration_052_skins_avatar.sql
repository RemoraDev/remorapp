-- ------------------------------------------------------------
-- Migración 052: Catálogo de skins de avatar (10 skins, SVG/CSS
-- generadas en código, sin imágenes externas). Por ahora, exclusivo
-- del dueño de la plataforma -- el resto de las cuentas no puede ver
-- ni elegir ninguna todavía.
--
-- "clave" es un agregado necesario más allá de los 3 campos pedidos
-- (id, nombre, descripcion): es la llave técnica y estable que usa el
-- frontend para elegir qué componente/CSS renderizar por cada skin,
-- independiente del texto de "nombre" (que podría cambiar sin romper
-- el selector).
-- ------------------------------------------------------------

create table public.catalogo_skins_avatar (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  descripcion text not null
);

alter table public.catalogo_skins_avatar enable row level security;

-- Mismo patrón que dueno_actividad_log (migración 016): using()
-- evalúa el privilegio de quien consulta, no una columna de la fila
-- -- así, si es_dueno_plataforma() es falso, la tabla completa queda
-- invisible (cero filas), no solo bloqueada para elegir.
create policy "catalogo_skins_avatar_select_dueno"
  on public.catalogo_skins_avatar for select
  using (public.es_dueno_plataforma());

grant select on public.catalogo_skins_avatar to authenticated;

insert into public.catalogo_skins_avatar (clave, nombre, descripcion) values
  ('fuego_electricidad', 'Fuego con electricidad', 'Llamas ardientes cruzadas por descargas eléctricas.'),
  ('demoniaca', 'Demoníaca', 'Un brillo rojo oscuro que pulsa como un corazón maligno.'),
  ('elfica', 'Élfica', 'Enredaderas doradas y verdes que laten con luz natural.'),
  ('orca', 'Orca', 'Textura áspera de bestia salvaje, verde oscuro y marrón.'),
  ('sagrada', 'Sagrada', 'Un aura celestial de luz blanca y dorada.'),
  ('cristal_negro', 'Cristal negro', 'Facetas de cristal oscuro con reflejos que se deslizan.'),
  ('gatitos', 'Gatitos', 'Huellitas y orejitas en tonos pastel, puro juego.'),
  ('zerg', 'Zerg', 'Biomasa morada con venas que laten al ritmo del enjambre.'),
  ('protoss', 'Protoss', 'Líneas psiónicas doradas y azules, tecnología angulosa.'),
  ('terran', 'Terran', 'Blindaje metálico gris acero con un escaneo sutil.');

-- Skin actualmente activa del perfil -- null significa "sin skin,
-- avatar normal". Referencia al catálogo para que solo se pueda
-- activar una skin que exista de verdad.
alter table public.profiles
  add column skin_avatar_activa uuid references public.catalogo_skins_avatar (id);

-- Se agrega al mismo grant de columnas públicas de siempre (migración
-- 017): es solo un puntero (uuid), inofensivo aunque hoy el catálogo
-- en sí sea privado -- deja el terreno listo para cuando la skin
-- activa del dueño se muestre también en su perfil público, sin
-- necesitar otra migración para eso.
grant select (skin_avatar_activa) on public.profiles to anon, authenticated;

-- Única puerta para activar/quitar una skin: valida el privilegio y
-- que la skin exista, en vez de dejarlo como un update de columna
-- directo (que no podría validar nada de esto).
create or replace function public.activar_skin_avatar(p_skin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno_plataforma() then
    raise exception 'Las skins de avatar todavía son exclusivas del dueño de la plataforma.';
  end if;

  if p_skin_id is not null and not exists (select 1 from public.catalogo_skins_avatar where id = p_skin_id) then
    raise exception 'Esa skin no existe.';
  end if;

  update public.profiles set skin_avatar_activa = p_skin_id where id = auth.uid();
end;
$$;

grant execute on function public.activar_skin_avatar(uuid) to authenticated;
