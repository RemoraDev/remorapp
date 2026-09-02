import type { Sc2Region } from "./profile";

// Torneos Históricos (migración 029): competencias jugadas antes de
// que existiera RemorApp. Coincide con los check constraints de
// historical_tournaments en supabase/schema_tournaments.sql.
export type HistoricalTournamentEstado = "pendiente_consentimiento" | "confirmado" | "referencia_historica";

export interface HistoricalTournamentRow {
  id: string;
  nombre: string;
  fecha_aproximada: string;
  servidor: Sc2Region;
  primer_lugar_nombre: string;
  primer_lugar_team_id: string | null;
  segundo_lugar_nombre: string;
  segundo_lugar_team_id: string | null;
  creado_por: string;
  estado: HistoricalTournamentEstado;
  created_at: string;
}

export interface HistoricalTournamentParticipantRow {
  id: string;
  historical_tournament_id: string;
  nombre_clan: string;
  team_id: string | null;
  consentimiento: boolean | null;
  created_at: string;
}
