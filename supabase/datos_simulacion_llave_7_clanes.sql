-- Datos de prueba, a pedido del usuario: 7 clanes ficticios + un
-- torneo 3v3 (8 cupos, abierto) con los 7 ya inscritos, para
-- simular vos mismo cómo se va completando/viendo la llave.
-- Dueño "de papel" de los 7 clanes y creador del torneo: KefKa#97964
-- (Gran Kefka), id 0c40d570-1e22-47b6-a471-994b845de97a (confirmado).
--
-- Dos triggers de por medio, ambos se desactivan solo para este
-- insert puntual y se reactivan enseguida después:
-- 1) before_insert_tournaments_valida_creador valida con auth.uid(),
--    que no existe corriendo SQL directo acá (sin sesión logueada).
-- 2) after_insert_teams_owner crea una fila en team_members por cada
--    equipo nuevo con user_id = owner_id -- como team_members.user_id
--    es su propia primary key (un usuario real = un solo equipo), la
--    segunda fila para el mismo KefKa choca con la primera. Se
--    desactiva para que los 7 equipos ficticios queden SIN miembros
--    (no hace falta tener "roster" real para aparecer en Equipos
--    inscritos ni en la vista previa de llaves).
alter table public.tournaments disable trigger before_insert_tournaments_valida_creador;
alter table public.teams disable trigger after_insert_teams_owner;

with nuevos_equipos as (
  insert into public.teams (name, tag, sc2_regions, owner_id, is_public)
  values
    ('Simulación Alfa', 'SIMA', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Beta', 'SIMB', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Gamma', 'SIMC', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Delta', 'SIMD', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Epsilon', 'SIME', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Zeta', 'SIMF', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true),
    ('Simulación Eta', 'SIMG', array['america'], '0c40d570-1e22-47b6-a471-994b845de97a', true)
  returning id
),
nuevo_torneo as (
  insert into public.tournaments (
    nombre, formato, modo, publico, pozo_premio, cupos_totales, fecha_inicio, creador_id,
    tiene_fase_grupos, cantidad_grupos, avanzan_por_grupo, tiene_tercer_lugar,
    gran_final_con_reset, formato_liga, puntos_victoria_2_1, formato_clan_war,
    ventana_revelacion_minutos, jugadores_por_set, mapas_por_set, liga_id, division_id,
    swiss_rondas_totales
  )
  values (
    'Simulación de llave -- 7 clanes', '3v3', 'eliminacion_simple', true, null, 8,
    now() + interval '2 days', '0c40d570-1e22-47b6-a471-994b845de97a',
    false, null, null, false, true, null, 3, 'simple', 30, 3, 2, null, null, null
  )
  returning id
)
insert into public.tournament_participants (tournament_id, team_id)
select nuevo_torneo.id, nuevos_equipos.id
from nuevo_torneo, nuevos_equipos;

alter table public.tournaments enable trigger before_insert_tournaments_valida_creador;
alter table public.teams enable trigger after_insert_teams_owner;

-- Para encontrar el link directo después de correr esto:
-- select id from public.tournaments where nombre = 'Simulación de llave -- 7 clanes';
