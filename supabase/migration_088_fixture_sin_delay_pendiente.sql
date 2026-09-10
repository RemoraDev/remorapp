-- ------------------------------------------------------------
-- Migración 088: las Clan Wars que genera un fixture en bloque
-- (generar_todos_contra_todos(), migración 083/087 -- First Stand y
-- Todos contra todos) no deberían depender de que el dueño del equipo
-- "challenger" complete a mano "¿Tiene delay?" antes de poder
-- arrancar. Ese paso (completar_datos_transmision(), migración 022)
-- se pensó para un reto propuesto manualmente por un capitán, donde
-- tiene sentido pedirle esos datos antes de arrancar -- no para un
-- partido que salió solo de un fixture, donde nadie "propuso" nada.
--
-- Con 21 Clan Wars generadas de una, exigirle este paso a una persona
-- específica por cada una (y solo ella, ni siquiera un capitán del
-- mismo equipo) podía trabar jornadas enteras sin que nadie entendiera
-- por qué el check-in no avanzaba.
--
-- 1) generar_todos_contra_todos() ahora inserta tiene_delay = false
--    directo en cada Clan War que genera -- intentar_iniciar_clan_war()
--    ya no queda esperando ese dato: la guerra arranca sola en cuanto
--    los dos capitanes confirman el check-in, igual que cualquier otro
--    paso del flujo. Los retos propuestos a mano (proponer_clan_war())
--    siguen sin tocarse, tiene_delay nace en null como siempre -- ese
--    caso si tiene un capitán identificable a quien pedirle el dato
--    antes de arrancar.
-- 2) completar_datos_transmision() se sigue pudiendo usar para
--    corregir el dato después -- antes solo mientras el reto estaba
--    'aceptada' (bloqueaba apenas arrancaba la guerra); ahora también
--    mientras está 'en_curso', para que el organizador pueda avisar
--    que sí hay delay en una transmisión concreta aunque la Clan War
--    ya haya empezado.
-- ------------------------------------------------------------

