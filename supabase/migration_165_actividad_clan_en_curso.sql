-- Migración 165: "Actividad" de Mi Clan pasa a mostrar SOLO lo que
-- está en curso (Clan War Amistosa pendiente/aceptada/en_curso,
-- torneos en los que el equipo está inscrito sin terminar, Race War
-- organizadas sin terminar) -- a pedido del usuario, ya no el
-- historial completo (eso se mueve a la nueva sub-pestaña
-- "Finalizados", que reusa logros_clan_war_de() y las listas de
-- torneos/Race War ya existentes, sin filtrar por resultado).
create or replace function public.actividad_clan_en_curso(p_team_id uuid)
returns table (
  tipo text,
  id uuid,
  titulo text,
  fecha timestamptz,
  detalle text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'clan_war_amistosa'::text as tipo,
    cw.id,
    coalesce(cw.titulo, 'Clan War Amistosa') as titulo,
    cw.fecha_hora_cet as fecha,
    case cw.status
      when 'pendiente' then 'Pendiente de aceptar'
      when 'aceptada' then 'Aceptada'
      when 'en_curso' then 'En curso'
      else cw.status
    end as detalle
  from public.clan_wars cw
  where (cw.challenger_team_id = p_team_id or cw.challenged_team_id = p_team_id)
    and cw.status in ('pendiente', 'aceptada', 'en_curso')
    and not exists (select 1 from public.tournament_group_matches gm where gm.clan_war_id = cw.id)
    and not exists (select 1 from public.bracket_matches bm where bm.clan_war_id = cw.id)

  union all

  select
    'torneo'::text as tipo,
    t.id,
    t.nombre as titulo,
    t.fecha_inicio as fecha,
    case t.estado
      when 'abierto' then 'Inscripciones abiertas'
      when 'en_curso' then 'En curso'
      else t.estado
    end as detalle
  from public.tournaments t
  join public.tournament_participants tp on tp.tournament_id = t.id and tp.team_id = p_team_id
  where t.estado in ('abierto', 'en_curso')

  union all

  select
    'race_war'::text as tipo,
    gr.id,
    coalesce(t.nombre, 'Race War') as titulo,
    gr.creado_en as fecha,
    case t.estado
      when 'abierto' then 'Inscripciones abiertas'
      when 'en_curso' then 'En curso'
      else t.estado
    end as detalle
  from public.guerra_razas gr
  join public.tournaments t on t.id = gr.tournament_id
  where gr.equipo_creador_id = p_team_id
    and t.estado in ('abierto', 'en_curso')

  order by fecha desc;
$$;

grant execute on function public.actividad_clan_en_curso(uuid) to anon, authenticated;
