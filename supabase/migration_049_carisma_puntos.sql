-- ============================================================
-- Migración 049: Carisma pasa a ser un contador de PUNTOS que solo
-- sube, sin tope -- reemplaza el diseño anterior (0-100 con tope,
-- migración 036/039), que todavía no tenía ninguna lógica real que lo
-- moviera. Por ahora, SOLO para casters -- el lado de equipo queda
-- para otro pedido aparte.
--
-- 1) profiles.carisma pierde el tope de 100 (el check pasa a exigir
--    solo >= 0) y el default cambia a 0 para cuentas NUEVAS de acá en
--    adelante -- las cuentas existentes, con su carisma actual (100
--    por default hasta ahora), no se tocan.
-- 2) carisma_log: de dónde salió cada punto -- mismo patrón que
--    dueno_actividad_log (tabla de solo lectura para quien
--    corresponda, insert únicamente vía función security definer,
--    nunca directo desde el cliente).
-- 3) +10 de carisma al crear un torneo (trigger en tournaments, ya que
--    se insertan con un INSERT directo del cliente, no por una RPC) o
--    al proponer una Clan War (dentro de proponer_clan_war(), que sí
--    es una RPC y ya conoce a auth.uid()) -- en los dos casos, solo si
--    quien lo hizo tiene es_caster = true.
-- 4) caster_likes + dar_like_caster(): +1 de carisma por like, máximo
--    uno por (caster, quien da el like) por día -- con un índice único
--    sobre la fecha en UTC, no solo una regla de la aplicación.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) profiles.carisma: sin tope, default 0 para cuentas nuevas.
-- ------------------------------------------------------------

-- El check original (carisma >= 0 and carisma <= 100) se creó sin
-- nombre explícito en el create table -- se busca y se borra por su
-- definición real en vez de asumir el nombre que Postgres le puso
-- solo, para no depender de una convención de nombres que podría no
-- cumplirse.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
    where rel.relname = 'profiles'
      and att.attname = 'carisma'
      and con.contype = 'c'
  loop
    execute format('alter table public.profiles drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.profiles add constraint profiles_carisma_check check (carisma >= 0);
alter table public.profiles alter column carisma set default 0;

-- ------------------------------------------------------------
-- 2) carisma_log: registro de cada punto otorgado.
-- ------------------------------------------------------------
create table public.carisma_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cantidad integer not null,
  origen text not null check (origen in ('evento_creado', 'like')),
  created_at timestamptz not null default now()
);

alter table public.carisma_log enable row level security;

-- Público, igual que el resto de la vitrina de un caster -- de dónde
-- salió cada punto no es información privada.
create policy "carisma_log_select_publico"
  on public.carisma_log for select
  using (true);

-- Sin política de insert para authenticated a propósito -- la única
-- forma de escribir acá es registrar_carisma(), security definer, sin
-- grant a authenticated tampoco (solo se llama desde otras funciones y
-- triggers de la base, nunca directo desde el cliente).
grant select on public.carisma_log to anon, authenticated;

create or replace function public.registrar_carisma(p_user_id uuid, p_cantidad integer, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set carisma = carisma + p_cantidad where id = p_user_id;
  insert into public.carisma_log (user_id, cantidad, origen) values (p_user_id, p_cantidad, p_origen);
end;
$$;

-- ------------------------------------------------------------
-- 3) +10 de carisma al crear un torneo o proponer una Clan War, solo
--    si quien lo hizo es caster.
-- ------------------------------------------------------------

-- tournaments se inserta con un INSERT directo del cliente (ver
-- CreateTournamentPage.tsx), no hay ninguna RPC de por medio -- un
-- trigger es la única forma de engancharse ahí sin reescribir esa
-- pantalla para que pase por una función nueva.
create or replace function public.otorgar_carisma_torneo_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_caster boolean;
begin
  select es_caster into v_es_caster from public.profiles where id = new.creador_id;
  if v_es_caster then
    perform public.registrar_carisma(new.creador_id, 10, 'evento_creado');
  end if;
  return new;
end;
$$;

drop trigger if exists after_insert_tournaments_carisma on public.tournaments;
create trigger after_insert_tournaments_carisma
  after insert on public.tournaments
  for each row execute function public.otorgar_carisma_torneo_creado();

-- proponer_clan_war(): mismo nombre y firma de siempre -- se agrega el
-- otorgamiento de carisma al final, sin tocar ninguna validación
-- existente. auth.uid() ya se conoce acá adentro (es quien está
-- proponiendo), a diferencia de tournaments, que no guarda ese dato
-- por usuario.
create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null
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
  v_es_caster boolean;
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;

  if p_temporada_id is not null and not exists (select 1 from public.temporadas where id = p_temporada_id) then
    raise exception 'Esa temporada no existe.';
  end if;

  -- Migración 038: ya no solo el dueño -- cualquier miembro que sea
  -- dueño o capitán de su equipo. team_members.user_id es primary key,
  -- así que solo puede pertenecer a un equipo a la vez.
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
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
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

  -- Cooldown de 7 días desde el último reto entre estos dos equipos,
  -- en cualquier dirección y sin importar el resultado (pendiente,
  -- aceptada, rechazada o cancelada cuentan igual).
  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id);

  select es_caster into v_es_caster from public.profiles where id = auth.uid();
  if v_es_caster then
    perform public.registrar_carisma(auth.uid(), 10, 'evento_creado');
  end if;
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Likes: +1 de carisma, máximo uno por caster por día.
-- ------------------------------------------------------------
create table public.caster_likes (
  id uuid primary key default gen_random_uuid(),
  caster_id uuid not null references public.profiles (id) on delete cascade,
  dado_por uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (caster_id <> dado_por)
);

alter table public.caster_likes enable row level security;

create policy "caster_likes_select_publico"
  on public.caster_likes for select
  using (true);

-- Sin política de insert para authenticated -- la única forma de
-- escribir acá es dar_like_caster(), security definer.
grant select on public.caster_likes to anon, authenticated;

-- Un like por (caster, quien lo da) por día -- calculado en UTC, fijo
-- de antemano con "at time zone 'utc'" para que la expresión sea
-- inmutable (un cast directo timestamptz::date depende del huso
-- horario de la sesión, que no lo es, y Postgres exige una función
-- inmutable para un índice).
create unique index caster_likes_un_like_por_dia
  on public.caster_likes (caster_id, dado_por, ((created_at at time zone 'utc')::date));

create or replace function public.dar_like_caster(p_caster_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_caster boolean;
begin
  if p_caster_id = auth.uid() then
    raise exception 'No puedes darte like a ti mismo.';
  end if;

  select es_caster into v_es_caster from public.profiles where id = p_caster_id;
  if v_es_caster is null then
    raise exception 'Ese jugador no existe.';
  end if;
  if not v_es_caster then
    raise exception 'Ese jugador no es caster.';
  end if;

  begin
    insert into public.caster_likes (caster_id, dado_por) values (p_caster_id, auth.uid());
  exception
    when unique_violation then
      raise exception 'Ya le diste like a este caster hoy. Puedes volver a darle mañana.';
  end;

  perform public.registrar_carisma(p_caster_id, 1, 'like');
end;
$$;

grant execute on function public.dar_like_caster(uuid) to authenticated;
