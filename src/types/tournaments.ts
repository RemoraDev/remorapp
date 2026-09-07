// Tipos que reflejan el esquema de supabase/schema_tournaments.sql.
// Separados de src/types.ts porque ese archivo son los tipos del mock
// de la portada (torneos de ejemplo), no datos reales de Supabase.

export type TorneoFormato = "1v1" | "2v2" | "3v3" | "4v4";

export type TorneoModo =
  | "eliminacion_simple"
  | "eliminacion_doble"
  | "todos_contra_todos"
  | "rey_de_la_colina"
  // Migración 069.
  | "suizo"
  | "tabla_posiciones";

export type TorneoEstado = "abierto" | "en_curso" | "finalizado";

// Migración 040: layout de cajas/líneas de la llave y fondo
// "galáctico" detrás -- independientes entre sí, se combinan.
export type EstiloBracket = "clasico" | "esports" | "starcraft_oficial";
export type FondoBracket = "ninguno" | "campo_estrellas" | "nebulosa" | "constelacion" | "vortice";

export const ESTILO_BRACKET_OPTIONS: { value: EstiloBracket; label: string }[] = [
  { value: "clasico", label: "Clásico" },
  { value: "esports", label: "Esports" },
  { value: "starcraft_oficial", label: "StarCraft Oficial" },
];

export const FONDO_BRACKET_OPTIONS: { value: FondoBracket; label: string }[] = [
  { value: "ninguno", label: "Ninguno" },
  { value: "campo_estrellas", label: "Campo de estrellas" },
  { value: "nebulosa", label: "Nebulosa" },
  { value: "constelacion", label: "Constelación" },
  { value: "vortice", label: "Vórtice" },
];

export interface MapRow {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface TournamentRow {
  id: string;
  nombre: string;
  juego: string;
  formato: TorneoFormato;
  modo: TorneoModo;
  publico: boolean;
  pozo_premio: number | null;
  cupos_totales: number;
  cupos_ocupados: number;
  fecha_inicio: string;
  estado: TorneoEstado;
  creador_id: string;
  confirmado_por_staff: boolean;
  creado_en: string;
  // Se llena sola cuando se juega la final de la llave (ver
  // avanzar_ganador() en supabase/migration_006_bracket.sql).
  campeon_participant_id: string | null;
  // Migración 046: partido por el tercer lugar entre los perdedores
  // de semifinal, en paralelo a la final. Mismo patrón de llenado que
  // campeon_participant_id, se completa solo cuando se juega.
  tiene_tercer_lugar: boolean;
  tercer_lugar_participant_id: string | null;
  // Check-in antes de generar la llave (migración 010): mientras está
  // en true, los inscritos pueden confirmar que van a jugar.
  check_in_abierto: boolean;
  estilo_bracket: EstiloBracket;
  fondo_bracket: FondoBracket;
  // Migración 041: etapa de grupos previa a la llave eliminatoria.
  tiene_fase_grupos: boolean;
  cantidad_grupos: number | null;
  avanzan_por_grupo: number | null;
  fase_actual: "grupos" | "eliminacion";
  // Migración 057: formato de liga "First Stand" -- 7 clanes, fixture
  // round-robin completo (todos contra todos) y playoffs top 4.
  formato_liga: "first_stand" | null;
  puntos_victoria_2_0: number;
  puntos_victoria_2_1: number;
  // Migración 060: liga y división para el ranking de clanes --
  // independiente de formato_liga (que es el formato de competencia,
  // no la liga). division_id, si está elegida, siempre pertenece a
  // liga_id (validado en la base por un trigger).
  liga_id: string | null;
  division_id: string | null;
  // Migración 069: Suizo -- si el organizador no la fija a mano al
  // crear el torneo, generar_torneo_suizo() la calcula sola.
  swiss_rondas_totales: number | null;
  // Migración 069: opciones avanzadas del formulario de creación.
  mostrar_nombres_ronda_personalizados: boolean;
  ocultar_numeros_semilla: boolean;
  ocultar_bracket_publico: boolean;
  reglas_semillas: "aleatorio" | "tradicional";
  permite_autoreporte: boolean;
  excluido_de_busqueda: boolean;
  mostrar_posiciones: boolean;
}

// Migración 041: etapa de grupos.
export interface TournamentGroupRow {
  id: string;
  tournament_id: string;
  nombre: string;
  created_at: string;
}

export interface TournamentGroupMatchRow {
  id: string;
  group_id: string;
  participant1_id: string;
  participant2_id: string;
  ganador_id: string | null;
  status: "pendiente" | "jugado";
  // Migración 057: jornada del fixture de First Stand (1 a 7). Queda
  // en null para la etapa de grupos "clásica" (varios grupos), que no
  // organiza sus partidos por jornada.
  jornada: number | null;
  // Migración 057: resultado detallado (0, 1 o 2 mapas ganados) para
  // distinguir un 2-0 de un 2-1 -- necesario para el sistema de
  // puntos de First Stand. Queda en null para partidos reportados sin
  // este detalle.
  resultado_participant1: number | null;
  resultado_participant2: number | null;
}

// Resultado de la función posiciones_grupos() -- una fila por
// participante, ya ordenada (puntos desc, diferencia de mapas como
// desempate, orden de inscripción como último desempate).
export interface PosicionGrupo {
  group_id: string;
  group_nombre: string;
  participant_id: string;
  ganados: number;
  jugados: number;
  // Migración 057: puntos según puntos_victoria_2_0/puntos_victoria_2_1
  // del torneo, y diferencia de mapas ganados/perdidos como desempate.
  puntos: number;
  dif_mapas: number;
  inscrito_en: string;
}

export interface TournamentMapRow {
  id: string;
  tournament_id: string;
  map_id: string;
  es_veteable: boolean;
  vetado: boolean;
}

// user_id y team_id son mutuamente excluyentes (ver migración 009):
// en un torneo 1v1 se inscribe un jugador (user_id), en uno 2v2/3v3/4v4
// se inscribe un equipo completo (team_id) -- nunca los dos juntos.
export interface TournamentParticipantRow {
  id: string;
  tournament_id: string;
  user_id: string | null;
  team_id: string | null;
  inscrito_en: string;
  checked_in: boolean;
  checked_in_at: string | null;
  // Migración 069: solo tiene sentido en un torneo modo "tabla_posiciones"
  // -- el organizador lo carga directo, sin partidos de por medio.
  puntos_leaderboard: number;
}

export interface TournamentResultRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  gano: boolean;
  puntaje: number | null;
  creado_en: string;
}
