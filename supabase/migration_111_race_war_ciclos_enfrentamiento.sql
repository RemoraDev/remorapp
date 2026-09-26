-- ------------------------------------------------------------
-- Migración 111: Race War -- "Enfrentamiento" y "Tabla de Posiciones",
-- conectadas por el concepto de "ciclo" (una vuelta completa: tantos
-- encuentros como jugadores tenga la raza más numerosa de esa
-- categoría). Todo dentro de la misma arquitectura ya existente
-- (Supabase Realtime, RLS, RPCs security definer) -- ninguna tabla ni
-- función nueva reinventa un mecanismo que ya tenía Marcador.
--
-- Diseño de puntaje (mismo criterio 3/1/0 en los dos niveles): un
-- resultado Bo3 se guarda como "X-Y" (juegos ganados por la primera
-- raza nombrada en el campo - la segunda), y puntos_por_resultado_bo3()
-- traduce juegos ganados a puntos: 2 juegos -> 3 puntos (ganó el
-- Bo3), 1 juego -> 1 punto (perdió 1-2), 0 juegos -> 0 puntos (perdió
-- 0-2). La raza suma esto en CADA encuentro finalizado, sin
-- excepción; el jugador solo lo suma en su PRIMER encuentro dentro del
-- ciclo actual (sumando sus dos resultados parciales, uno por cada
-- rival que le tocó ese encuentro).
-- ------------------------------------------------------------

create or replace function public.puntos_por_resultado_bo3(p_juegos_ganados integer)
returns integer
language sql
immutable
as $$
  select case p_juegos_ganados when 2 then 3 when 1 then 1 else 0 end;
$$;

-- ------------------------------------------------------------
-- guerra_razas_ciclos: una fila por (guerra_id, categoria) -- el
-- "categoria" de Marcador ya era una columna de guerra_razas_jugadores,
-- no de guerra_razas, así que la duración del ciclo (que depende de
-- cuántos jugadores tiene la raza más numerosa DE ESA CATEGORÍA) no
-- podía vivir en guerra_razas mismo sin mezclar las 5 categorías en un
-- solo número.
-- ------------------------------------------------------------
create table public.guerra_razas_ciclos (
  id uuid primary key default gen_random_uuid(),
  guerra_id uuid not null references public.guerra_razas (id) on delete cascade,
  categoria text not null check (categoria in ('3500', '4000', '4500', '5000', 'sin_limite')),
  numero_ciclo_actual integer not null default 1,
  -- Recalculada sola por el trigger de abajo cada vez que cambia la
  -- lista de jugadores de esta categoría -- nunca se escribe a mano.
  duracion_ciclo_actual integer not null default 0,
  encuentros_jugados_en_ciclo integer not null default 0,
  unique (guerra_id, categoria)
);

alter table public.guerra_razas_ciclos enable row level security;

create policy "guerra_razas_ciclos_select_publico"
  on public.guerra_razas_ciclos for select
  using (true);

grant select on public.guerra_razas_ciclos to anon, authenticated;

alter publication supabase_realtime add table public.guerra_razas_ciclos;

-- Recalcula duracion_ciclo_actual (la cantidad de jugadores de la
-- raza con más jugadores, en esa categoría) cada vez que la lista de
-- guerra_razas_jugadores cambia -- inserción, baja, o un cambio de
-- categoría/raza en una fila existente (hoy la UI no lo permite, pero
-- la tabla sí, así que se cubre por las dudas). No toca
-- numero_ciclo_actual ni encuentros_jugados_en_ciclo: ese avance solo
-- lo decide generar_encuentro_guerra_razas().
create or replace function public.recalcular_duracion_ciclo_guerra_razas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guerra_id uuid := coalesce(new.guerra_id, old.guerra_id);
  v_categoria text := coalesce(new.categoria, old.categoria);
  v_duracion integer;
