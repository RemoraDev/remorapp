import { supabase } from "./supabaseClient";

export interface InfoParticipante {
  nombre: string;
  suspendido: boolean;
  avatarUrl: string | null;
}

// tournament_results.participant_id apunta a tournament_participants, que
// a su vez apunta a auth.users (no a profiles), así que resolver un nombre
// legible toma dos consultas encadenadas. Se usa tanto en el historial
// (resultados y ranking) como en cualquier otra vista que necesite mostrar
// nombres a partir de ids de participante. Devuelve también si la cuenta
// está suspendida, para que quien llama pueda filtrarla de listados
// públicos (una cuenta suspendida no debe aparecer ahí).
export async function obtenerNombresDeParticipantes(
  participantIds: string[]
): Promise<Record<string, InfoParticipante>> {
  if (participantIds.length === 0) return {};

  const { data: participantesData } = await supabase
    .from("tournament_participants")
    .select("id, user_id")
    .in("id", participantIds);

  const userIdPorParticipante = Object.fromEntries(
    (participantesData ?? []).map((p) => [p.id, p.user_id])
  );
  const userIds = Object.values(userIdPorParticipante);

  let nombrePorUserId: Record<string, string | null> = {};
  let suspendidoPorUserId: Record<string, boolean> = {};
  let avatarPorUserId: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const { data: perfilesData } = await supabase
      .from("profiles")
      .select("id, nombre, suspendido, avatar_url")
      .in("id", userIds);

    nombrePorUserId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nombre]));
    suspendidoPorUserId = Object.fromEntries(
      (perfilesData ?? []).map((p) => [p.id, p.suspendido])
    );
    avatarPorUserId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.avatar_url]));
  }

  const resultado: Record<string, InfoParticipante> = {};
  for (const participantId of participantIds) {
    const userId = userIdPorParticipante[participantId];
    resultado[participantId] = {
      nombre: (userId && nombrePorUserId[userId]) || "Jugador de RemorApp",
      suspendido: (userId && suspendidoPorUserId[userId]) || false,
      avatarUrl: (userId && avatarPorUserId[userId]) || null,
    };
  }
  return resultado;
}

export interface ParticipanteResuelto {
  nombre: string;
  logoUrl: string | null;
}

// A diferencia de obtenerNombresDeParticipantes (que asume que todos
// los participant_id son de jugador individual), esta resuelve UN
// participante que puede ser jugador O equipo (ver migración 009,
// torneos 2v2/3v3/4v4) -- se usa para mostrar el campeón de un torneo
// en el historial sin necesitar la lista completa de participantes.
export async function obtenerNombreDeParticipante(
  participantId: string
): Promise<ParticipanteResuelto | null> {
  const { data: participante } = await supabase
    .from("tournament_participants")
    .select("user_id, team_id")
    .eq("id", participantId)
    .maybeSingle();

  if (!participante) return null;

  if (participante.team_id) {
    const { data: equipo } = await supabase
      .from("teams")
      .select("name, logo_url")
      .eq("id", participante.team_id)
      .maybeSingle();
    return { nombre: equipo?.name ?? "Equipo de RemorApp", logoUrl: equipo?.logo_url ?? null };
  }

  if (participante.user_id) {
    const { data: perfil } = await supabase
      .from("profiles")
      .select("nombre, avatar_url")
      .eq("id", participante.user_id)
      .maybeSingle();
    return { nombre: perfil?.nombre ?? "Jugador de RemorApp", logoUrl: perfil?.avatar_url ?? null };
  }

  return null;
}
