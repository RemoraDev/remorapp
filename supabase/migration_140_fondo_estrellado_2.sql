-- Migración 140: nuevo fondo de lineup "estrellado_2" -- sobre un
-- modelo de referencia que pasó el usuario (estrellas subiendo derecho
-- hacia arriba, en capas de distinto tamaño/velocidad), distinto del
-- drift diagonal de "estrellado". Mismo patrón de siempre: se suma al
-- check constraint de la columna y al de cambiar_fondo_lineup_cw()
-- juntos.

alter table public.clan_wars drop constraint if exists clan_wars_fondo_lineup_check;

alter table public.clan_wars
  add constraint clan_wars_fondo_lineup_check
    check (fondo_lineup in ('ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego'));

create or replace function public.cambiar_fondo_lineup_cw(p_clan_war_id uuid, p_fondo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_fondo not in ('ninguno', 'estrellas', 'estrellado', 'estrellado_2', 'nova', 'planeta', 'viaje', 'fuego') then
    raise exception 'Ese fondo no es válido.';
  end if;

  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not public.es_capitan_o_dueno(v_reto.challenger_team_id) and not public.es_capitan_o_dueno(v_reto.challenged_team_id) then
    raise exception 'Solo el dueño o un capitán de alguno de los dos equipos puede cambiar el fondo.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'El fondo de la sala de lineup solo se puede cambiar mientras la Clan War está aceptada o en curso.';
  end if;

  update public.clan_wars set fondo_lineup = p_fondo, fondo_lineup_imagen_id = null where id = p_clan_war_id;
end;
$$;

grant execute on function public.cambiar_fondo_lineup_cw(uuid, text) to authenticated;
