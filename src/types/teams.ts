import type { Sc2Region } from "./profile";

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  sc2_regions: Sc2Region[];
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  // Sistema de MMR y ligas oficiales de StarCraft II (migración 020,
  // reemplaza al de experiencia/nivel de la migración 013). mmr es el
  // rating del clan como unidad (nace en 1441, Bronce 1); banca_rota y
  // liga se recalculan solos en la base a partir de mmr (columnas
  // GENERATED) -- nunca se mandan a mano.
  mmr: number;
  banca_rota: boolean;
  liga: string;
  is_public: boolean;
  invite_code: string;
  owner_id: string;
  created_at: string;
  // Migración 019: el dueño era el único miembro y salió del equipo
  // -- la fila queda, pero deja de aparecer en el buscador público.
  disuelto: boolean;
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

export type TeamKickMotivo = "expulsado" | "renuncia";

export interface TeamKickLogRow {
  id: string;
  team_id: string;
  user_id: string;
  kicked_by: string;
  kicked_at: string;
  motivo: TeamKickMotivo;
}
