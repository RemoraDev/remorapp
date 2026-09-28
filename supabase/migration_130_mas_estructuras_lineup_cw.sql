-- Migración 130: dos maquetas nuevas para "Look -> Estructura", además
-- de Clásico y Cascada (migración 127) -- inspiradas en estilos
-- habituales de transmisiones de esports: "Enfrentamientos" (un duelo
-- 1 vs 1 por tarjeta chica, lado a lado, en vez de filas de tabla --
-- común en broadcasts de juegos 1v1) y "Póster" (split vertical al
-- estilo cartel de versus/character-select, con un "VS" grande al
-- centro y cada equipo ocupando su mitad). Solo agrega valores nuevos
-- al catálogo -- el resto de la maqueta (fondo, dimensión, etc.) es
-- compartido, igual que entre Clásico y Cascada.

alter table public.clan_wars
  drop constraint if exists clan_wars_estructura_lineup_check;

alter table public.clan_wars
  add constraint clan_wars_estructura_lineup_check
    check (estructura_lineup in ('clasico', 'cascada', 'enfrentamientos', 'poster'));

create or replace function public.cambiar_estructura_lineup_cw(p_clan_war_id uuid, p_estructura text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_estructura not in ('clasico', 'cascada', 'enfrentamientos', 'poster') then
    raise exception 'Esa estructura no es válida.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar la estructura.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'La estructura del lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set estructura_lineup = p_estructura where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_estructura_lineup_cw(uuid, text) to authenticated;
