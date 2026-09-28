-- Migración 131: los fondos clásicos de la sala de lineup pasan a
-- tener movimiento (drift/giro/pulso vía CSS, ver halcon.css) --
-- "campo_estrellas" se renombra a "estrellas" (mismo patrón, ahora con
-- drift), "vortice" se queda igual (ahora gira de verdad), y
-- "nebulosa"/"constelacion" salen del catálogo, reemplazados por
-- "nova", "planeta", "lluvia" y "meteoros". Antes de tocar el check,
-- se remapean los valores existentes para que ninguna Clan War en
-- curso quede con un valor que ya no es válido.

update public.clan_wars set fondo_lineup = 'estrellas' where fondo_lineup = 'campo_estrellas';
update public.clan_wars set fondo_lineup = 'nova' where fondo_lineup = 'nebulosa';
update public.clan_wars set fondo_lineup = 'planeta' where fondo_lineup = 'constelacion';

-- Red de seguridad: cualquier fila que por lo que sea (datos huérfanos
-- de pruebas viejas, algún valor que ya no reconocemos) no haya quedado
-- en el catálogo nuevo, cae a "ninguno" en vez de trabar el ALTER TABLE
-- de más abajo.
update public.clan_wars
  set fondo_lineup = 'ninguno'
  where fondo_lineup not in ('ninguno', 'estrellas', 'vortice', 'nova', 'planeta', 'lluvia', 'meteoros');

alter table public.clan_wars drop constraint if exists clan_wars_fondo_lineup_check;

alter table public.clan_wars
  add constraint clan_wars_fondo_lineup_check
    check (fondo_lineup in ('ninguno', 'estrellas', 'vortice', 'nova', 'planeta', 'lluvia', 'meteoros'));

create or replace function public.cambiar_fondo_lineup_cw(p_clan_war_id uuid, p_fondo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  if p_fondo not in ('ninguno', 'estrellas', 'vortice', 'nova', 'planeta', 'lluvia', 'meteoros') then
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
