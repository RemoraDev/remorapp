import { supabase } from "./supabaseClient";
import { formatFecha } from "./formatters";
import type { TituloActivoTodos } from "../types/titulos";

// Sala de la Fama -- Galería de Batallas Épicas (migración 030). Cada
// evento se arma con datos que ya existen, nunca inventados: títulos
// Padre/Hijo activados, torneos finalizados, torneos históricos
// confirmados, y la primera vez que alguien llega a Gran Maestro
// (gran_maestro_alcanzado_en, agregado en esta misma migración porque
// no había forma de saber "primera vez" sin guardarlo en algún lado).
export interface EventoGaleria {
  id: string;
  fecha: string;
  texto: string;
  // Para los filtros por clan/jugador (punto 6 del pedido) -- qué
  // equipos y qué jugadores están involucrados en este evento.
  teamIds: string[];
  userIds: string[];
}

async function eventosTitulos(): Promise<EventoGaleria[]> {
  const eventos: EventoGaleria[] = [];

  for (const tipo of ["clan", "jugador"] as const) {
    const { data } = await supabase.rpc("titulos_activos_todos", { p_tipo: tipo });
    const filas = (data ?? []) as TituloActivoTodos[];
    if (filas.length === 0) continue;

    const ids = [...new Set(filas.flatMap((f) => [f.retador_id, f.retado_id]))];
    let nombrePorId: Record<string, string> = {};

    if (tipo === "clan") {
      const { data: equipos } = await supabase.from("teams").select("id, name, tag").in("id", ids);
      nombrePorId = Object.fromEntries((equipos ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`]));
    } else {
      const { data: perfiles } = await supabase.from("profiles").select("id, nick, unique_id").in("id", ids);
      nombrePorId = Object.fromEntries(
        (perfiles ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
      );
    }

    for (const f of filas) {
      const perdedorId = f.ganador_id === f.retador_id ? f.retado_id : f.retador_id;
      const nombreGanador = nombrePorId[f.ganador_id] ?? "Alguien";
      const nombrePerdedor = nombrePorId[perdedorId] ?? "alguien";
      eventos.push({
        id: `titulo-${f.id}`,
        fecha: f.fecha_inicio,
        texto: `${nombreGanador} se hizo Padre de ${nombrePerdedor} el ${formatFecha(f.fecha_inicio)} por ${f.duracion_dias} días`,
        teamIds: tipo === "clan" ? [f.retador_id, f.retado_id] : [],
        userIds: tipo === "jugador" ? [f.retador_id, f.retado_id] : [],
      });
    }
  }

  return eventos;
}

async function eventosTorneosFinalizados(): Promise<EventoGaleria[]> {
  const { data: torneos } = await supabase
    .from("tournaments")
    .select("id, nombre, fecha_inicio, campeon_participant_id")
    .eq("estado", "finalizado")
    .not("campeon_participant_id", "is", null);

  const filas = torneos ?? [];
  if (filas.length === 0) return [];

  const participantIds = filas.map((t) => t.campeon_participant_id as string);
  const { data: participantes } = await supabase
    .from("tournament_participants")
    .select("id, user_id, team_id")
    .in("id", participantIds);

  const participantePorId = Object.fromEntries((participantes ?? []).map((p) => [p.id, p]));

  const teamIds = [...new Set((participantes ?? []).map((p) => p.team_id).filter((id): id is string => !!id))];
  const userIds = [...new Set((participantes ?? []).map((p) => p.user_id).filter((id): id is string => !!id))];

  let nombrePorTeamId: Record<string, string> = {};
  if (teamIds.length > 0) {
    const { data: equipos } = await supabase.from("teams").select("id, name, tag").in("id", teamIds);
    nombrePorTeamId = Object.fromEntries((equipos ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`]));
  }
  let nombrePorUserId: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", userIds);
    nombrePorUserId = Object.fromEntries((perfiles ?? []).map((p) => [p.id, p.nombre ?? "Jugador de RemorApp"]));
  }

  return filas.map((t) => {
    const participante = participantePorId[t.campeon_participant_id as string];
    const teamId: string | null = participante?.team_id ?? null;
    const userId: string | null = participante?.user_id ?? null;
    const nombre = teamId
      ? nombrePorTeamId[teamId] ?? "Equipo de RemorApp"
      : userId
      ? nombrePorUserId[userId] ?? "Jugador de RemorApp"
      : "Alguien";

    return {
      id: `torneo-${t.id}`,
      fecha: t.fecha_inicio,
      texto: `${nombre} ganó ${t.nombre}`,
      teamIds: teamId ? [teamId] : [],
      userIds: userId ? [userId] : [],
    };
  });
}

async function eventosHistoricosConfirmados(): Promise<EventoGaleria[]> {
  const { data } = await supabase
    .from("historical_tournaments")
    .select("id, nombre, fecha_aproximada, primer_lugar_nombre, primer_lugar_team_id")
    .eq("estado", "confirmado");

  return (data ?? []).map((t) => ({
    id: `historico-${t.id}`,
    fecha: t.fecha_aproximada,
    texto: `${t.primer_lugar_nombre} ganó ${t.nombre} (torneo histórico)`,
    teamIds: t.primer_lugar_team_id ? [t.primer_lugar_team_id] : [],
    userIds: [],
  }));
}

async function eventosGranMaestro(): Promise<EventoGaleria[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, nick, unique_id, gran_maestro_alcanzado_en")
    .not("gran_maestro_alcanzado_en", "is", null);

  return (data ?? []).map((p) => ({
    id: `gm-${p.id}`,
    fecha: p.gran_maestro_alcanzado_en as string,
    texto: `${p.nick ? `${p.nick}#${p.unique_id}` : "Un jugador"} alcanzó Gran Maestro por primera vez`,
    teamIds: [],
    userIds: [p.id],
  }));
}

export async function construirGaleria(): Promise<EventoGaleria[]> {
  const [titulos, torneos, historicos, granMaestro] = await Promise.all([
    eventosTitulos(),
    eventosTorneosFinalizados(),
    eventosHistoricosConfirmados(),
    eventosGranMaestro(),
  ]);

  return [...titulos, ...torneos, ...historicos, ...granMaestro].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}
