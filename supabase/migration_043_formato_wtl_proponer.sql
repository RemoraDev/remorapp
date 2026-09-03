-- ============================================================
-- Migración 043: corrección a la migración 042 -- proponer_clan_war()
-- no tenía forma de elegir el formato 'wtl' al crear el reto.
--
-- La migración 042 agregó clan_wars.formato, pero nunca dio ninguna
-- vía para escribirlo: no hay política de UPDATE para authenticated en
-- clan_wars (a propósito, todo pasa por funciones), y
-- proponer_clan_war() -- la única forma de insertar una fila nueva --
-- no recibía ningún parámetro de formato. En la práctica, ningún reto
-- podía nacer en 'wtl'. Se encontró al intentar probar el formato de
-- punta a punta, según lo prometido.
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ============================================================

-- Mismo motivo que en la migración 042 con armar_lineup_cw(): agregar
-- un parámetro nuevo cambia la firma para Postgres, así que hay que
-- borrar la versión vieja antes de crear la nueva.
drop function if exists public.proponer_clan_war(uuid, timestamptz);

create or replace function public.proponer_clan_war(
  p_challenged_team_id uuid,
  p_fecha_hora_cet timestamptz,
  p_formato text default 'simple'
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
begin
  if p_formato not in ('simple', 'wtl') then
    raise exception 'Ese formato no es válido.';
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
  if v_challenged.id = v_challenger.id then
    raise exception 'Un equipo no puede retarse a sí mismo.';
  end if;
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

  insert into public.clan_wars (challenger_team_id, challenged_team_id, fecha_hora_cet, formato)
  values (v_challenger.id, p_challenged_team_id, p_fecha_hora_cet, p_formato);
end;
$$;

grant execute on function public.proponer_clan_war(uuid, timestamptz, text) to authenticated;
