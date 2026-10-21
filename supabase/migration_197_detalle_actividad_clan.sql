create or replace function public.detalle_actividad_clan(p_team_id uuid)
returns table (
  tipo text,
  descripcion text,
  fecha timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'clan_war'::text as tipo,
    'Clan War vs ' || (
      case when cw.challenger_team_id = p_team_id then ct2.name else ct1.name end
    ) as descripcion,
    cw.fecha_hora_cet as fecha
  from public.clan_wars cw
  join public.teams ct1 on ct1.id = cw.challenger_team_id
  join public.teams ct2 on ct2.id = cw.challenged_team_id
  where (cw.challenger_team_id = p_team_id or cw.challenged_team_id = p_team_id)
    and cw.status in ('finalizada', 'empatada', 'en_curso')

  union all

  select
    'torneo'::text,
    'Torneo: ' || t.nombre,
    t.fecha_inicio
  from public.tournament_participants tp
  join public.tournaments t on t.id = tp.tournament_id
  where tp.team_id = p_team_id

  union all

  select
    'race_war'::text,
    'Race War: ' || coalesce(gr.titulo, 'Race War'),
    gr.creado_en
  from public.guerra_razas gr
  where gr.equipo_creador_id = p_team_id

  order by fecha desc;
$$;

grant execute on function public.detalle_actividad_clan(uuid) to anon, authenticated;