begin
  select greatest(
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'protoss'),
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'terran'),
    (select count(*) from public.guerra_razas_jugadores where guerra_id = v_guerra_id and categoria = v_categoria and raza = 'zerg')
  ) into v_duracion;

  insert into public.guerra_razas_ciclos (guerra_id, categoria, duracion_ciclo_actual)
  values (v_guerra_id, v_categoria, v_duracion)
  on conflict (guerra_id, categoria) do update set duracion_ciclo_actual = excluded.duracion_ciclo_actual;

  -- Si un UPDATE cambió de categoría (o de raza), la categoría VIEJA
  -- también perdió o ganó un jugador -- se recalcula aparte.
  if TG_OP = 'UPDATE' and (old.categoria is distinct from new.categoria or old.raza is distinct from new.raza) then
    select greatest(
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'protoss'),
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'terran'),
      (select count(*) from public.guerra_razas_jugadores where guerra_id = old.guerra_id and categoria = old.categoria and raza = 'zerg')
    ) into v_duracion;

    insert into public.guerra_razas_ciclos (guerra_id, categoria, duracion_ciclo_actual)
    values (old.guerra_id, old.categoria, v_duracion)
    on conflict (guerra_id, categoria) do update set duracion_ciclo_actual = excluded.duracion_ciclo_actual;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger after_change_guerra_razas_jugadores_ciclo
  after insert or update or delete on public.guerra_razas_jugadores
  for each row execute function public.recalcular_duracion_ciclo_guerra_razas();

-- ------------------------------------------------------------
-- guerra_razas_encuentros: un enfrentamiento triangular (Protoss vs
-- Terran vs Zerg) dentro de una categoría, con sus 3 resultados Bo3.
-- Los 3 jugadores son obligatorios (un encuentro no puede generarse
-- sin los 3 elegidos, ver generar_encuentro_guerra_razas()); las
-- imágenes son opcionales (si no se sube una, se usa el ícono de la
-- raza por defecto, igual que en Marcador). Sin "on delete cascade"
-- hacia guerra_razas_jugadores a propósito: borrar a un jugador que ya
-- jugó un encuentro rompería el historial de puntaje, así que ese
-- DELETE queda bloqueado por la llave foránea (mismo criterio ya
-- aplicado en otras tablas de historial de esta base).
-- ------------------------------------------------------------
create table public.guerra_razas_encuentros (
  id uuid primary key default gen_random_uuid(),
  guerra_id uuid not null references public.guerra_razas (id) on delete cascade,
  categoria text not null check (categoria in ('3500', '4000', '4500', '5000', 'sin_limite')),
  jugador_protoss_id uuid not null references public.guerra_razas_jugadores (id),
  jugador_terran_id uuid not null references public.guerra_razas_jugadores (id),
  jugador_zerg_id uuid not null references public.guerra_razas_jugadores (id),
  imagen_protoss_url text,
  imagen_terran_url text,
  imagen_zerg_url text,
  -- "X-Y": juegos ganados por la primera raza nombrada - la segunda.
  resultado_protoss_terran text check (resultado_protoss_terran is null or resultado_protoss_terran in ('2-0', '2-1', '1-2', '0-2')),
  resultado_terran_zerg text check (resultado_terran_zerg is null or resultado_terran_zerg in ('2-0', '2-1', '1-2', '0-2')),
  resultado_protoss_zerg text check (resultado_protoss_zerg is null or resultado_protoss_zerg in ('2-0', '2-1', '1-2', '0-2')),
  finalizado boolean not null default false,
  numero_ciclo integer not null,
  creado_en timestamptz not null default now()
);

create index guerra_razas_encuentros_guerra_categoria_idx
  on public.guerra_razas_encuentros (guerra_id, categoria, creado_en);

alter table public.guerra_razas_encuentros enable row level security;

-- Lectura pública -- el modo lector (OBS) necesita ver el encuentro en
-- vivo igual que el resto de Marcador. Sin ninguna política de
-- insert/update/delete para authenticated a propósito: toda escritura
-- pasa por las 3 funciones de abajo (security definer), así nadie
-- puede finalizar un encuentro (y disparar el reparto de puntos) con
-- un UPDATE directo que se salte esa lógica.
create policy "guerra_razas_encuentros_select_publico"
  on public.guerra_razas_encuentros for select
  using (true);

grant select on public.guerra_razas_encuentros to anon, authenticated;

alter publication supabase_realtime add table public.guerra_razas_encuentros;

