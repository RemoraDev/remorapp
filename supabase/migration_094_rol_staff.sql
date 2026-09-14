-- ------------------------------------------------------------
-- Migración 094: rol "Staff" -- gente que trabaja con el dueño de la
-- plataforma, con permisos acotados y explícitamente SIN poder sobre
-- las decisiones del dueño ni su visibilidad exclusiva.
--
-- 1) profiles.es_staff (nueva columna): protegida por el mismo
--    mecanismo que es_admin/es_dueno_plataforma -- proteger_es_admin()
--    revierte cualquier intento de cambiarla desde la app (solo se
--    activa a mano, en el SQL Editor). Además, a propósito, NO se le
--    otorga ningún grant de UPDATE a "authenticated": ni siquiera
--    llega a evaluarse el trigger, Postgres rechaza el intento de
--    entrada por falta de privilegio de columna. Sí se le otorga
--    SELECT, para que la propia cuenta pueda ver su condición de
--    staff y mostrarse el Panel Staff.
-- 2) es_staff(): función auxiliar, mismo patrón exacto que is_admin()
--    y es_dueno_plataforma().
-- 3) Permisos de Staff -- SOLO estos tres:
--    a) crear_liga() ya está abierta a cualquier cuenta autenticada
--       (decisión deliberada de una migración anterior, confirmada
--       con el usuario) -- Staff no necesita ningún cambio acá, ya
--       puede crear ligas como cualquiera.
--    b) reportes_staff: se suma es_staff() a las políticas de SELECT
--       y UPDATE (antes exclusivas de is_admin()) -- Staff ya puede
--       ver y resolver los reportes.
--    c) bugs_reportados (tabla nueva): Staff puede reportar (insert)
--       y ver la lista (select); solo un admin o el dueño de la
--       plataforma puede cambiar el status (update) -- resolver un
--       bug es una decisión de quién lo soluciona, no de quien lo
--       reporta.
-- 4) Restricciones explícitas -- NO se toca ningún mecanismo que ya
--    excluye a Staff por diseño, para dejar constancia expresa de que
--    esto fue verificado, no pasado por alto:
--    - dueno_actividad_log: sigue siendo de solo inserción, exclusiva
--      de es_dueno_plataforma() vía registrar_actividad_dueno() -- no
--      existe (ni se agrega acá) ninguna función de update/delete
--      sobre esta tabla, para nadie.
--    - armar_lineup_cw()/confirmar_lineup_cw() (parámetro
--      p_team_id_como_admin, intervención en nombre de un capitán):
--      sigue exigiendo es_dueno_plataforma() exclusivamente -- no se
--      le agrega una rama para es_staff().
--    - clan_war_lineup_select_propio (ver lineup de ambos equipos
--      antes de revelarse mutuamente): sigue exigiendo
--      es_dueno_plataforma() exclusivamente, ni siquiera is_admin()
--      alcanza hoy -- no se le agrega es_staff().
--    - eliminar_equipo_definitivo() (dueño del equipo o is_admin()),
--      admin_eliminar_torneo() y admin_eliminar_noticia() (solo
--      is_admin()): no se les agrega es_staff().
--    - admin_suspender_usuario() y admin_dar_de_baja_cuenta()
--      (correos_bloqueados): no se les agrega es_staff().
-- ------------------------------------------------------------

alter table public.profiles
  add column es_staff boolean not null default false;

grant select (es_staff) on public.profiles to authenticated;

-- proteger_es_admin(): mismo cuerpo de siempre, con es_staff sumado a
-- la lista de columnas que se revierten cuando el update llega por la
-- API (nunca directo en el SQL Editor).
create or replace function public.proteger_es_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nick is distinct from old.nick and old.nick is not null then
    insert into public.nick_history (user_id, nick_anterior, cambiado_en)
    values (old.id, old.nick, now());
  end if;

  if current_setting('request.jwt.claims', true) is not null then
    new.es_admin := old.es_admin;
    new.es_dueno_plataforma := old.es_dueno_plataforma;
    new.es_staff := old.es_staff;

    if old.es_dueno_plataforma then
      new.suspendido := old.suspendido;
    elsif new.suspendido is distinct from old.suspendido and not public.is_admin() then
      new.suspendido := old.suspendido;
    end if;
  end if;
  return new;
end;
$$;

-- Función auxiliar reutilizada por políticas RPC -- mismo patrón
-- exacto que is_admin() y es_dueno_plataforma().
create or replace function public.es_staff()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select es_staff from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.es_staff() to authenticated;

-- ------------------------------------------------------------
-- reportes_staff: se suma es_staff() a SELECT y UPDATE (antes
-- exclusivas de is_admin()) -- Staff ya puede ver y resolver los
-- reportes, sin tocar el resto de las políticas ni el INSERT (que ya
-- era libre para cualquier cuenta autenticada, reportando su propio
-- reporte).
-- ------------------------------------------------------------

drop policy if exists "reportes_staff_select_admin" on public.reportes_staff;
create policy "reportes_staff_select_admin"
  on public.reportes_staff for select
  to authenticated
  using (public.is_admin() or public.es_dueno_plataforma() or public.es_staff());

drop policy if exists "reportes_staff_update_admin" on public.reportes_staff;
create policy "reportes_staff_update_admin"
  on public.reportes_staff for update
  to authenticated
  using (public.is_admin() or public.es_dueno_plataforma() or public.es_staff())
  with check (public.is_admin() or public.es_dueno_plataforma() or public.es_staff());

-- ------------------------------------------------------------
-- bugs_reportados: lugar dedicado para que Staff reporte errores de
-- la plataforma -- Staff puede reportar (insert) y ver la lista
-- (select); solo un admin o el dueño de la plataforma puede cambiar
-- el status (update). Mismo patrón de RLS que reportes_staff.
-- ------------------------------------------------------------

create table public.bugs_reportados (
  id uuid primary key default gen_random_uuid(),
  reportado_por uuid not null references public.profiles (id),
  titulo text not null check (char_length(titulo) between 1 and 150),
  descripcion text not null check (char_length(descripcion) between 1 and 2000),
  status text not null default 'abierto' check (status in ('abierto', 'en_revision', 'resuelto')),
  created_at timestamptz not null default now()
);

alter table public.bugs_reportados enable row level security;

create policy "bugs_reportados_select_staff_admin"
  on public.bugs_reportados for select
  to authenticated
  using (public.is_admin() or public.es_dueno_plataforma() or public.es_staff());

create policy "bugs_reportados_insert_staff"
  on public.bugs_reportados for insert
  to authenticated
  with check (
    reportado_por = auth.uid()
    and (public.is_admin() or public.es_dueno_plataforma() or public.es_staff())
  );

create policy "bugs_reportados_update_admin"
  on public.bugs_reportados for update
  to authenticated
  using (public.is_admin() or public.es_dueno_plataforma())
  with check (public.is_admin() or public.es_dueno_plataforma());

grant select, insert, update on public.bugs_reportados to authenticated;
