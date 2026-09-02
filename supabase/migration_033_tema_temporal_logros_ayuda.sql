-- ============================================================
-- Migración 033: cuatro funciones nuevas para el Panel de control de
-- equipo y para el resto de la app.
--
--   1) Apariencia del equipo: teams.tema_equipo (7 paletas fijas).
--   2) Jugador temporal: team_temp_players, con reemplazo manual por
--      una cuenta real (nunca automático).
--   3) Logros y Recompensas: NO se agrega ningún catálogo nuevo acá.
--      El pedido menciona "el catálogo de la Fase B" para recompensas
--      desbloqueadas por nivel, pero ese catálogo no existe en ningún
--      lugar del proyecto (se buscó en todas las migraciones y en el
--      código -- la única mención es un comentario viejo de la
--      migración 013, ya reemplazada, que decía "sin skins todavía,
--      fase aparte que viene", y nunca se construyó). La sección
--      "Logros y Recompensas" en el frontend queda como vitrina con
--      un aviso de que ese catálogo todavía no existe, en vez de
--      inventar datos -- ver el mensaje aparte que se le manda al
--      usuario. No hace falta ninguna tabla nueva para esto.
--   4) Ayuda (reemplaza a Foro) + sugerencias_lider + reportes_staff.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ---------- 1) Apariencia del equipo ----------

alter table public.teams
  add column if not exists tema_equipo text not null default 'cian'
    check (tema_equipo in ('cian', 'purpura', 'esmeralda', 'ambar', 'rosa', 'carmesi', 'azul'));

revoke update on public.teams from authenticated;

grant update (description, logo_url, banner_url, tema_equipo) on public.teams to authenticated;

-- ---------- 2) Jugador temporal ----------

create table public.team_temp_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Misma regla de nick que profiles.nick (migración 011).
  nick_temporal text not null check (nick_temporal ~ '^[A-Za-z0-9_Øø]{3,13}$'),
  creado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- null = todavía temporal. Cuando se reemplaza, apunta a la cuenta
  -- real -- la fila NUNCA se borra, queda como registro de que ese
  -- puesto del roster empezó siendo temporal.
  reemplazado_por uuid references public.profiles (id)
);

alter table public.team_temp_players enable row level security;

-- Público: se muestra en el roster/line-up de la página del equipo,
-- igual que team_members.
create policy "team_temp_players_select_publico"
  on public.team_temp_players for select
  using (true);

grant select on public.team_temp_players to anon, authenticated;

-- Crear y reemplazar quedan atrás de funciones (no de un grant de
-- insert/update directo): las dos necesitan validar que quien llama
-- sea el dueño del equipo, y reemplazar además necesita buscar el
-- perfil real por Nick#ID atómicamente.
create or replace function public.crear_jugador_temporal(p_team_id uuid, p_nick_temporal text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.teams where id = p_team_id and owner_id = auth.uid()) then
    raise exception 'Solo el dueño del equipo puede crear un jugador temporal.';
  end if;

  if p_nick_temporal !~ '^[A-Za-z0-9_Øø]{3,13}$' then
    raise exception 'El nick temporal debe tener entre 3 y 13 caracteres: letras, números, guion bajo y Ø/ø.';
  end if;

  insert into public.team_temp_players (team_id, nick_temporal, creado_por)
  values (p_team_id, p_nick_temporal, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.crear_jugador_temporal(uuid, text) to authenticated;

-- Reemplazo MANUAL únicamente -- busca por Nick#ID exacto, nunca por
-- coincidencia de nombre. No inscribe a la cuenta real como miembro
-- de verdad (team_members): eso sigue siendo la invitación normal, si
-- el líder la quiere de verdad en el equipo. Esto solo resuelve qué
-- se muestra en el puesto del roster que antes era temporal.
create or replace function public.reemplazar_jugador_temporal(p_temp_id uuid, p_nick text, p_unique_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temp record;
  v_perfil_id uuid;
begin
  select * into v_temp from public.team_temp_players where id = p_temp_id for update;
  if v_temp is null then
    raise exception 'Ese jugador temporal no existe.';
  end if;
  if v_temp.reemplazado_por is not null then
    raise exception 'Ese jugador temporal ya fue reemplazado.';
  end if;

  if not exists (select 1 from public.teams where id = v_temp.team_id and owner_id = auth.uid()) then
    raise exception 'Solo el dueño del equipo puede reemplazar un jugador temporal.';
  end if;

  select id into v_perfil_id from public.profiles where nick = p_nick and unique_id = p_unique_id;
  if v_perfil_id is null then
    raise exception 'No encontré ningún jugador con ese Nick#ID.';
  end if;

  update public.team_temp_players set reemplazado_por = v_perfil_id where id = p_temp_id;
end;
$$;

grant execute on function public.reemplazar_jugador_temporal(uuid, text, text) to authenticated;

-- ---------- 4) Ayuda: sugerencias de líder de clan ----------

create table public.sugerencias_lider (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  autor_id uuid not null references public.profiles (id),
  texto text not null check (char_length(texto) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.sugerencias_lider enable row level security;

-- Sin sistema de votos todavía (a propósito, tal como se pidió): solo
-- lectura para administradores, nadie más ve las sugerencias de otros.
create policy "sugerencias_lider_select_admin"
  on public.sugerencias_lider for select
  to authenticated
  using (public.is_admin());

create policy "sugerencias_lider_insert_propio"
  on public.sugerencias_lider for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and exists (select 1 from public.teams where owner_id = auth.uid())
  );

grant select, insert on public.sugerencias_lider to authenticated;

-- ---------- 4) Reportar un problema al staff ----------

create table public.reportes_staff (
  id uuid primary key default gen_random_uuid(),
  reportado_por uuid not null references public.profiles (id),
  asunto text not null check (char_length(asunto) between 1 and 150),
  descripcion text not null check (char_length(descripcion) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.reportes_staff enable row level security;

create policy "reportes_staff_select_admin"
  on public.reportes_staff for select
  to authenticated
  using (public.is_admin());

create policy "reportes_staff_insert_propio"
  on public.reportes_staff for insert
  to authenticated
  with check (reportado_por = auth.uid());

grant select, insert on public.reportes_staff to authenticated;
