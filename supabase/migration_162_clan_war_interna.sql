-- Migración 162: Clan War Amistosa interna -- a pedido del usuario, un
-- clan tiene que poder retarse A SÍ MISMO (se divide el roster en dos
-- lados para practicar), algo que hasta ahora el check de la tabla y
-- la función bloqueaban a propósito ("Un equipo no puede retarse a sí
-- mismo"). También suma un título opcional (antes siempre se armaba
-- solo, "{tag} vs {tag}") -- a pedido del usuario, toda Clan War
-- Amistosa queda registrada en los clanes, así que vale la pena poder
-- nombrarla.

-- 1) El check de la tabla es SIN NOMBRE (declarado como "check (...)"
-- suelto, no "constraint x check (...)"), así que Postgres le puso un
-- nombre autogenerado (clan_wars_check / clan_wars_check1 / etc. según
-- el orden de declaración) que no conviene adivinar a mano -- se busca
-- por su definición real en pg_constraint y se dropea por ese nombre.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.clan_wars'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) = 'CHECK ((challenger_team_id <> challenged_team_id))';

  if v_constraint_name is not null then
    execute format('alter table public.clan_wars drop constraint %I', v_constraint_name);
  end if;
end $$;

-- 2) proponer_clan_war(): mismo cuerpo de la migración más reciente
-- (la que agregó mapas_por_set/jugadores_por_set), menos el bloqueo de
-- "no puede retarse a sí mismo" y sumando p_titulo (opcional, con el
-- mismo default de siempre si se deja en blanco). No hace falta "drop
-- function" -- el parámetro nuevo va al final con default, mismo tipo
-- de retorno (void).
create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple',
  p_temporada_id uuid default null,
  p_jugadores_por_set integer default 3,
  p_mapas_por_set integer default 2,
  p_titulo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger record;
  v_challenged record;
  v_ultimo_reto timestamptz;
  v_titulo text;
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
  end if;
  if p_jugadores_por_set is null or p_jugadores_por_set < 1 then
    raise exception 'La cantidad de jugadores por lado tiene que ser al menos 1.';
  end if;
  if p_mapas_por_set is null or p_mapas_por_set < 1 then
    raise exception 'El "Bo" de cada set tiene que ser al menos 1.';
  end if;

  select t.* into v_challenger
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.user_id = auth.uid()
    and (t.owner_id = auth.uid() or tm.es_capitan);

  if v_challenger is null then
    raise exception 'No eres dueño ni capitán de ningún equipo.';
  end if;

  if v_challenger.disuelto then
    raise exception 'Tu equipo está disuelto.';
  end if;
  if v_challenger.banca_rota then
    raise exception 'Tu equipo está en banca rota y no puede retar por puntos.';
  end if;

  select * into v_challenged from public.teams where id = p_challenged_team_id;
  if v_challenged is null then
    raise exception 'Ese equipo no existe.';
  end if;
  -- Antes acá se rechazaba challenged.id = challenger.id ("no puede
  -- retarse a sí mismo") -- a pedido del usuario, ahora se permite a
  -- propósito: es la Clan War Amistosa INTERNA, para practicar
  -- dividiendo el roster del propio clan en dos lados.
  if v_challenged.disuelto then
    raise exception 'Ese equipo está disuelto.';
  end if;
  if v_challenged.banca_rota then
    raise exception 'Ese equipo está en banca rota y no puede ser retado por puntos.';
  end if;

  if p_fecha_hora_cet <= now() then
    raise exception 'La fecha y hora del reto debe ser en el futuro.';
  end if;

  select max(created_at) into v_ultimo_reto
  from public.clan_wars
  where (challenger_team_id = v_challenger.id and challenged_team_id = p_challenged_team_id)
     or (challenger_team_id = p_challenged_team_id and challenged_team_id = v_challenger.id);

  if v_ultimo_reto is not null and now() - v_ultimo_reto < interval '7 days' then
    raise exception 'Ya hubo un reto entre estos dos equipos hace menos de 7 días. Puedes proponer otro a partir del %.',
      to_char(v_ultimo_reto + interval '7 days', 'DD/MM/YYYY HH24:MI');
  end if;

  v_titulo := nullif(trim(p_titulo), '');

  insert into public.clan_wars (
    challenger_team_id, challenged_team_id, fecha_hora_cet, formato, temporada_id,
    jugadores_por_set, mapas_por_set, titulo
  )
  values (
    v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato, p_temporada_id,
    p_jugadores_por_set, p_mapas_por_set,
    coalesce(v_titulo, v_challenger.tag || ' vs ' || v_challenged.tag)
  );
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text, uuid, integer, integer, text) to authenticated;
