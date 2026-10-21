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
    // Corrección: acá se pedía profiles.nombre (el nombre real) en vez
    // de nick#unique_id -- la identidad pública que usa el resto de la
    // app en todos lados, y que además no expone el nombre real de la
    // cuenta.
    const { data: perfilesData } = await supabase
      .from("profiles")
      .select("id, nick, unique_id, suspendido, avatar_url")
      .in("id", userIds);

    nombrePorUserId = Object.fromEntries(
      (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : null])
    );
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
  const resueltos = await obtenerNombresDeParticipantesMixto([participantId]);
  return resueltos[participantId] ?? null;
}

// Performance: versión en lote de obtenerNombreDeParticipante -- antes
// TournamentHistoryPage.tsx (listado público) llamaba a la de arriba
// UNA VEZ POR TORNEO dentro de un for..of secuencial (2 consultas por
// torneo de llave, una tras otra), así que el historial hacía
// 2-4×cantidad_de_torneos viajes de ida y vuelta, en serie. Esta
// resuelve cualquier cantidad de participantes (jugador O equipo
// mezclados) en 3 consultas totales sin importar cuántos sean.
export async function obtenerNombresDeParticipantesMixto(
  participantIds: string[]
): Promise<Record<string, ParticipanteResuelto>> {
  if (participantIds.length === 0) return {};

  const idsUnicos = [...new Set(participantIds)];
  const { data: participantesData } = await supabase
    .from("tournament_participants")
    .select("id, user_id, team_id")
    .in("id", idsUnicos);

  const filas = participantesData ?? [];
  const userIds = [...new Set(filas.filter((p) => p.user_id).map((p) => p.user_id as string))];
  const teamIds = [...new Set(filas.filter((p) => p.team_id).map((p) => p.team_id as string))];

  const [{ data: perfilesData }, { data: equiposData }] = await Promise.all([
    userIds.length > 0
      ? supabase.from("profiles").select("id, nick, unique_id, avatar_url").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; nick: string | null; unique_id: string; avatar_url: string | null }[] }),
    teamIds.length > 0
      ? supabase.from("teams").select("id, name, logo_url").in("id", teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string; logo_url: string | null }[] }),
  ]);

  const perfilPorUserId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p]));
  const equipoPorTeamId = Object.fromEntries((equiposData ?? []).map((e) => [e.id, e]));

  const resultado: Record<string, ParticipanteResuelto> = {};
  for (const fila of filas) {
    if (fila.team_id) {
      const equipo = equipoPorTeamId[fila.team_id];
      resultado[fila.id] = { nombre: equipo?.name ?? "Equipo de RemorApp", logoUrl: equipo?.logo_url ?? null };
    } else if (fila.user_id) {
      const perfil = perfilPorUserId[fila.user_id];
      const nombre = perfil?.nick ? `${perfil.nick}#${perfil.unique_id}` : "Jugador de RemorApp";
      resultado[fila.id] = { nombre, logoUrl: perfil?.avatar_url ?? null };
    }
  }
  return resultado;
}
