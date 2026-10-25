-- ============================================================
-- Migración 214: "¿Quién es tu papi?" -- sistema de competencia
-- interna del clan ØLD SCHOOL REBØRN (equipo id fijo
-- de0df7cf-ec44-43c3-9e24-cfde9f2161e2), a pedido del usuario.
--
-- Etapa 1 de 2 (el usuario pidió abordarlo por etapas, dado el
-- tamaño): esta migración deja la base de datos COMPLETA --
-- temporadas, jugadores inscriptos, partidas, auditoría, y TODAS las
-- funciones de cálculo (puntos por categoría, recálculo de MMR del
-- evento, paternidades, rankings, títulos) -- pero todavía no suma el
-- flujo de registrar/verificar partidas desde la app (eso es la
-- etapa 2). Mientras tanto, para probar, se siembra una temporada y
-- partidas de prueba directo por SQL (el propio documento del usuario
-- pide mantener esos datos de prueba separados del ranking real, acá
-- ni siquiera hace falta: sin una función de alta desde la app, no
-- hay forma de que se cuelen datos de prueba en producción por
-- accidente).
--
-- Decisiones de diseño:
-- - El "jugador" de este sistema es profiles.id (no se crea una tabla
--   de jugadores nueva) -- pero la raza y la categoría son propias de
--   CADA TEMPORADA de este evento (osr_jugadores), no se reusa
--   profiles_juego.datos->>'raza_principal' porque el documento pide
--   que la raza/categoría quede fija por temporada, y ya existe esa
--   raza del jugador en otro sistema con otro propósito.
-- - El MMR del evento NUNCA es Elo continuo (no se reusa
--   calcular_ajuste_mmr): es la tabla fija de puntos por diferencia de
--   categoría de la sección 5 del documento, implementada en
--   osr_calcular_puntos().
-- - Las paternidades se derivan 100% de partidas verificadas (no hay
--   tabla de paternidades aparte, a diferencia de titulos_padre_hijo
--   de la migración 026, que es un reto/duelo con aceptación -- esto
--   es automático y recalculado, sin reto).
-- - Corregir o eliminar una partida NO reversa un delta a mano:
--   osr_recalcular_temporada() pone todo el MMR de la temporada en 0
--   y reproduce, en orden cronológico, todas las partidas verificadas
--   -- mucho menos propenso a errores que reversar incrementalmente.
-- - Moderadores: lista separada (osr_moderadores), administrada por
--   el dueño del equipo OSR -- no depende de quién sea capitán del
--   equipo en general. El dueño del equipo siempre es moderador
--   automáticamente (es_moderador_osr() lo chequea directo contra
--   teams.owner_id), sin necesitar una fila en osr_moderadores.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------

create table public.osr_temporadas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 80),
  activa boolean not null default false,
  creada_en timestamptz not null default now(),
  cerrada_en timestamptz
);

-- Como mucho una temporada activa a la vez -- índice único parcial
-- sobre la columna booleana (truco estándar: entre las filas con
-- activa = true, todas valen "true", así que solo puede haber una).
create unique index osr_temporadas_una_activa
  on public.osr_temporadas (activa)
  where activa;

alter table public.osr_temporadas enable row level security;

create policy "osr_temporadas_select_publico"
  on public.osr_temporadas for select
  to anon, authenticated
  using (true);

grant select on public.osr_temporadas to anon, authenticated;

-- Sin política de insert/update para authenticated a propósito -- en
-- la etapa 1 se siembra por SQL Editor; en la etapa 2 va a existir una
-- función security definer para abrir/cerrar temporadas.

create table public.osr_moderadores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  agregado_por uuid not null references public.profiles (id),
  agregado_en timestamptz not null default now(),
  unique (user_id)
);

alter table public.osr_moderadores enable row level security;