create or replace function public.generar_todos_contra_todos(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torneo record;
  v_participantes uuid[];
  v_n int;
  v_grupo_id uuid;
  v_arr uuid[];
  v_rondas int;
  v_r int;
  v_i int;
  v_j int;
  v_p1 uuid;
  v_p2 uuid;
  v_ultimo uuid;
  v_usa_clan_war boolean;
  v_es_first_stand boolean;
  v_temporada_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_clan_war_id uuid;
  v_avanzan int;
begin
  select * into v_torneo from public.tournaments where id = p_tournament_id for update;

  if v_torneo is null then
    raise exception 'El torneo no existe.';
  end if;
  if v_torneo.creador_id <> auth.uid() then
    raise exception 'Solo el organizador puede iniciar el torneo.';
  end if;

  v_es_first_stand := v_torneo.modo = 'eliminacion_simple' and v_torneo.formato_liga = 'first_stand';

  if v_torneo.modo <> 'todos_contra_todos' and not v_es_first_stand then
    raise exception 'Este torneo no es de formato Todos contra todos ni First Stand.';
  end if;
  if v_torneo.estado <> 'abierto' then
    raise exception 'Este torneo ya no está abierto para iniciar.';
  end if;

  select array_agg(id order by random())
  into v_participantes
  from public.tournament_participants
  where tournament_id = p_tournament_id and checked_in = true;

  v_n := coalesce(array_length(v_participantes, 1), 0);
  if v_n < 3 then
    raise exception 'Necesitas al menos 3 equipos/jugadores confirmados para este formato.';
  end if;

  if v_es_first_stand then
    v_avanzan := coalesce(v_torneo.avanzan_por_grupo, 4);
    if v_avanzan < 2 or v_avanzan > v_n then
      raise exception 'La cantidad de equipos que avanzan a playoffs no puede superar la cantidad de confirmados.';
    end if;
  end if;

  v_usa_clan_war := v_torneo.formato in ('2v2', '3v3', '4v4')
    and (v_torneo.liga_id is not null or v_es_first_stand);

  if v_usa_clan_war then
    select id into v_temporada_id from public.temporadas
      where torneo_id = p_tournament_id
      order by fecha_inicio desc
      limit 1;
  end if;

  insert into public.tournament_groups (tournament_id, nombre)
  values (
    p_tournament_id,
    case when v_es_first_stand then 'Fase de todos contra todos' else 'Todos contra todos' end
  )
  returning id into v_grupo_id;

  for v_i in 1..v_n loop
    insert into public.tournament_group_participants (group_id, participant_id)
    values (v_grupo_id, v_participantes[v_i]);
  end loop;

  v_arr := v_participantes;
  if v_n % 2 <> 0 then
    v_arr := array_append(v_arr, null);
    v_n := v_n + 1;
  end if;

  v_rondas := v_n - 1;

  for v_r in 1..v_rondas loop
    for v_i in 1..(v_n / 2) loop
      v_p1 := v_arr[v_i];
      v_p2 := v_arr[v_n + 1 - v_i];

      if v_p1 is not null and v_p2 is not null then
        v_clan_war_id := null;

        if v_usa_clan_war then
          select team_id into v_team1_id from public.tournament_participants where id = v_p1;
          select team_id into v_team2_id from public.tournament_participants where id = v_p2;

          -- tiene_delay = false (migración 088): esta Clan War la creó
          -- un fixture, no la propuso un capitán -- no tiene sentido
          -- dejarla esperando que alguien puntual complete un dato
          -- opcional de transmisión antes de poder arrancar. Sigue
          -- editable después con completar_datos_transmision().
          insert into public.clan_wars (
            challenger_team_id, challenged_team_id, fecha_hora_cet,
            status, formato, temporada_id, tiene_delay
          ) values (
            v_team1_id, v_team2_id, v_torneo.fecha_inicio + ((v_r - 1) * interval '7 days'),
            'aceptada', v_torneo.formato_clan_war, v_temporada_id, false
          )
          returning id into v_clan_war_id;
        end if;

        insert into public.tournament_group_matches (group_id, participant1_id, participant2_id, jornada, clan_war_id)
        values (v_grupo_id, v_p1, v_p2, v_r, v_clan_war_id);
      end if;
    end loop;

    v_ultimo := v_arr[v_n];
    for v_j in reverse v_n..3 loop
      v_arr[v_j] := v_arr[v_j - 1];
    end loop;
    v_arr[2] := v_ultimo;
  end loop;

  if v_es_first_stand then
    update public.tournaments
      set estado = 'en_curso', check_in_abierto = false, fase_actual = 'grupos',
          tiene_fase_grupos = true, cantidad_grupos = 1, avanzan_por_grupo = v_avanzan
      where id = p_tournament_id;
  else
    update public.tournaments
      set estado = 'en_curso', check_in_abierto = false
      where id = p_tournament_id;
  end if;
end;
$$;

grant execute on function public.generar_todos_contra_todos(uuid) to authenticated;

-- completar_datos_transmision(): ahora también se puede llamar con la
-- Clan War ya 'en_curso' -- antes solo se dejaba mientras estaba
-- 'aceptada', lo que la bloqueaba apenas arrancaba (algo que, con las
-- Clan Wars de un fixture ya arrancando solas, iba a pasar casi
-- siempre). Se sigue rechazando en cualquier otro estado (finalizada,
-- empatada, cancelada): no tiene sentido corregir datos de
-- transmisión de una guerra que ya terminó.
create or replace function public.completar_datos_transmision(
  p_clan_war_id uuid,
  p_caster_nombre text,
  p_caster_link text,
  p_tiene_delay boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reto record;
begin
  select * into v_reto from public.clan_wars where id = p_clan_war_id for update;
  if v_reto is null then
    raise exception 'Ese reto no existe.';
  end if;

  if not exists (select 1 from public.teams where id = v_reto.challenger_team_id and owner_id = auth.uid()) then
    raise exception 'Solo el organizador (quien propuso el reto) puede completar los datos de transmisión.';
  end if;

  if v_reto.status not in ('aceptada', 'en_curso') then
    raise exception 'Este reto todavía no fue aceptado, o la guerra ya terminó.';
  end if;

  if p_tiene_delay is null then
    raise exception 'Tienes que definir si la transmisión tiene delay o no.';
  end if;

  update public.clan_wars
    set caster_nombre = nullif(trim(p_caster_nombre), ''),
        caster_link = nullif(trim(p_caster_link), ''),
        tiene_delay = p_tiene_delay
    where id = p_clan_war_id;

  perform public.intentar_iniciar_clan_war(p_clan_war_id);
end;
$$;

grant execute on function public.completar_datos_transmision(uuid, text, text, boolean) to authenticated;
