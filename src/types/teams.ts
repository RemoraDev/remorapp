import type { Sc2Region } from "./profile";

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  sc2_regions: Sc2Region[];
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  // Sistema de experiencia (migración 013, Fase A): xp se acumula
  // cuando cualquier miembro juega, nivel se recalcula solo en la
  // base (columna GENERATED) con una curva bastante más empinada que
  // la de un jugador individual.
  xp: number;
  nivel: number;
  is_public: boolean;
  invite_code: string;
  owner_id: string;
  created_at: string;
}

export type TeamMemberRole = "owner" | "jugador";

export interface TeamMemberRow {
  user_id: string;
  team_id: string;
  roles: TeamMemberRole[];
  joined_at: string;
}

export type InvitationStatus = "pendiente" | "aceptada" | "rechazada";

export interface TeamInvitationRow {
  id: string;
  team_id: string;
  invited_user_id: string;
  invited_by: string;
  status: InvitationStatus;
  created_at: string;
}

export interface TeamKickLogRow {
  id: string;
  team_id: string;
  user_id: string;
  kicked_by: string;
  kicked_at: string;
}

export type XpLogOrigen = "partida_ganada" | "partida_perdida" | "apuesta";

export interface TeamXpLogRow {
  id: string;
  team_id: string;
  // null cuando origen = 'apuesta' -- ahí el XP es del equipo, no de
  // una persona jugando.
  user_id: string | null;
  cantidad: number;
  origen: XpLogOrigen;
  created_at: string;
}

export type WagerStatus = "pendiente" | "aceptada" | "rechazada" | "resuelta" | "en_disputa";

export interface TeamXpWagerRow {
  id: string;
  challenger_team_id: string;
  challenged_team_id: string;
  monto: number;
  status: WagerStatus;
  reporte_challenger: string | null;
  reporte_challenged: string | null;
  ganador_final: string | null;
  created_at: string;
  resolved_at: string | null;
}