-- es_moderador_osr() se define ACÁ (antes de cualquier política que
-- la use) y no más abajo en el archivo -- su propio cuerpo consulta
-- esta misma tabla, así que necesita que ya exista; a su vez, las
-- políticas de osr_jugadores/osr_partidas/osr_partidas_auditoria que
-- siguen más abajo necesitan que la función ya exista. Mismo patrón
-- exacto que es_staff()/is_admin(): función auxiliar security
-- definer, usable en cualquier política RLS o función. El dueño del
-- equipo OSR siempre es moderador (no necesita fila en
-- osr_moderadores); cualquier otra cuenta tiene que estar en esta
-- lista separada que administra ese dueño.
create or replace function public.es_moderador_osr()
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.teams
      where id = 'de0df7cf-ec44-43c3-9e24-cfde9f2161e2'
        and owner_id = auth.uid()
    )
    or exists (
      select 1 from public.osr_moderadores where user_id = auth.uid()
    );
$$;

grant execute on function public.es_moderador_osr() to authenticated;

-- Sin esta política, RLS deniega TODO select por defecto (ni siquiera
-- a un moderador real).
create policy "osr_moderadores_select_moderadores"
  on public.osr_moderadores for select
  to authenticated
  using (public.es_moderador_osr());

grant select on public.osr_moderadores to authenticated;

-- Sin tabla de jugadores nueva: el jugador es profiles.id. Esta tabla
-- es la inscripción de ese jugador a UNA temporada de este evento,
-- con su raza y categoría fijas para toda esa temporada.
create table public.osr_jugadores (
  id uuid primary key default gen_random_uuid(),
  temporada_id uuid not null references public.osr_temporadas (id),
  user_id uuid not null references public.profiles (id),
  raza_principal text not null check (raza_principal in ('terran', 'zerg', 'protoss')),
  categoria text not null check (categoria in ('3500', '4000', '4500', '5000', '5500', 'sin_limite')),
  mmr_oficial_inicial integer not null check (mmr_oficial_inicial >= 0),
  mmr_evento integer not null default 0 check (mmr_evento >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (temporada_id, user_id)
);

alter table public.osr_jugadores enable row level security;

create policy "osr_jugadores_select_publico"
  on public.osr_jugadores for select
  to anon, authenticated
  using (true);

grant select on public.osr_jugadores to anon, authenticated;

create table public.osr_partidas (
  id uuid primary key default gen_random_uuid(),
  temporada_id uuid not null references public.osr_temporadas (id),
  jugador_ganador_id uuid not null references public.osr_jugadores (id),
  jugador_perdedor_id uuid not null references public.osr_jugadores (id),
  -- Denormalizado a propósito: las paternidades se calculan cruzando
  -- TODAS las temporadas (el documento pide conservar el historial),
  -- así no hace falta un join a osr_jugadores por cada temporada
  -- distinta solo para saber qué cuenta jugó.
  ganador_user_id uuid not null references public.profiles (id),
  perdedor_user_id uuid not null references public.profiles (id),
  fecha timestamptz not null,
  categoria_ganador text not null check (categoria_ganador in ('3500', '4000', '4500', '5000', '5500', 'sin_limite')),
  categoria_perdedor text not null check (categoria_perdedor in ('3500', '4000', '4500', '5000', '5500', 'sin_limite')),
  mmr_ganador_antes integer not null default 0,
  mmr_ganador_despues integer not null default 0,
  mmr_perdedor_antes integer not null default 0,
  mmr_perdedor_despues integer not null default 0,
  puntos_ganador integer not null default 0,
  puntos_perdedor integer not null default 0,
  fuente_verificacion text,
  evidencia_url text,
  moderador_id uuid references public.profiles (id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'verificada', 'rechazada', 'corregida')),
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (jugador_ganador_id <> jugador_perdedor_id),
  check (ganador_user_id <> perdedor_user_id)
);

create index osr_partidas_temporada_idx on public.osr_partidas (temporada_id, estado, fecha);
create index osr_partidas_ganador_idx on public.osr_partidas (ganador_user_id);
create index osr_partidas_perdedor_idx on public.osr_partidas (perdedor_user_id);

alter table public.osr_partidas enable row level security;

-- Público: solo partidas verificadas (historial público del
-- documento). Moderador: también ve pendientes/rechazadas/corregidas.
create policy "osr_partidas_select_publico_o_moderador"
  on public.osr_partidas for select
  to anon, authenticated
  using (estado = 'verificada' or public.es_moderador_osr());

