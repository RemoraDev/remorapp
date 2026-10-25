-- ============================================================
-- Migración 215: "¿Quién es tu papi?" -- Etapa 2. Flujo de
-- registrar/verificar/corregir/eliminar partidas, alta de jugadores y
-- apertura de temporada, todo desde el Panel de moderador. Completa
-- lo que la migración 214 dejó pendiente a propósito.
--
-- Decisión nueva: una partida "corregida" sigue contando para el MMR
-- (no es lo mismo que "rechazada" -- se corrigió un dato, no se anuló
-- el resultado). Por eso osr_recalcular_temporada(), las dos funciones
-- de paternidad y la política pública de osr_partidas pasan de
-- "estado = 'verificada'" a "estado in ('verificada', 'corregida')".
-- Ninguna cambia su lista de columnas de salida, así que
-- "create or replace function" alcanza sin DROP FUNCTION.
--
-- Correr una sola vez en el SQL Editor de Supabase, DESPUÉS de la 214.
-- ============================================================

-- ------------------------------------------------------------
-- Ajuste: "corregida" cuenta igual que "verificada" para el público,
-- el MMR y las paternidades.
-- ------------------------------------------------------------

drop policy if exists "osr_partidas_select_publico_o_moderador" on public.osr_partidas;
create policy "osr_partidas_select_publico_o_moderador"
  on public.osr_partidas for select
  to anon, authenticated
  using (estado in ('verificada', 'corregida') or public.es_moderador_osr());

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
    where temporada_id = p_temporada_id and estado in ('verificada', 'corregida')
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
    where estado in ('verificada', 'corregida')
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
    where estado in ('verificada', 'corregida') and temporada_id = p_temporada_id
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

-- ------------------------------------------------------------
-- osr_abrir_temporada(): cierra la temporada activa (si hay) y abre
-- una nueva -- el historial de partidas/paternidades NUNCA se borra.
-- ------------------------------------------------------------

