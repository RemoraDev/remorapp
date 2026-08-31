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
}

export interface TournamentMapRow {
  id: string;
  tournament_id: string;
  map_id: string;
  es_veteable: boolean;
  vetado: boolean;
}

export interface TournamentParticipantRow {
  id: string;
  tournament_id: string;
  user_id: string;
  inscrito_en: string;
}

export interface TournamentResultRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  gano: boolean;
  puntaje: number | null;
  creado_en: string;
}
