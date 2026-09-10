import { supabase } from "./supabaseClient";
import type { TeamMemberRow } from "../types/teams";

export interface EquipoDelUsuario extends TeamMemberRow {
  teamTag: string | null;
}

// Se usa en /equipos/crear y /equipos para bloquear crear o unirse a
// un segundo equipo -- el chequeo real e imposible de saltarse está en
// la base (team_members.user_id es la primary key), esto es solo para
// mostrar el aviso al toque sin tener que esperar el error del INSERT.
// También se usa en el abanico ("Mi equipo") para saber a qué tag
// mandar directo.
export async function obtenerEquipoDelUsuario(userId: string): Promise<EquipoDelUsuario | null> {
  const { data } = await supabase
    .from("team_members")
    .select("user_id, team_id, roles, joined_at, teams(tag)")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  // team_members.team_id -> teams.id: PostgREST embebe el join, pero
  // sin tipos generados puede venir como objeto o como array de 1.
  const equipo = Array.isArray(data.teams) ? data.teams[0] : data.teams;

  return {
    user_id: data.user_id,
    team_id: data.team_id,
    roles: data.roles,
    joined_at: data.joined_at,
    teamTag: (equipo as { tag?: string } | undefined)?.tag ?? null,
  };
}
