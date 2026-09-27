-- ------------------------------------------------------------
-- Migración 115: dos bugs reales en el buscador de clanes para
-- proponer una Clan War Amistosa (CreateTournamentPage.tsx), ambos
-- confirmados en vivo contra la base real:
--
-- 1) El buscador anterior era un filtro .ilike() directo del cliente
-- -- sin normalizar acentos/caracteres especiales, así que un clan con
-- un nombre estilizado como "ØLD SCHOOL REBØRN" (Ø en vez de O) nunca
-- aparece si alguien busca con la letra normal ("old school"), que es
-- la forma más natural de escribirla en un teclado común. Se
-- reemplaza por esta función, que compara con unaccent() de los dos
-- lados (mismo criterio que el filtro de lenguaje inapropiado).
--
-- 2) Una vez elegido un clan, el campo de búsqueda muestra
-- "Nombre [TAG]" (formateado) en vez del texto tipeado -- si el
-- navegador ofrece esa cadena como autocompletado (la recuerda de una
-- selección anterior) y el usuario la vuelve a elegir, se dispara una
-- nueva búsqueda con ese texto formateado completo, que nunca va a
-- coincidir con ningún nombre o tag real (ninguno de los dos incluye
-- corchetes) -- se ve como "No encontré ningún clan público con ese
-- nombre o tag" para un clan que sí existe. Se corrige en el frontend
-- con autoComplete="off" en ese campo (ver CreateTournamentPage.tsx).
-- ------------------------------------------------------------

create or replace function public.buscar_equipos_publicos_cw(p_query text, p_excluir_team_id uuid default null)
returns table (
  id uuid,
  name text,
  tag text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.tag
  from public.teams t
  where t.is_public
    and not t.disuelto
    and not t.banca_rota
    and (p_excluir_team_id is null or t.id <> p_excluir_team_id)
    and (
      unaccent(lower(t.name)) ilike '%' || unaccent(lower(p_query)) || '%'
      or unaccent(lower(t.tag)) ilike '%' || unaccent(lower(p_query)) || '%'
    )
  order by t.name
  limit 10;
$$;

grant execute on function public.buscar_equipos_publicos_cw(text, uuid) to authenticated;
