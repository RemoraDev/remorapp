-- ------------------------------------------------------------
-- Migración 074: dos correcciones encontradas en vivo.
--
-- 1) tournaments.fecha_inicio no tenía ninguna validación -- se pudo
--    crear un torneo con fecha en 1969. Se agrega como un trigger
--    BEFORE INSERT (no un check constraint): un check constraint con
--    now() se volvería a evaluar en cada UPDATE de la fila, y
--    prácticamente todo lo que pasa después de crear un torneo
--    (abrir check-in, generar la llave, reportar resultados, cerrar
--    el torneo) hace un UPDATE sobre una fila cuya fecha_inicio ya
--    quedó en el pasado -- con un check constraint, esas operaciones
--    normales empezarían a fallar solas apenas pasara la fecha de
--    inicio. Un trigger BEFORE INSERT valida una sola vez, al crear,
--    y nunca vuelve a mirarlo.
--
-- 2) "Liga (para el ranking de clanes)" no tenía forma de agregar una
--    liga nueva -- la tabla ligas no tenía ninguna política de
--    insert. crear_liga() la agrega, disponible para cualquier cuenta
--    autenticada (igual que pedido), no solo administradores.
-- ------------------------------------------------------------

create or replace function public.validar_fecha_inicio_torneo()
returns trigger
language plpgsql
as $$
begin
  -- Tolerancia de 5 minutos: cubre el tiempo que tarda en llenarse y
  -- mandarse el formulario, y un posible desfase de reloj del
  -- navegador -- no es para permitir fechas pasadas de verdad.
  if new.fecha_inicio < now() - interval '5 minutes' then
    raise exception 'La fecha de inicio no puede ser en el pasado.';
  end if;
  return new;
end;
$$;

create trigger before_insert_tournaments_valida_fecha
  before insert on public.tournaments
  for each row execute function public.validar_fecha_inicio_torneo();

create or replace function public.crear_liga(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_id uuid;
begin
  v_nombre := trim(p_nombre);

  if char_length(v_nombre) < 2 or char_length(v_nombre) > 40 then
    raise exception 'El nombre de la liga debe tener entre 2 y 40 caracteres.';
  end if;

  if exists (select 1 from public.ligas where lower(nombre) = lower(v_nombre)) then
    raise exception 'Ya existe una liga con ese nombre.';
  end if;

  insert into public.ligas (nombre) values (v_nombre) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.crear_liga(text) to authenticated;