grant select on public.osr_partidas to anon, authenticated;

create table public.osr_partidas_auditoria (
  id uuid primary key default gen_random_uuid(),
  partida_id uuid not null references public.osr_partidas (id),
  accion text not null check (accion in ('creada', 'verificada', 'rechazada', 'corregida', 'eliminada')),
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  moderador_id uuid not null references public.profiles (id),
  motivo text,
  creado_en timestamptz not null default now()
);

alter table public.osr_partidas_auditoria enable row level security;

create policy "osr_partidas_auditoria_select_moderadores"
  on public.osr_partidas_auditoria for select
  to authenticated
  using (public.es_moderador_osr());

grant select on public.osr_partidas_auditoria to authenticated;

-- ------------------------------------------------------------
-- osr_categoria_indice() / osr_calcular_puntos(): tabla fija de
-- puntos por diferencia de categoría (sección 5 del documento) -- NO
-- es Elo, es una tabla de lookup determinista.
-- ------------------------------------------------------------

create or replace function public.osr_categoria_indice(p_categoria text)
returns smallint
language sql
immutable
as $$
  select case p_categoria
    when '3500' then 1
    when '4000' then 2
    when '4500' then 3
    when '5000' then 4
    when '5500' then 5
    when 'sin_limite' then 6
  end;
$$;

grant execute on function public.osr_categoria_indice(text) to anon, authenticated;

create or replace function public.osr_calcular_puntos(p_categoria_propia text, p_categoria_rival text, p_gano boolean)
returns integer
language sql
immutable
as $$
  select case
    when p_gano then
      case greatest(-4, least(4, public.osr_categoria_indice(p_categoria_rival) - public.osr_categoria_indice(p_categoria_propia)))
        when -4 then 1 when -3 then 1 when -2 then 2 when -1 then 3
        when 0 then 5
        when 1 then 7 when 2 then 9 when 3 then 11 when 4 then 13
      end
    else
      case greatest(-4, least(4, public.osr_categoria_indice(p_categoria_rival) - public.osr_categoria_indice(p_categoria_propia)))
        when -4 then -8 when -3 then -7 when -2 then -6 when -1 then -5
        when 0 then -5
        when 1 then -3 when 2 then -2 when 3 then -1 when 4 then -1
      end
  end;
$$;

grant execute on function public.osr_calcular_puntos(text, text, boolean) to anon, authenticated;

-- ------------------------------------------------------------
-- osr_recalcular_temporada(): mecanismo central de consistencia. Pone
-- el MMR del evento de toda la temporada en 0 y reproduce, en orden
-- cronológico, todas las partidas verificadas -- se usa en la etapa 2
-- cada vez que se verifica, corrige o elimina una partida, pero la
-- función se crea ahora para que ese trabajo sea solo "llamarla".
-- ------------------------------------------------------------

