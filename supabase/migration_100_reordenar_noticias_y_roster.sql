-- ------------------------------------------------------------
-- Migración 100: dos reordenamientos por arrastrar y soltar
-- (dnd-kit, ya instalado para el bracket manual) -- sin lógica nueva,
-- solo una columna de orden y una función que la actualiza.
--
-- Nota de numeración: las migraciones "098" (Lucide/Sonner/PWA) y
-- "099" (cmdk/motion/html-to-image) de las dos tareas anteriores no
-- tocaron la base -- eran puramente de frontend, así que no generaron
-- archivo. Esta sí, y sigue la numeración real de archivos (la
-- anterior fue la 097), no la de los comentarios "migración 098/099"
-- que van a quedar en ProximasClanWars.tsx/App.tsx/SearchContext.tsx.
--
-- 1) noticias.orden -- reordenamiento manual de las noticias
--    publicadas, solo para is_admin() o es_staff(). Las noticias
--    nuevas entran siempre primero (mismo criterio que el orden por
--    fecha que había antes de esta migración), vía un trigger, así
--    que publicar una noticia nueva no requiere ningún cambio en
--    AdminPage.tsx.
-- 2) team_members.orden_visual -- puramente cosmético, reordena cómo
--    se ve el roster en la ficha pública del equipo. Nullable a
--    propósito: los miembros existentes (y los que se sumen después
--    sin que nadie los reordene a mano) se siguen mostrando por
--    joined_at, como hasta ahora.
-- ------------------------------------------------------------

alter table public.noticias add column orden integer not null default 0;

-- Backfill: mismo orden visual que ya tenían por created_at desc.
update public.noticias set orden = sub.rn
from (
  select id, row_number() over (order by created_at desc) as rn
  from public.noticias
) sub
where public.noticias.id = sub.id;

-- Cada noticia nueva entra primero -- mismo lugar donde aparecía con
-- el "order by created_at desc" de siempre, antes de que alguien la
-- reordene a mano.
create or replace function public.asignar_orden_noticia_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(min(orden), 0) - 1 into new.orden from public.noticias;
  return new;
end;
$$;

create trigger before_insert_noticias_orden
  before insert on public.noticias
  for each row execute function public.asignar_orden_noticia_nueva();

create or replace function public.reordenar_noticias(p_orden uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i int;
  v_total int;
begin
  if not (public.is_admin() or public.es_staff()) then
    raise exception 'Solo un administrador o staff puede reordenar las noticias.';
  end if;

  select count(*) into v_total from public.noticias;
  if coalesce(array_length(p_orden, 1), 0) <> v_total then
    raise exception 'La lista de orden tiene que incluir todas las noticias publicadas.';
  end if;

  for v_i in 1..array_length(p_orden, 1) loop
    update public.noticias set orden = v_i where id = p_orden[v_i];
  end loop;
end;
$$;

grant execute on function public.reordenar_noticias(uuid[]) to authenticated;

alter table public.team_members add column orden_visual integer;

create or replace function public.reordenar_roster_equipo(p_team_id uuid, p_orden uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i int;
  v_total int;
begin
  if not public.es_capitan_o_dueno(p_team_id) then
    raise exception 'Solo el dueño o un capitán puede reordenar el roster.';
  end if;

  select count(*) into v_total from public.team_members where team_id = p_team_id;
  if coalesce(array_length(p_orden, 1), 0) <> v_total then
    raise exception 'La lista de orden tiene que incluir a todos los miembros del equipo.';
  end if;

  for v_i in 1..array_length(p_orden, 1) loop
    update public.team_members
      set orden_visual = v_i
      where user_id = p_orden[v_i] and team_id = p_team_id;
  end loop;
end;
$$;

grant execute on function public.reordenar_roster_equipo(uuid, uuid[]) to authenticated;
