import { supabase } from "./supabaseClient";

// tournament_results.participant_id apunta a tournament_participants, que
// a su vez apunta a auth.users (no a profiles), así que resolver un nombre
// legible toma dos consultas encadenadas. Se usa tanto en el historial
// (resultados y ranking) como en cualquier otra vista que necesite mostrar
// nombres a partir de ids de participante.
export async function obtenerNombresDeParticipantes(
  participantIds: string[]
): Promise<Record<string, string>> {
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
  if (userIds.length > 0) {
    const { data: perfilesData } = await supabase
      .from("profiles")
      .select("id, nombre")
      .in("id", userIds);

    nombrePorUserId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nombre]));
  }

  const resultado: Record<string, string> = {};
  for (const participantId of participantIds) {
    const userId = userIdPorParticipante[participantId];
    resultado[participantId] = (userId && nombrePorUserId[userId]) || "Jugador de RemorApp";
  }
  return resultado;
}
