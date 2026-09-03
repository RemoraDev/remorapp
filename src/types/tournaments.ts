// Tipos que reflejan el esquema de supabase/schema_tournaments.sql.
// Separados de src/types.ts porque ese archivo son los tipos del mock
// de la portada (torneos de ejemplo), no datos reales de Supabase.

export type TorneoFormato = "1v1" | "2v2" | "3v3" | "4v4";

export type TorneoModo =
  | "eliminacion_simple"
  | "eliminacion_doble"
  | "todos_contra_todos"
  | "rey_de_la_colina";

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
}

// Resultado de la función posiciones_grupos() -- una fila por
// participante, ya ordenada (ganados desc, orden de inscripción como
// desempate).
export interface PosicionGrupo {
  group_id: string;
  group_nombre: string;
  participant_id: string;
  ganados: number;
  jugados: number;
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
}

export interface TournamentResultRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  gano: boolean;
  puntaje: number | null;
  creado_en: string;
}