create or replace function public.osr_abrir_temporada(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede abrir una temporada.';
  end if;

  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'La temporada necesita un nombre.';
  end if;

  update public.osr_temporadas set activa = false, cerrada_en = now() where activa;

  insert into public.osr_temporadas (nombre, activa) values (trim(p_nombre), true)
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.osr_abrir_temporada(text) to authenticated;

-- ------------------------------------------------------------
-- osr_inscribir_jugador(): alta (o corrección de datos previo a jugar)
-- de un jugador en una temporada puntual.
-- ------------------------------------------------------------

create or replace function public.osr_inscribir_jugador(
  p_temporada_id uuid,
  p_user_id uuid,
  p_raza text,
  p_categoria text,
  p_mmr_oficial integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede inscribir jugadores.';
  end if;

  if not exists (select 1 from public.osr_temporadas where id = p_temporada_id and activa) then
    raise exception 'Esa temporada no existe o no está activa.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  insert into public.osr_jugadores (temporada_id, user_id, raza_principal, categoria, mmr_oficial_inicial)
    values (p_temporada_id, p_user_id, p_raza, p_categoria, p_mmr_oficial)
  on conflict (temporada_id, user_id) do update
    set raza_principal = excluded.raza_principal,
        categoria = excluded.categoria,
        mmr_oficial_inicial = excluded.mmr_oficial_inicial,
        activo = true
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.osr_inscribir_jugador(uuid, uuid, text, text, integer) to authenticated;

-- ------------------------------------------------------------
-- osr_registrar_partida(): crea una partida en estado "pendiente" --
-- no afecta MMR ni rankings hasta que se verifique.
-- ------------------------------------------------------------

create or replace function public.osr_registrar_partida(
  p_temporada_id uuid,
  p_ganador_user_id uuid,
  p_perdedor_user_id uuid,
  p_fecha timestamptz,
  p_fuente_verificacion text default null,
  p_evidencia_url text default null,
  p_observaciones text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ganador record;
  v_perdedor record;
  v_id uuid;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede registrar partidas.';
  end if;

  if p_ganador_user_id = p_perdedor_user_id then
    raise exception 'Un jugador no puede jugar contra sí mismo.';
  end if;

  select id, categoria into v_ganador from public.osr_jugadores
    where temporada_id = p_temporada_id and user_id = p_ganador_user_id and activo;
  if v_ganador is null then
    raise exception 'El ganador no está inscripto (o no está activo) en esta temporada.';
  end if;

  select id, categoria into v_perdedor from public.osr_jugadores
    where temporada_id = p_temporada_id and user_id = p_perdedor_user_id and activo;
  if v_perdedor is null then
    raise exception 'El perdedor no está inscripto (o no está activo) en esta temporada.';
  end if;

  if exists (
    select 1 from public.osr_partidas
    where temporada_id = p_temporada_id
      and ganador_user_id = p_ganador_user_id
      and perdedor_user_id = p_perdedor_user_id
      and fecha = p_fecha
      and estado <> 'rechazada'
  ) then
    raise exception 'Ya existe una partida registrada con estos mismos jugadores y fecha -- revisá que no sea un duplicado.';
  end if;

  insert into public.osr_partidas (
    temporada_id, jugador_ganador_id, jugador_perdedor_id, ganador_user_id, perdedor_user_id,
    fecha, categoria_ganador, categoria_perdedor, fuente_verificacion, evidencia_url, observaciones,
    moderador_id, estado
  ) values (
    p_temporada_id, v_ganador.id, v_perdedor.id, p_ganador_user_id, p_perdedor_user_id,
    p_fecha, v_ganador.categoria, v_perdedor.categoria, p_fuente_verificacion, p_evidencia_url, p_observaciones,
    auth.uid(), 'pendiente'
  ) returning id into v_id;

  insert into public.osr_partidas_auditoria (partida_id, accion, datos_nuevos, moderador_id)
    values (v_id, 'creada', to_jsonb((select p from public.osr_partidas p where id = v_id)), auth.uid());

  return v_id;
end;
$$;

grant execute on function public.osr_registrar_partida(uuid, uuid, uuid, timestamptz, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- osr_verificar_partida(): aprueba o rechaza una partida pendiente.
-- Solo al aprobarla se recalcula el MMR de la temporada.
-- ------------------------------------------------------------

create or replace function public.osr_verificar_partida(p_partida_id uuid, p_aprobar boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida public.osr_partidas;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede verificar partidas.';
  end if;

  select * into v_partida from public.osr_partidas where id = p_partida_id for update;
  if v_partida is null then
    raise exception 'Esa partida no existe.';
  end if;
  if v_partida.estado <> 'pendiente' then
    raise exception 'Esta partida ya fue revisada -- usá "corregir" si hace falta cambiarla.';
  end if;

  update public.osr_partidas
    set estado = case when p_aprobar then 'verificada' else 'rechazada' end,
        moderador_id = auth.uid(),
        observaciones = coalesce(p_motivo, observaciones),
        actualizado_en = now()
    where id = p_partida_id;

  insert into public.osr_partidas_auditoria (partida_id, accion, datos_anteriores, datos_nuevos, moderador_id, motivo)
    values (
      p_partida_id,
      case when p_aprobar then 'verificada' else 'rechazada' end,
      to_jsonb(v_partida),
      to_jsonb((select p from public.osr_partidas p where id = p_partida_id)),
      auth.uid(),
      p_motivo
    );

  if p_aprobar then
    perform public.osr_recalcular_temporada(v_partida.temporada_id);
  end if;
end;
$$;

grant execute on function public.osr_verificar_partida(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- osr_corregir_partida(): cambia ganador/perdedor/fecha de una
-- partida ya existente -- recalcula TODO el MMR de la temporada
-- (osr_recalcular_temporada), nunca reversa un delta a mano.
-- ------------------------------------------------------------

create or replace function public.osr_corregir_partida(
  p_partida_id uuid,
  p_nuevo_ganador_user_id uuid,
  p_nuevo_perdedor_user_id uuid,
  p_nueva_fecha timestamptz,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida public.osr_partidas;
  v_ganador record;
  v_perdedor record;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede corregir partidas.';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'Corregir una partida requiere un motivo.';
  end if;

  if p_nuevo_ganador_user_id = p_nuevo_perdedor_user_id then
    raise exception 'Un jugador no puede jugar contra sí mismo.';
  end if;

  select * into v_partida from public.osr_partidas where id = p_partida_id for update;
  if v_partida is null then
    raise exception 'Esa partida no existe.';
  end if;

  -- Importante: solo se corrigen partidas YA verificadas (o ya
  -- corregidas antes). Si estuviera "pendiente", forzar estado =
  -- 'corregida' acá la haría contar para el MMR saltándose por
  -- completo el paso de verificación del moderador -- para una
  -- pendiente hay que rechazarla y cargarla de nuevo, o verificarla
  -- primero con los datos correctos.
  if v_partida.estado not in ('verificada', 'corregida') then
    raise exception 'Esta partida todavía no fue verificada -- rechazala y volvé a cargarla, o verificala primero con los datos correctos.';
  end if;

  select id, categoria into v_ganador from public.osr_jugadores
    where temporada_id = v_partida.temporada_id and user_id = p_nuevo_ganador_user_id and activo;
  if v_ganador is null then
    raise exception 'El ganador no está inscripto (o no está activo) en esta temporada.';
  end if;

  select id, categoria into v_perdedor from public.osr_jugadores
    where temporada_id = v_partida.temporada_id and user_id = p_nuevo_perdedor_user_id and activo;
  if v_perdedor is null then
    raise exception 'El perdedor no está inscripto (o no está activo) en esta temporada.';
  end if;

  update public.osr_partidas
    set jugador_ganador_id = v_ganador.id,
        jugador_perdedor_id = v_perdedor.id,
        ganador_user_id = p_nuevo_ganador_user_id,
        perdedor_user_id = p_nuevo_perdedor_user_id,
        categoria_ganador = v_ganador.categoria,
        categoria_perdedor = v_perdedor.categoria,
        fecha = p_nueva_fecha,
        estado = 'corregida',
        moderador_id = auth.uid(),
        actualizado_en = now()
    where id = p_partida_id;

  insert into public.osr_partidas_auditoria (partida_id, accion, datos_anteriores, datos_nuevos, moderador_id, motivo)
    values (
      p_partida_id, 'corregida', to_jsonb(v_partida),
      to_jsonb((select p from public.osr_partidas p where id = p_partida_id)),
      auth.uid(), p_motivo
    );

  perform public.osr_recalcular_temporada(v_partida.temporada_id);
end;
$$;

grant execute on function public.osr_corregir_partida(uuid, uuid, uuid, timestamptz, text) to authenticated;

-- ------------------------------------------------------------
-- osr_eliminar_partida(): borra una partida (duplicada, cargada por
-- error, etc.) -- recalcula TODO el MMR de la temporada.
-- ------------------------------------------------------------

create or replace function public.osr_eliminar_partida(p_partida_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida public.osr_partidas;
begin
  if not public.es_moderador_osr() then
    raise exception 'Solo un moderador puede eliminar partidas.';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'Eliminar una partida requiere un motivo.';
  end if;

  select * into v_partida from public.osr_partidas where id = p_partida_id for update;
  if v_partida is null then
    raise exception 'Esa partida no existe.';
  end if;

  insert into public.osr_partidas_auditoria (partida_id, accion, datos_anteriores, moderador_id, motivo)
    values (p_partida_id, 'eliminada', to_jsonb(v_partida), auth.uid(), p_motivo);

  delete from public.osr_partidas where id = p_partida_id;

  perform public.osr_recalcular_temporada(v_partida.temporada_id);
end;
$$;

grant execute on function public.osr_eliminar_partida(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- osr_agregar_moderador() / osr_quitar_moderador(): exclusivo del
-- dueño del equipo OSR (no de cualquier moderador) -- administrar
-- quién modera es una decisión de un escalón más arriba.
-- ------------------------------------------------------------

create or replace function public.osr_es_dueno_equipo_osr()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams
    where id = 'de0df7cf-ec44-43c3-9e24-cfde9f2161e2'
      and owner_id = auth.uid()
  );
$$;

grant execute on function public.osr_es_dueno_equipo_osr() to authenticated;

create or replace function public.osr_agregar_moderador(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.osr_es_dueno_equipo_osr() then
    raise exception 'Solo el dueño del equipo puede agregar moderadores.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Ese jugador no existe.';
  end if;

  insert into public.osr_moderadores (user_id, agregado_por)
    values (p_user_id, auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

grant execute on function public.osr_agregar_moderador(uuid) to authenticated;

create or replace function public.osr_quitar_moderador(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.osr_es_dueno_equipo_osr() then
    raise exception 'Solo el dueño del equipo puede quitar moderadores.';
  end if;

  delete from public.osr_moderadores where user_id = p_user_id;
end;
$$;

grant execute on function public.osr_quitar_moderador(uuid) to authenticated;
