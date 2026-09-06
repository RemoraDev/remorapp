-- ------------------------------------------------------------
-- Migración 064: clan_wars_proximas() se extiende con la liga y
-- división del torneo asociado (si lo hay) -- para el nuevo diseño en
-- tarjetas de "Clan Wars próximas" en Inicio, que muestra esa
-- categoría cuando existe. La cadena es clan_wars.temporada_id ->
-- temporadas.torneo_id -> tournaments.liga_id/division_id -- la
-- inmensa mayoría de las Clan Wars no tiene temporada asignada
-- (temporada_id null), así que en esos casos liga/división quedan en
-- null sin más (no es un error, es el caso normal).
-- ------------------------------------------------------------
drop function if exists public.clan_wars_proximas();

create or replace function public.clan_wars_proximas()
returns table (
  id uuid,
  fecha_hora_cet timestamptz,
  formato text,
  challenger_nombre text,
  challenger_tag text,
  challenger_logo_url text,
  challenged_nombre text,
  challenged_tag text,
  challenged_logo_url text,
  liga_nombre text,
  division_nombre text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cw.id,
    cw.fecha_hora_cet,
    cw.formato,
    tc.name as challenger_nombre,
    tc.tag as challenger_tag,
    tc.logo_url as challenger_logo_url,
    td.name as challenged_nombre,
    td.tag as challenged_tag,
    td.logo_url as challenged_logo_url,
    l.nombre as liga_nombre,
    d.nombre as division_nombre
  from public.clan_wars cw
  join public.teams tc on tc.id = cw.challenger_team_id
  join public.teams td on td.id = cw.challenged_team_id
  left join public.temporadas tmp on tmp.id = cw.temporada_id
  left join public.tournaments t on t.id = tmp.torneo_id
  left join public.ligas l on l.id = t.liga_id
  left join public.divisiones_liga d on d.id = t.division_id
  where cw.status = 'en_curso' or (cw.status = 'aceptada' and cw.fecha_hora_cet >= now())
  order by cw.fecha_hora_cet asc;
$$;

grant execute on function public.clan_wars_proximas() to anon, authenticated;
