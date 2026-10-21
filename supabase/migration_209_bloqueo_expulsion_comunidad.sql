-- Migración 209, corrección QA/UX: "Quitar" un integrante de una
-- comunidad era cosmético -- unirse es un insert libre sin memoria de
-- a quién se expulsó, así que el expulsado podía volver a unirse al
-- toque tocando "Unirse" de nuevo. Mismo problema que team_kicks_log
-- ya resuelve para Equipos, pero sin su complejidad de aprobación:
-- unirse sigue siendo libre para cualquiera, solo se bloquea volver a
-- entrar a la MISMA comunidad que ya expulsó a esa persona, hasta que
-- el creador lo permita de nuevo.
create table public.comunidad_kicks_log (
  id uuid primary key default gen_random_uuid(),
  comunidad_id uuid not null references public.comunidades (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kicked_by uuid not null references public.profiles (id),
  kicked_at timestamptz not null default now(),
  unique (comunidad_id, user_id)
);

alter table public.comunidad_kicks_log enable row level security;

create policy "comunidad_kicks_log_select_creador"
  on public.comunidad_kicks_log for select
  to authenticated
  using (
    exists (
      select 1 from public.comunidades c
      where c.id = comunidad_kicks_log.comunidad_id and c.creador_id = auth.uid()
    )
  );

grant select on public.comunidad_kicks_log to authenticated;

-- Defensa en profundidad: aunque el frontend pase a usar
-- unirse_comunidad() de abajo, esto bloquea igual un insert directo a
-- comunidad_miembros hecho a mano para alguien con una expulsión
-- vigente en esa comunidad.
drop policy "comunidad_miembros_unirse_propio" on public.comunidad_miembros;

create policy "comunidad_miembros_unirse_propio"
  on public.comunidad_miembros for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.comunidad_kicks_log k
      where k.comunidad_id = comunidad_miembros.comunidad_id and k.user_id = auth.uid()
    )
  );

create or replace function public.unirse_comunidad(p_comunidad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.esta_suspendido() then
    raise exception 'Tu cuenta está suspendida.';
  end if;

  if exists (
    select 1 from public.comunidad_kicks_log
    where comunidad_id = p_comunidad_id and user_id = auth.uid()
  ) then
    raise exception 'El creador de esta comunidad te quitó -- no puedes volver a unirte salvo que te lo permita de nuevo.';
  end if;

  insert into public.comunidad_miembros (comunidad_id, user_id)
  values (p_comunidad_id, auth.uid())
  on conflict do nothing;
end;
$$;

grant execute on function public.unirse_comunidad(uuid) to authenticated;

-- quitar_integrante_comunidad(): reemplaza el delete directo que
-- hacía el frontend -- ahora deja registro en comunidad_kicks_log
-- antes de borrar la fila de membresía, para que el insert de
-- unirse_comunidad() (y la política de arriba) lo bloqueen después.
create or replace function public.quitar_integrante_comunidad(p_comunidad_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
begin
  select creador_id into v_creador_id from public.comunidades where id = p_comunidad_id;
  if v_creador_id is null then
    raise exception 'Comunidad no encontrada.';
  end if;
  if v_creador_id <> auth.uid() then
    raise exception 'Solo el creador puede quitar integrantes.';
  end if;
  if p_user_id = v_creador_id then
    raise exception 'El creador no puede quitarse a sí mismo.';
  end if;

  insert into public.comunidad_kicks_log (comunidad_id, user_id, kicked_by)
  values (p_comunidad_id, p_user_id, auth.uid())
  on conflict (comunidad_id, user_id) do update set kicked_by = excluded.kicked_by, kicked_at = now();

  delete from public.comunidad_miembros
  where comunidad_id = p_comunidad_id and user_id = p_user_id;
end;
$$;

grant execute on function public.quitar_integrante_comunidad(uuid, uuid) to authenticated;

-- permitir_reingreso_comunidad(): el creador revierte una expulsión
-- vieja -- sin esto "Quitar" sería definitivo para siempre, lo cual
-- tampoco es lo que se busca (a veces se expulsa por un conflicto
-- puntual, no para siempre).
create or replace function public.permitir_reingreso_comunidad(p_comunidad_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
begin
  select creador_id into v_creador_id from public.comunidades where id = p_comunidad_id;
  if v_creador_id <> auth.uid() then
    raise exception 'Solo el creador puede permitir el reingreso.';
  end if;

  delete from public.comunidad_kicks_log
  where comunidad_id = p_comunidad_id and user_id = p_user_id;
end;
$$;

grant execute on function public.permitir_reingreso_comunidad(uuid, uuid) to authenticated;

-- agregar_integrante_comunidad(): corrige un bug preexistente -- "Agregar
-- integrante" desde el Panel de control hacía un insert directo con el
-- user_id de OTRA persona, pero la única política de insert de
-- comunidad_miembros exige user_id = auth.uid(), así que ese botón
-- siempre fallaba con un error de RLS. Si la persona tenía una
-- expulsión vigente, agregarla a mano es una decisión explícita del
-- creador: se limpia el registro de comunidad_kicks_log de paso.
create or replace function public.agregar_integrante_comunidad(p_comunidad_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
begin
  select creador_id into v_creador_id from public.comunidades where id = p_comunidad_id;
  if v_creador_id is null then
    raise exception 'Comunidad no encontrada.';
  end if;
  if v_creador_id <> auth.uid() then
    raise exception 'Solo el creador puede agregar integrantes.';
  end if;

  delete from public.comunidad_kicks_log
  where comunidad_id = p_comunidad_id and user_id = p_user_id;

  insert into public.comunidad_miembros (comunidad_id, user_id)
  values (p_comunidad_id, p_user_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.agregar_integrante_comunidad(uuid, uuid) to authenticated;
