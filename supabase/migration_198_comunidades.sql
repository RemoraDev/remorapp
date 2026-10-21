create table public.comunidades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 3 and 40),
  descripcion text,
  banner_url text,
  logo_url text,
  creador_id uuid not null references public.profiles (id),
  creado_en timestamptz not null default now()
);

create table public.comunidad_miembros (
  id uuid primary key default gen_random_uuid(),
  comunidad_id uuid not null references public.comunidades (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  unido_en timestamptz not null default now(),
  unique (comunidad_id, user_id)
);

create index comunidad_miembros_comunidad_id_idx on public.comunidad_miembros (comunidad_id);
create index comunidad_miembros_user_id_idx on public.comunidad_miembros (user_id);

alter table public.comunidades enable row level security;
alter table public.comunidad_miembros enable row level security;

create policy "comunidades_lectura_publica"
  on public.comunidades for select
  using (true);

create policy "comunidades_crear_propia"
  on public.comunidades for insert
  to authenticated
  with check (creador_id = auth.uid());

create policy "comunidades_editar_propia"
  on public.comunidades for update
  to authenticated
  using (creador_id = auth.uid())
  with check (creador_id = auth.uid());

create policy "comunidades_borrar_propia"
  on public.comunidades for delete
  to authenticated
  using (creador_id = auth.uid());

create policy "comunidad_miembros_lectura_publica"
  on public.comunidad_miembros for select
  using (true);

create policy "comunidad_miembros_unirse_propio"
  on public.comunidad_miembros for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "comunidad_miembros_salir_propio"
  on public.comunidad_miembros for delete
  to authenticated
  using (user_id = auth.uid());

-- Crea la comunidad y de paso inscribe a quien la crea como su
-- primer integrante (así "Mis comunidades" la muestra de inmediato).
create or replace function public.crear_comunidad(p_nombre text, p_descripcion text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_comunidad_id uuid;
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  v_nombre := trim(p_nombre);
  if char_length(v_nombre) < 3 or char_length(v_nombre) > 40 then
    raise exception 'El nombre tiene que tener entre 3 y 40 caracteres.';
  end if;

  insert into public.comunidades (nombre, descripcion, creador_id)
  values (v_nombre, nullif(trim(p_descripcion), ''), auth.uid())
  returning id into v_comunidad_id;

  insert into public.comunidad_miembros (comunidad_id, user_id)
  values (v_comunidad_id, auth.uid());

  return v_comunidad_id;
end;
$$;

grant execute on function public.crear_comunidad(text, text) to authenticated;

-- El creador no puede salir de su propia comunidad (quedaría sin
-- nadie que la administre) -- tiene que eliminarla desde el Panel de
-- control si ya no la quiere.
create or replace function public.salir_comunidad(p_comunidad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.comunidades where id = p_comunidad_id and creador_id = auth.uid()
  ) then
    raise exception 'Eres el creador de esta comunidad, no puedes salir -- puedes eliminarla desde el Panel de control.';
  end if;

  delete from public.comunidad_miembros
  where comunidad_id = p_comunidad_id and user_id = auth.uid();
end;
$$;

grant execute on function public.salir_comunidad(uuid) to authenticated;

-- ------------------------------------------------------------
-- Eventos vinculados a una comunidad: "Crear evento de comunidad"
-- reusa el mismo formulario de siempre (CreateTournamentPage), solo
-- que el evento creado queda etiquetado con esta comunidad.
-- Torneo por ligas y Race War pasan por tournaments (comunidad_id acá
-- alcanza para los dos); Clan War Amistosa es una fila de clan_wars
-- aparte, por eso necesita su propia columna.
-- ------------------------------------------------------------
alter table public.tournaments add column comunidad_id uuid references public.comunidades (id) on delete set null;
alter table public.clan_wars add column comunidad_id uuid references public.comunidades (id) on delete set null;

drop function if exists public.crear_race_war(text);

create or replace function public.crear_race_war(p_titulo text default null, p_comunidad_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_race_war_id uuid;
  v_titulo text;
  v_equipo_id uuid;
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  v_titulo := nullif(trim(p_titulo), '');

  select team_id into v_equipo_id
  from public.team_members
  where user_id = auth.uid()
  limit 1;

  -- Valores placeholder en las columnas que exige tournaments pero que
  -- un Race War nunca usa (formato/modo/cupos_totales/fecha_inicio) --
  -- nadie se inscribe ni juega partidas acá, es solo el anfitrión
  -- técnico del marcador.
  insert into public.tournaments (
    nombre, formato, modo, publico, cupos_totales, fecha_inicio, creador_id, comunidad_id
  ) values (
    coalesce(v_titulo, 'Race War'), '1v1', 'eliminacion_simple', false, 2, now(), auth.uid(), p_comunidad_id
  )
  returning id into v_tournament_id;

  insert into public.guerra_razas (tournament_id, creado_por, equipo_creador_id)
  values (v_tournament_id, auth.uid(), v_equipo_id)
  returning id into v_race_war_id;

  return v_race_war_id;
end;
$$;

grant execute on function public.crear_race_war(text, uuid) to authenticated;

create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null,
  p_jugadores_por_set integer default 3,
  p_mapas_por_set integer default 2,
  p_titulo text default null,
  p_comunidad_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
  v_titulo text;
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;
  if p_jugadores_por_set is null or p_jugadores_por_set < 1 then
    raise exception 'La cantidad de jugadores por lado tiene que ser al menos 1.';
  end if;
  if p_mapas_por_set is null or p_mapas_por_set < 1 then
    raise exception 'El "Bo" de cada set tiene que ser al menos 1.';
  end if;

  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
  end if;

  if v_challenger.disuelto then
    raise exception 'Tu equipo está disuelto.';
  end if;
  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  v_titulo := nullif(trim(p_titulo), '');

  insert into public.clan_wars (
    challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id,
    jugadores_por_set, mapas_por_set, titulo, comunidad_id
  )
  values (
    v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id,
    p_jugadores_por_set, p_mapas_por_set,
    coalesce(v_titulo, v_challenger.tag || ' vs ' || v_challenged.tag),
    p_comunidad_id
  );
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid, integer, integer, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- Storage: banner y logo de comunidad, mismo patrón que team-banners/
-- team-logos (carpeta por uid de quien sube, público para lectura).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comunidad-logos',
  'comunidad-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "comunidad_logos_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'comunidad-logos');

create policy "comunidad_logos_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'comunidad-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comunidad-banners',
  'comunidad-banners',
  true,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "comunidad_banners_lectura_publica"
  on storage.objects for select
  using (bucket_id = 'comunidad-banners');

create policy "comunidad_banners_subida_propia"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'comunidad-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