-- ------------------------------------------------------------
-- guerra_razas_puntos_jugador: puntos de UN jugador en UN ciclo
-- específico -- una sola fila por (guerra_id, categoria, jugador_id,
-- numero_ciclo), escrita una sola vez (su primer encuentro finalizado
-- de ese ciclo) y nunca más tocada hasta el ciclo siguiente. El
-- historial de ciclos anteriores queda guardado tal cual (filtrar por
-- numero_ciclo), aunque por ahora no hay una pantalla dedicada a
-- consultarlo -- Tabla de Posiciones solo muestra el ciclo actual.
-- ------------------------------------------------------------
create table public.guerra_razas_puntos_jugador (
  id uuid primary key default gen_random_uuid(),
  guerra_id uuid not null references public.guerra_razas (id) on delete cascade,
  categoria text not null check (categoria in ('3500', '4000', '4500', '5000', 'sin_limite')),
  jugador_id uuid not null references public.guerra_razas_jugadores (id),
  numero_ciclo integer not null,
  puntos integer not null default 0,
  creado_en timestamptz not null default now(),
  unique (guerra_id, categoria, jugador_id, numero_ciclo)
);

alter table public.guerra_razas_puntos_jugador enable row level security;

create policy "guerra_razas_puntos_jugador_select_publico"
  on public.guerra_razas_puntos_jugador for select
  using (true);

grant select on public.guerra_razas_puntos_jugador to anon, authenticated;

alter publication supabase_realtime add table public.guerra_razas_puntos_jugador;

