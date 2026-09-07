-- ------------------------------------------------------------
-- Migración 067: catálogo de fondos de imagen para la sala de lineup,
-- administrable desde el Panel de Administración (el dueño/admin sube
-- la imagen, le pone un nombre, y a partir de ahí cualquier capitán o
-- dueño de los dos equipos puede elegirla para su Clan War, igual que
-- ya podía elegir los 4 fondos clásicos de la migración 051). Los
-- fondos clásicos (CSS, sin imagen) NO se tocan ni se sacan -- este es
-- un catálogo ADICIONAL, no un reemplazo.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fondos-lineup',
  'fondos-lineup',
  true,
  5242880,
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;

create policy "fondos_lineup_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'fondos-lineup');

-- Solo admin sube y borra -- a diferencia de avatars/banners (donde
-- cada cuenta sube lo suyo, en su propia carpeta), acá no hay
-- "carpeta propia": es un catálogo curado por la plataforma.
create policy "fondos_lineup_subida_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'fondos-lineup' and public.is_admin());

create policy "fondos_lineup_borrado_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'fondos-lineup' and public.is_admin());

create table public.catalogo_fondos_lineup (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 2 and 40),
  image_url text not null,
  creado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.catalogo_fondos_lineup enable row level security;

create policy "catalogo_fondos_lineup_select_publico"
  on public.catalogo_fondos_lineup for select
  using (true);

create policy "catalogo_fondos_lineup_insert_admin"
  on public.catalogo_fondos_lineup for insert
  to authenticated
  with check (public.is_admin());

create policy "catalogo_fondos_lineup_delete_admin"
  on public.catalogo_fondos_lineup for delete
  to authenticated
  using (public.is_admin());

grant select on public.catalogo_fondos_lineup to anon, authenticated;
grant insert, delete on public.catalogo_fondos_lineup to authenticated;

-- Null = ninguna imagen elegida, rige fondo_lineup (los 4 clásicos o
-- "ninguno") como hasta ahora. "on delete set null": si el admin borra
-- una imagen del catálogo, las Clan Wars que la tenían elegida no
-- quedan rotas, simplemente vuelven a "ninguno".
alter table public.clan_wars add column fondo_lineup_imagen_id uuid references public.catalogo_fondos_lineup (id) on delete set null;

-- cambiar_fondo_lineup_cw(): mismo cuerpo de siempre, ahora también
-- limpia fondo_lineup_imagen_id -- un fondo clásico y uno de imagen
-- son mutuamente excluyentes, nunca los dos a la vez.
create or replace function public.cambiar_fondo_lineup_cw(p_clan_war_id uuid, p_fondo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_fondo not in ('ninguno', 'campo_estrellas', 'nebulosa', 'constelacion', 'vortice') then
    raise exception 'Ese fondo no es válido.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar el fondo.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El fondo de la sala de lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set fondo_lineup = p_fondo, fondo_lineup_imagen_id = null where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_fondo_lineup_cw(uuid, text) to authenticated;

-- Elegir un fondo del catálogo de imágenes -- mismo permiso y mismas
-- condiciones que el de arriba, mutuamente excluyente con los fondos
-- clásicos (p_imagen_id = null equivale a "ninguna imagen", vuelve al
-- fondo clásico que ya estuviera elegido).
create or replace function public.cambiar_fondo_lineup_imagen_cw(p_clan_war_id uuid, p_imagen_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_imagen_id is not null and not exists (select 1 from public.catalogo_fondos_lineup where id = p_imagen_id) then
    raise exception 'Ese fondo no existe.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar el fondo.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El fondo de la sala de lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars
    set fondo_lineup_imagen_id = p_imagen_id, fondo_lineup = case when p_imagen_id is not null then 'ninguno' else fondo_lineup end
    where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_fondo_lineup_imagen_cw(uuid, uuid) to authenticated;

-- lineup_publico_clan_war(): se extiende con la raza de cada jugador
-- (para el ícono de la tarjeta) y con el fondo elegido (clásico o de
-- imagen) -- el resto del cuerpo queda igual.
drop function if exists public.lineup_publico_clan_war(uuid);

create or replace function public.lineup_publico_clan_war(p_clan_war_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revelado', public.revelado_lineup_cw(cw.id),
    'formato', cw.formato,
    'status', cw.status,
    'fecha_hora_cet', cw.fecha_hora_cet,
    'challenger', jsonb_build_object('nombre', tc.name, 'tag', tc.tag, 'logo_url', tc.logo_url),
    'challenged', jsonb_build_object('nombre', td.name, 'tag', td.tag, 'logo_url', td.logo_url),
    'caster_nombre', cw.caster_nombre,
    'caster_link', cw.caster_link,
    'fondo_clasico', cw.fondo_lineup,
    'fondo_imagen_url', (select f.image_url from public.catalogo_fondos_lineup f where f.id = cw.fondo_lineup_imagen_id),
    'lineup_challenger', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenger_team_id
    ) else null end,
    'lineup_challenged', case when public.revelado_lineup_cw(cw.id) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'nombre', coalesce(p.nick || '#' || p.unique_id, tp.nick_temporal, 'Jugador de RemorApp'),
          'posicion', l.posicion,
          'es_temporal', l.jugador_temporal_id is not null,
          'raza', (
            select pj.datos ->> 'raza_principal'
            from public.perfiles_juego pj
            join public.catalogo_juegos cj on cj.id = pj.juego_id
            where pj.user_id = l.jugador_id and cj.nombre = 'StarCraft II'
          )
        )
        order by l.posicion nulls last
      ), '[]'::jsonb)
      from public.clan_war_lineup l
      left join public.profiles p on p.id = l.jugador_id
      left join public.team_temp_players tp on tp.id = l.jugador_temporal_id
      where l.clan_war_id = cw.id and l.team_id = cw.challenged_team_id
    ) else null end
  )
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  where cw.id = p_clan_war_id;
$$;

grant execute on function public.lineup_publico_clan_war(uuid) to anon, authenticated;
