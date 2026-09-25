-- ------------------------------------------------------------
-- Migración 108: el creador/organizador de un torneo, una Clan War
-- Amistosa o un Race War puede eliminarlo en cualquier momento, sin
-- importar cuántos participantes tenga -- la confirmación
-- ("¿Seguro? Esta acción es irreversible...") vive del lado del
-- cliente, acá no se agrega ninguna condición de "debe estar vacío".
-- ------------------------------------------------------------

-- 1) Torneos: admin_eliminar_torneo() ya eliminaba CUALQUIER torneo
-- (tenga o no participantes) sin esa protección -- el único problema
-- era que estaba limitada a is_admin(). Se amplía para que el propio
-- organizador (creador_id) también pueda usarla; el nombre de la
-- función se mantiene (ya está referenciada así en comentarios de
-- migraciones anteriores y en AdminPage.tsx) aunque deje de ser
-- exclusiva de admin.
create or replace function public.admin_eliminar_torneo(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador_id uuid;
begin
  select creador_id into v_creador_id from public.tournaments where id = p_tournament_id;

  if v_creador_id is null then
    raise exception 'Ese torneo no existe.';
  end if;

  if not (
    v_creador_id = auth.uid()
    or public.is_admin()
    or public.es_dueno_plataforma()
  ) then
    raise exception 'Solo el organizador o un administrador pueden eliminar este torneo.';
  end if;

  delete from public.tournaments where id = p_tournament_id;
end;
$$;

grant execute on function public.admin_eliminar_torneo(uuid) to authenticated;

-- 2) Clan War Amistosa: hasta ahora no existía ninguna forma de
-- eliminar un reto directo entre dos clanes (proponer_clan_war(), sin
-- torneo detrás) -- ni siquiera con participantes en cero. Solo el
-- equipo que la propuso (challenger_team_id) puede eliminarla; una
-- Clan War que sí viene de un torneo (torneo_de_clan_war() no nulo) se
-- excluye a propósito -- esa se borra eliminando el torneo, no acá.
--
-- clan_war_matches y clan_war_reportes son las dos únicas tablas que
-- referencian clan_wars SIN "on delete cascade" (el resto --
-- clan_war_lineup, clan_war_wtl_sets, clan_war_reschedules,
-- clan_war_lineup_extensiones -- ya cascadean solas); hay que
-- borrarlas a mano antes o el DELETE final falla con una violación de
-- llave foránea si la guerra ya tiene partidas jugadas o reportes.
create or replace function public.eliminar_clan_war_amistosa(p_clan_war_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cw record;
begin
  select * into v_cw from public.clan_wars where id = p_clan_war_id for update;

  if v_cw is null then
    raise exception 'Esa Clan War no existe.';
  end if;

  if (select id from public.torneo_de_clan_war(p_clan_war_id)) is not null then
    raise exception 'Esta Clan War pertenece a un torneo -- elimina el torneo para quitarla.';
  end if;

  if not (
    exists (
      select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
      where t.id = v_cw.challenger_team_id
        and tm.user_id = auth.uid()
        and (t.owner_id = auth.uid() or tm.es_capitan)
    )
    or public.is_admin()
    or public.es_staff()
    or public.es_dueno_plataforma()
  ) then
    raise exception 'Solo el equipo que propuso esta Clan War puede eliminarla.';
  end if;

  delete from public.clan_war_matches where clan_war_id = p_clan_war_id;
  delete from public.clan_war_reportes where clan_war_id = p_clan_war_id;
  delete from public.clan_wars where id = p_clan_war_id;
end;
$$;

grant execute on function public.eliminar_clan_war_amistosa(uuid) to authenticated;

-- 3) Race War: guerra_razas no tenía ninguna política de delete. Se
-- borra el torneo anfitrión oculto (no la fila de guerra_razas
-- directo) -- tournament_id tiene "on delete cascade" hacia
-- guerra_razas y esta hacia guerra_razas_jugadores, así que un solo
-- DELETE sobre tournaments limpia las dos.
create or replace function public.eliminar_race_war(p_guerra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guerra record;
begin
  select * into v_guerra from public.guerra_razas where id = p_guerra_id;

  if v_guerra is null then
    raise exception 'Ese Race War no existe.';
  end if;

  if not (
    v_guerra.creado_por = auth.uid()
    or public.is_admin()
    or public.es_dueno_plataforma()
  ) then
    raise exception 'Solo quien creó este Race War puede eliminarlo.';
  end if;

  delete from public.tournaments where id = v_guerra.tournament_id;
end;
$$;

grant execute on function public.eliminar_race_war(uuid) to authenticated;