-- ------------------------------------------------------------
-- generar_encuentro_guerra_razas(): toma al jugador marcado "elegido"
-- de cada raza en esa categoría (el mismo botón de estrella que ya
-- existía en Marcador -- no se agrega un selector nuevo), arma el
-- encuentro, y antes de crearlo revisa si el ciclo anterior ya llegó a
-- su duración -- si es así, avanza numero_ciclo_actual y resetea el
-- contador ANTES de etiquetar este encuentro nuevo con el ciclo que
-- corresponda.
-- ------------------------------------------------------------
create or replace function public.generar_encuentro_guerra_razas(p_guerra_id uuid, p_categoria text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
  v_jugador_protoss uuid;
  v_jugador_terran uuid;
  v_jugador_zerg uuid;
  v_ciclo public.guerra_razas_ciclos;
  v_nuevo_id uuid;
begin
  select creado_por into v_creador_id from public.guerra_razas where id = p_guerra_id;
  if v_creador_id is null or v_creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede generar un encuentro.';
  end if;

  if p_categoria not in ('3500', '4000', '4500', '5000', 'sin_limite') then
    raise exception 'Categoría inválida.';
  end if;

  if exists (
    select 1 from public.guerra_razas_encuentros
    where guerra_id = p_guerra_id and categoria = p_categoria and not finalizado
  ) then
    raise exception 'Ya hay un encuentro sin finalizar en esta categoría.';
  end if;

  select id into v_jugador_protoss from public.guerra_razas_jugadores
    where guerra_id = p_guerra_id and categoria = p_categoria and raza = 'protoss' and elegido
    order by creado_en desc limit 1;
  select id into v_jugador_terran from public.guerra_razas_jugadores
    where guerra_id = p_guerra_id and categoria = p_categoria and raza = 'terran' and elegido
    order by creado_en desc limit 1;
  select id into v_jugador_zerg from public.guerra_razas_jugadores
    where guerra_id = p_guerra_id and categoria = p_categoria and raza = 'zerg' and elegido
    order by creado_en desc limit 1;

  if v_jugador_protoss is null or v_jugador_terran is null or v_jugador_zerg is null then
    raise exception 'Marca un jugador elegido (la estrella) de cada raza en Marcador antes de generar el encuentro.';
  end if;

  -- El trigger de guerra_razas_jugadores ya mantiene esta fila viva;
  -- este insert es solo por si esta categoría nunca tuvo un jugador
  -- cargado y por lo tanto nunca disparó el trigger.
  insert into public.guerra_razas_ciclos (guerra_id, categoria)
  values (p_guerra_id, p_categoria)
  on conflict (guerra_id, categoria) do nothing;

  select * into v_ciclo from public.guerra_razas_ciclos
    where guerra_id = p_guerra_id and categoria = p_categoria for update;

  if v_ciclo.duracion_ciclo_actual > 0 and v_ciclo.encuentros_jugados_en_ciclo >= v_ciclo.duracion_ciclo_actual then
    update public.guerra_razas_ciclos
    set numero_ciclo_actual = numero_ciclo_actual + 1, encuentros_jugados_en_ciclo = 0
    where guerra_id = p_guerra_id and categoria = p_categoria
    returning * into v_ciclo;
  end if;

  insert into public.guerra_razas_encuentros (
    guerra_id, categoria, jugador_protoss_id, jugador_terran_id, jugador_zerg_id, numero_ciclo
  ) values (
    p_guerra_id, p_categoria, v_jugador_protoss, v_jugador_terran, v_jugador_zerg, v_ciclo.numero_ciclo_actual
  )
  returning id into v_nuevo_id;

  return v_nuevo_id;
end;
$$;

grant execute on function public.generar_encuentro_guerra_razas(uuid, text) to authenticated;

-- actualizar_resultado_encuentro_guerra_razas(): un resultado por
-- llamada, identificado por p_pairing ('protoss_terran' | 'terran_zerg'
-- | 'protoss_zerg') -- sin SQL dinámico, un IF/ELSIF alcanza para 3
-- columnas fijas.
create or replace function public.actualizar_resultado_encuentro_guerra_razas(
  p_encuentro_id uuid,
  p_pairing text,
  p_resultado text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  if p_pairing not in ('protoss_terran', 'terran_zerg', 'protoss_zerg') then
    raise exception 'Enfrentamiento inválido.';
  end if;
  if p_resultado is not null and p_resultado not in ('2-0', '2-1', '1-2', '0-2') then
    raise exception 'Resultado inválido.';
  end if;

  select ge.* into v_enc
  from public.guerra_razas_encuentros ge
  join public.guerra_razas g on g.id = ge.guerra_id
  where ge.id = p_encuentro_id and g.creado_por = auth.uid()
  for update of ge;

  if v_enc is null then
    raise exception 'No tienes permiso sobre este encuentro, o no existe.';
  end if;
  if v_enc.finalizado then
    raise exception 'Este encuentro ya está finalizado.';
  end if;

  if p_pairing = 'protoss_terran' then
    update public.guerra_razas_encuentros set resultado_protoss_terran = p_resultado where id = p_encuentro_id;
  elsif p_pairing = 'terran_zerg' then
    update public.guerra_razas_encuentros set resultado_terran_zerg = p_resultado where id = p_encuentro_id;
  else
    update public.guerra_razas_encuentros set resultado_protoss_zerg = p_resultado where id = p_encuentro_id;
  end if;
end;
$$;

grant execute on function public.actualizar_resultado_encuentro_guerra_razas(uuid, text, text) to authenticated;

-- actualizar_imagen_encuentro_guerra_razas(): mismo patrón que la
-- imagen de mascota en Marcador, pero por encuentro y por raza.
create or replace function public.actualizar_imagen_encuentro_guerra_razas(
  p_encuentro_id uuid,
  p_raza text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  if p_raza not in ('protoss', 'terran', 'zerg') then
    raise exception 'Raza inválida.';
  end if;

  select ge.* into v_enc
  from public.guerra_razas_encuentros ge
  join public.guerra_razas g on g.id = ge.guerra_id
  where ge.id = p_encuentro_id and g.creado_por = auth.uid()
  for update of ge;

  if v_enc is null then
    raise exception 'No tienes permiso sobre este encuentro, o no existe.';
  end if;

  if p_raza = 'protoss' then
    update public.guerra_razas_encuentros set imagen_protoss_url = p_url where id = p_encuentro_id;
  elsif p_raza = 'terran' then
    update public.guerra_razas_encuentros set imagen_terran_url = p_url where id = p_encuentro_id;
  else
    update public.guerra_razas_encuentros set imagen_zerg_url = p_url where id = p_encuentro_id;
  end if;
end;
$$;

grant execute on function public.actualizar_imagen_encuentro_guerra_razas(uuid, text, text) to authenticated;

-- finalizar_encuentro_guerra_razas(): el corazón del reparto de
-- puntos. Exige los 3 resultados cargados; la raza suma en cada
-- llamada (sin excepción), el jugador solo si este es su primer
-- encuentro finalizado del ciclo (sus DOS resultados parciales de
-- ESTE encuentro, sumados una sola vez).
create or replace function public.finalizar_encuentro_guerra_razas(p_encuentro_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_guerra_id uuid;
  v_pt_p integer; v_pt_t integer;
  v_tz_t integer; v_tz_z integer;
  v_pz_p integer; v_pz_z integer;
  v_delta_protoss integer;
  v_delta_terran integer;
  v_delta_zerg integer;
begin
  select ge.* into v_enc
  from public.guerra_razas_encuentros ge
  join public.guerra_razas g on g.id = ge.guerra_id
  where ge.id = p_encuentro_id and g.creado_por = auth.uid()
  for update of ge;

  if v_enc is null then
    raise exception 'No tienes permiso sobre este encuentro, o no existe.';
  end if;
  if v_enc.finalizado then
    raise exception 'Este encuentro ya está finalizado.';
  end if;
  if v_enc.resultado_protoss_terran is null or v_enc.resultado_terran_zerg is null or v_enc.resultado_protoss_zerg is null then
    raise exception 'Completa los 3 resultados antes de finalizar.';
  end if;

  v_guerra_id := v_enc.guerra_id;

  v_pt_p := split_part(v_enc.resultado_protoss_terran, '-', 1)::integer;
  v_pt_t := split_part(v_enc.resultado_protoss_terran, '-', 2)::integer;
  v_tz_t := split_part(v_enc.resultado_terran_zerg, '-', 1)::integer;
  v_tz_z := split_part(v_enc.resultado_terran_zerg, '-', 2)::integer;
  v_pz_p := split_part(v_enc.resultado_protoss_zerg, '-', 1)::integer;
  v_pz_z := split_part(v_enc.resultado_protoss_zerg, '-', 2)::integer;

  v_delta_protoss := public.puntos_por_resultado_bo3(v_pt_p) + public.puntos_por_resultado_bo3(v_pz_p);
  v_delta_terran := public.puntos_por_resultado_bo3(v_pt_t) + public.puntos_por_resultado_bo3(v_tz_t);
  v_delta_zerg := public.puntos_por_resultado_bo3(v_tz_z) + public.puntos_por_resultado_bo3(v_pz_z);

  update public.guerra_razas
  set puntos_protoss = puntos_protoss + v_delta_protoss,
      puntos_terran = puntos_terran + v_delta_terran,
      puntos_zerg = puntos_zerg + v_delta_zerg
  where id = v_guerra_id;

  update public.guerra_razas_encuentros set finalizado = true where id = p_encuentro_id;

  update public.guerra_razas_ciclos
  set encuentros_jugados_en_ciclo = encuentros_jugados_en_ciclo + 1
  where guerra_id = v_enc.guerra_id and categoria = v_enc.categoria;

  if not exists (
    select 1 from public.guerra_razas_puntos_jugador
    where guerra_id = v_enc.guerra_id and categoria = v_enc.categoria
      and jugador_id = v_enc.jugador_protoss_id and numero_ciclo = v_enc.numero_ciclo
  ) then
    insert into public.guerra_razas_puntos_jugador (guerra_id, categoria, jugador_id, numero_ciclo, puntos)
    values (
      v_enc.guerra_id, v_enc.categoria, v_enc.jugador_protoss_id, v_enc.numero_ciclo,
      public.puntos_por_resultado_bo3(v_pt_p) + public.puntos_por_resultado_bo3(v_pz_p)
    );
  end if;

  if not exists (
    select 1 from public.guerra_razas_puntos_jugador
    where guerra_id = v_enc.guerra_id and categoria = v_enc.categoria
      and jugador_id = v_enc.jugador_terran_id and numero_ciclo = v_enc.numero_ciclo
  ) then
    insert into public.guerra_razas_puntos_jugador (guerra_id, categoria, jugador_id, numero_ciclo, puntos)
    values (
      v_enc.guerra_id, v_enc.categoria, v_enc.jugador_terran_id, v_enc.numero_ciclo,
      public.puntos_por_resultado_bo3(v_pt_t) + public.puntos_por_resultado_bo3(v_tz_t)
    );
  end if;

  if not exists (
    select 1 from public.guerra_razas_puntos_jugador
    where guerra_id = v_enc.guerra_id and categoria = v_enc.categoria
      and jugador_id = v_enc.jugador_zerg_id and numero_ciclo = v_enc.numero_ciclo
  ) then
    insert into public.guerra_razas_puntos_jugador (guerra_id, categoria, jugador_id, numero_ciclo, puntos)
    values (
      v_enc.guerra_id, v_enc.categoria, v_enc.jugador_zerg_id, v_enc.numero_ciclo,
      public.puntos_por_resultado_bo3(v_tz_z) + public.puntos_por_resultado_bo3(v_pz_z)
    );
  end if;
end;
$$;

grant execute on function public.finalizar_encuentro_guerra_razas(uuid) to authenticated;
