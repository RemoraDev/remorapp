-- ------------------------------------------------------------
-- Migración 072: el filtro de lenguaje inapropiado de Delfin Mode
-- (migración 071) era solo del lado del cliente -- alguien podía
-- insertar un mensaje directo contra la API de Supabase, sin pasar
-- por la pantalla del chat, y saltárselo por completo. Esta migración
-- replica el mismo criterio (misma lista de palabras y misma
-- normalización -- minúsculas, sin tildes, sustitución de "leet
-- speak" como "put4"/"sh1t", solo letras y números) directo en la
-- base, como un check constraint sobre mensajes_equipo.contenido.
--
-- No se tocan profiles.nick, teams.name/tag/description ni
-- tournaments.nombre -- ese filtro sigue siendo solo del cliente ahí,
-- igual que hasta ahora. Esta migración es específica del pedido de
-- reforzar mensajes_equipo.
-- ------------------------------------------------------------

-- unaccent() es lo que reemplaza, en SQL, al paso de
-- texto.normalize("NFD").replace(/\p{Diacritic}/gu, "") del lado
-- TypeScript (src/lib/profanityFilter.ts) -- saca tildes/diacríticos
-- antes de comparar.
create extension if not exists unaccent;

create or replace function public.contiene_lenguaje_inapropiado(p_texto text)
returns boolean
language sql
immutable
as $$
  -- Misma lista que PALABRAS_BLOQUEADAS en profanityFilter.ts -- si se
  -- amplía una, hay que ampliar la otra a mano, no hay una fuente
  -- única compartida entre TypeScript y SQL.
  select exists (
    select 1
    from unnest(array[
      'puta', 'puto', 'mierda', 'pendejo', 'pendeja', 'conchatumadre', 'hueon', 'weon',
      'maricon', 'marica', 'verga', 'culiao', 'culiado', 'chucha', 'cabron', 'cabrona',
      'perra', 'zorra', 'polla',
      'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'nigger', 'nigga', 'faggot',
      'whore', 'slut', 'dick', 'cock', 'pussy'
    ]) as palabra
    where position(
      palabra in regexp_replace(
        -- Mismos reemplazos "leet" que REEMPLAZOS_LEET en
        -- profanityFilter.ts: 4->a, 3->e, 1->i, 0->o, 5->s, $->s, @->a.
        translate(unaccent(lower(p_texto)), '43105$@', 'aeiossa'),
        '[^a-z0-9]', '', 'g'
      )
    ) > 0
  );
$$;

alter table public.mensajes_equipo
  add constraint mensajes_equipo_contenido_sin_lenguaje_inapropiado
  check (not public.contiene_lenguaje_inapropiado(contenido));