create or replace function public.osr_recalcular_temporada(p_temporada_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida record;
  v_mmr_ganador integer;
  v_mmr_perdedor integer;
  v_puntos_ganador integer;
  v_puntos_perdedor integer;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede recalcular la temporada.';
  end if;

  update public.osr_jugadores set mmr_evento = 0 where temporada_id = p_temporada_id;

  for v_partida in
    select * from public.osr_partidas
    where temporada_id = p_temporada_id and estado = 'verificada'
    order by fecha asc, creado_en asc
  loop
    select mmr_evento into v_mmr_ganador from public.osr_jugadores where id = v_partida.jugador_ganador_id for update;
    select mmr_evento into v_mmr_perdedor from public.osr_jugadores where id = v_partida.jugador_perdedor_id for update;

    v_puntos_ganador := public.osr_calcular_puntos(v_partida.categoria_ganador, v_partida.categoria_perdedor, true);
    v_puntos_perdedor := public.osr_calcular_puntos(v_partida.categoria_perdedor, v_partida.categoria_ganador, false);

    update public.osr_jugadores
      set mmr_evento = greatest(0, v_mmr_ganador + v_puntos_ganador)
      where id = v_partida.jugador_ganador_id;
    update public.osr_jugadores
      set mmr_evento = greatest(0, v_mmr_perdedor + v_puntos_perdedor)
      where id = v_partida.jugador_perdedor_id;

    update public.osr_partidas
      set mmr_ganador_antes = v_mmr_ganador,
          mmr_ganador_despues = greatest(0, v_mmr_ganador + v_puntos_ganador),
          mmr_perdedor_antes = v_mmr_perdedor,
          mmr_perdedor_despues = greatest(0, v_mmr_perdedor + v_puntos_perdedor),
          puntos_ganador = v_puntos_ganador,
          puntos_perdedor = v_puntos_perdedor,
          actualizado_en = now()
      where id = v_partida.id;
  end loop;
end;
$$;

grant execute on function public.osr_recalcular_temporada(uuid) to authenticated;

-- ------------------------------------------------------------
-- Paternidades: 100% derivadas de partidas verificadas, sin tabla
-- aparte. osr_paternidades_historial() cruza TODAS las temporadas
-- (para consultar paternidad histórica); osr_paternidades_temporada()
-- la misma lógica acotada a una temporada puntual.
-- ------------------------------------------------------------

create or replace function public.osr_paternidades_historial()
returns table (
  jugador_a uuid,
  jugador_b uuid,
  victorias_a integer,
  victorias_b integer,
  diferencia integer,
  estado text
)
language sql
stable
set search_path = public
as $$
  with pares as (
    select
      least(ganador_user_id, perdedor_user_id) as jugador_a,
      greatest(ganador_user_id, perdedor_user_id) as jugador_b,
      ganador_user_id
    from public.osr_partidas
    where estado = 'verificada'
  ),
  conteo as (
    select
      jugador_a,
      jugador_b,
      count(*) filter (where ganador_user_id = jugador_a)::int as victorias_a,
      count(*) filter (where ganador_user_id = jugador_b)::int as victorias_b
    from pares
    group by jugador_a, jugador_b
  )
  select
    jugador_a,
    jugador_b,
    victorias_a,
    victorias_b,
    victorias_a - victorias_b as diferencia,
    case
      when victorias_a - victorias_b >= 3 then 'papa_a'
      when victorias_b - victorias_a >= 3 then 'papa_b'
      else 'disputando'
    end as estado
  from conteo;
$$;

grant execute on function public.osr_paternidades_historial() to anon, authenticated;

create or replace function public.osr_paternidades_temporada(p_temporada_id uuid)
returns table (
  jugador_a uuid,
  jugador_b uuid,
  victorias_a integer,
  victorias_b integer,
  diferencia integer,
  estado text
)
language sql
stable
set search_path = public
as $$
  with pares as (
    select
      least(ganador_user_id, perdedor_user_id) as jugador_a,
      greatest(ganador_user_id, perdedor_user_id) as jugador_b,
      ganador_user_id
    from public.osr_partidas
    where estado = 'verificada' and temporada_id = p_temporada_id
  ),
  conteo as (
    select
      jugador_a,
      jugador_b,
      count(*) filter (where ganador_user_id = jugador_a)::int as victorias_a,
      count(*) filter (where ganador_user_id = jugador_b)::int as victorias_b
    from pares
    group by jugador_a, jugador_b
  )
  select
    jugador_a,
    jugador_b,
    victorias_a,
    victorias_b,
    victorias_a - victorias_b as diferencia,
    case
      when victorias_a - victorias_b >= 3 then 'papa_a'
      when victorias_b - victorias_a >= 3 then 'papa_b'
      else 'disputando'
    end as estado
  from conteo;
$$;

grant execute on function public.osr_paternidades_temporada(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- Rankings de la temporada (categoría, Global, razas).
-- ------------------------------------------------------------

create or replace function public.osr_ranking_categoria(p_temporada_id uuid, p_categoria text)
returns table (
  jugador_id uuid,
  user_id uuid,
  nick text,
  raza_principal text,
  mmr_evento integer,
  posicion bigint
)
language sql
stable
set search_path = public
as $$
  select
    j.id as jugador_id,
    j.user_id,
    p.nick,
    j.raza_principal,
    j.mmr_evento,
    row_number() over (order by j.mmr_evento desc, j.creado_en asc) as posicion
  from public.osr_jugadores j
  join public.profiles p on p.id = j.user_id
  where j.temporada_id = p_temporada_id and j.categoria = p_categoria and j.activo
  order by j.mmr_evento desc, j.creado_en asc;
$$;

grant execute on function public.osr_ranking_categoria(uuid, text) to anon, authenticated;

create or replace function public.osr_ranking_global(p_temporada_id uuid)
returns table (
  jugador_id uuid,
  user_id uuid,
  nick text,
  raza_principal text,
  categoria text,
  mmr_evento integer,
  posicion bigint
)
language sql
stable
set search_path = public
as $$
  select
    j.id as jugador_id,
    j.user_id,
    p.nick,
    j.raza_principal,
    j.categoria,
    j.mmr_evento,
    row_number() over (order by j.mmr_evento desc, j.creado_en asc) as posicion
  from public.osr_jugadores j
  join public.profiles p on p.id = j.user_id
  where j.temporada_id = p_temporada_id and j.activo
  order by j.mmr_evento desc, j.creado_en asc;
$$;

grant execute on function public.osr_ranking_global(uuid) to anon, authenticated;

create or replace function public.osr_ranking_razas(p_temporada_id uuid)
returns table (
  raza_principal text,
  jugadores bigint,
  mmr_total bigint,
  mmr_promedio numeric
)
language sql
stable
set search_path = public
as $$
  select
    raza_principal,
    count(*) as jugadores,
    coalesce(sum(mmr_evento), 0) as mmr_total,
    round(coalesce(avg(mmr_evento), 0), 1) as mmr_promedio
  from public.osr_jugadores
  where temporada_id = p_temporada_id and activo
  group by raza_principal;
$$;

grant execute on function public.osr_ranking_razas(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- Top 5 de etiquetas: Papi Dios, Papi Regador, Padrastro, Mascota del
-- Clan. "Papi" (por categoría) no necesita función aparte: es la
-- primera fila de osr_ranking_categoria().
-- ------------------------------------------------------------

create or replace function public.osr_top5_papi_dios(p_temporada_id uuid)
returns table (
  user_id uuid,
  nick text,
  mmr_evento integer,
  diferencia_con_lider integer,
  posicion bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select user_id, nick, mmr_evento
    from public.osr_ranking_global(p_temporada_id)
    limit 5
  ),
  lider as (
    select coalesce(max(mmr_evento), 0) as max_mmr from base
  )
  select
    b.user_id,
    b.nick,
    b.mmr_evento,
    (select max_mmr from lider) - b.mmr_evento as diferencia_con_lider,
    row_number() over (order by b.mmr_evento desc) as posicion
  from base b
  order by b.mmr_evento desc;
$$;

grant execute on function public.osr_top5_papi_dios(uuid) to anon, authenticated;

create or replace function public.osr_top5_papi_regador(p_temporada_id uuid)
returns table (
  user_id uuid,
  nick text,
  hijos integer,
  padres integer,
  mmr_evento integer,
  posicion bigint
)
language sql
stable
set search_path = public
as $$
  with pats as (
    select * from public.osr_paternidades_temporada(p_temporada_id)
  ),
  hijos_por_jugador as (
    select jugador_a as user_id, count(*)::int as hijos from pats where estado = 'papa_a' group by jugador_a
    union all
    select jugador_b as user_id, count(*)::int as hijos from pats where estado = 'papa_b' group by jugador_b
  ),
  padres_por_jugador as (
    select jugador_b as user_id, count(*)::int as padres from pats where estado = 'papa_a' group by jugador_b
    union all
    select jugador_a as user_id, count(*)::int as padres from pats where estado = 'papa_b' group by jugador_a
  ),
  hijos_totales as (
    select user_id, sum(hijos)::int as hijos from hijos_por_jugador group by user_id
  ),
  padres_totales as (
    select user_id, sum(padres)::int as padres from padres_por_jugador group by user_id
  )
  select
    h.user_id,
    p.nick,
    h.hijos,
    coalesce(pt.padres, 0) as padres,
    coalesce(j.mmr_evento, 0) as mmr_evento,
    row_number() over (order by h.hijos desc) as posicion
  from hijos_totales h
  join public.profiles p on p.id = h.user_id
  left join padres_totales pt on pt.user_id = h.user_id
  left join public.osr_jugadores j on j.user_id = h.user_id and j.temporada_id = p_temporada_id
  order by h.hijos desc
  limit 5;
$$;

grant execute on function public.osr_top5_papi_regador(uuid) to anon, authenticated;

create or replace function public.osr_top5_mascota(p_temporada_id uuid)
returns table (
  user_id uuid,
  nick text,
  mmr_evento integer,
  padres integer,
  hijos integer,
  posicion bigint
)
language sql
stable
set search_path = public
as $$
  with pats as (
    select * from public.osr_paternidades_temporada(p_temporada_id)
  ),
  padres_por_jugador as (
    select jugador_b as user_id, count(*)::int as padres from pats where estado = 'papa_a' group by jugador_b
    union all
    select jugador_a as user_id, count(*)::int as padres from pats where estado = 'papa_b' group by jugador_a
  ),
  hijos_por_jugador as (
    select jugador_a as user_id, count(*)::int as hijos from pats where estado = 'papa_a' group by jugador_a
    union all
    select jugador_b as user_id, count(*)::int as hijos from pats where estado = 'papa_b' group by jugador_b
  ),
  padres_totales as (
    select user_id, sum(padres)::int as padres from padres_por_jugador group by user_id
  ),
  hijos_totales as (
    select user_id, sum(hijos)::int as hijos from hijos_por_jugador group by user_id
  )
  select
    j.user_id,
    p.nick,
    j.mmr_evento,
    coalesce(pt.padres, 0) as padres,
    coalesce(ht.hijos, 0) as hijos,
    row_number() over (order by j.mmr_evento asc, coalesce(pt.padres, 0) desc) as posicion
  from public.osr_jugadores j
  join public.profiles p on p.id = j.user_id
  left join padres_totales pt on pt.user_id = j.user_id
  left join hijos_totales ht on ht.user_id = j.user_id
  where j.temporada_id = p_temporada_id and j.activo
  order by j.mmr_evento asc, coalesce(pt.padres, 0) desc
  limit 5;
$$;

grant execute on function public.osr_top5_mascota(uuid) to anon, authenticated;

-- Padrastro: ventaja neta de al menos 10 victorias sobre UN rival
-- puntual (no se suman ventajas de rivales distintos). Desempate
-- determinista: mayor diferencia -> más victorias directas -> mayor
-- MMR del evento (si persiste el empate, lo resuelve el moderador a
-- mano -- eso ya es etapa 2).
create or replace function public.osr_titulo_padrastro(p_temporada_id uuid)
returns table (
  candidato_user_id uuid,
  rival_user_id uuid,
  victorias_candidato integer,
  victorias_rival integer,
  diferencia integer,
  mmr_evento integer,
  posicion integer
)
language sql
stable
set search_path = public
as $$
  with pats as (
    select * from public.osr_paternidades_temporada(p_temporada_id)
  ),
  candidatos as (
    select jugador_a as candidato_user_id, jugador_b as rival_user_id, victorias_a as victorias_candidato, victorias_b as victorias_rival, diferencia
    from pats where diferencia >= 10
    union all
    select jugador_b, jugador_a, victorias_b, victorias_a, -diferencia
    from pats where -diferencia >= 10
  ),
  con_mmr as (
    select c.*, coalesce(j.mmr_evento, 0) as mmr_evento
    from candidatos c
    left join public.osr_jugadores j on j.user_id = c.candidato_user_id and j.temporada_id = p_temporada_id
  )
  select
    candidato_user_id,
    rival_user_id,
    victorias_candidato,
    victorias_rival,
    diferencia,
    mmr_evento,
    row_number() over (order by diferencia desc, victorias_candidato desc, mmr_evento desc)::int as posicion
  from con_mmr
  order by diferencia desc, victorias_candidato desc, mmr_evento desc
  limit 5;
$$;

grant execute on function public.osr_titulo_padrastro(uuid) to anon, authenticated;
