// Coincide con supabase/migration_006_bracket.sql. Por ahora solo
// existe para torneos 1v1 en modo eliminación simple.
export type MatchStatus = "pendiente" | "jugado" | "en_disputa";

export interface BracketMatchRow {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  participant1_id: string | null;
  participant2_id: string | null;
  winner_id: string | null;
  reported_p1_winner: string | null;
  reported_p2_winner: string | null;
  status: MatchStatus;
}
