import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, Medal } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { obtenerNombresDeParticipantes, obtenerNombresDeParticipantesMixto } from "../lib/participants";
import { getModoLabel, getFormatoLabel } from "../lib/tournamentOptions";
import { formatFecha, formatPozo } from "../lib/formatters";
import type { TournamentRow } from "../types/tournaments";

interface ResultadoConNombre {
  participantId: string;
  nombre: string;
  gano: boolean;
  puntaje: number | null;
}

interface TorneoFinalizado {
  torneo: TournamentRow;
  resultados: ResultadoConNombre[];
  // Solo para modo eliminacion_simple (llave) -- ver migración 006.
  campeonNombre: string | null;
  // Solo si el torneo tenía tiene_tercer_lugar -- ver migración 046.
  tercerLugarNombre: string | null;
}

interface PosicionRanking {
  participantId: string;
  nombre: string;
  puntos: number;
}

interface FilaResultado {
  tournament_id: string;
  participant_id: string;
  gano: boolean;
  puntaje: number | null;
}

// Ordena por puntos acumulados (mayor a menor); solo tiene sentido cuando
// tournaments.modo = 'rey_de_la_colina', que es el único modo donde
// tournament_results.puntaje se usa.
function calcularRanking(resultados: ResultadoConNombre[]): PosicionRanking[] {
  const puntosPorParticipante = new Map<string, PosicionRanking>();

  for (const r of resultados) {
    const actual = puntosPorParticipante.get(r.participantId) ?? {
      participantId: r.participantId,
      nombre: r.nombre,
      puntos: 0,
    };
    actual.puntos += r.puntaje ?? 0;
    puntosPorParticipante.set(r.participantId, actual);
  }

  return [...puntosPorParticipante.values()].sort((a, b) => b.puntos - a.puntos);
}

export default function TournamentHistoryPage() {
  const [items, setItems] = useState<TorneoFinalizado[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargarHistorial = async () => {
      // Igual que el listado público: solo torneos públicos, acá filtrando
      // por finalizado en vez de abierto. Los privados finalizados no se
      // listan acá (mismo modelo de "solo por link directo").
      const { data: torneosData, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("publico", true)
        .eq("estado", "finalizado")
        .order("fecha_inicio", { ascending: false });

      if (error || !torneosData) {
        console.error("Error cargando historial:", error);
        setLoading(false);
        return;
      }

      // Performance: antes esto era un for..of secuencial que hacía
      // 2-4 consultas POR TORNEO, una tras otra -- con el historial
      // completo de la app eso son cientos de viajes de ida y vuelta
      // en serie. Ahora se arma en lote: primero se separan los
      // torneos de llave (eliminación simple) de los demás, se junta
      // TODO lo que hay que resolver de cada grupo, y se resuelve con
      // un puñado de consultas .in(...) en vez de una por torneo.
      const torneos = torneosData as TournamentRow[];
      const torneosLlave = torneos.filter((t) => t.modo === "eliminacion_simple");
      const torneosConResultados = torneos.filter((t) => t.modo !== "eliminacion_simple");

      const idsCampeonesYTerceros = [
        ...torneosLlave.flatMap((t) => [t.campeon_participant_id, t.tercer_lugar_participant_id]),
      ].filter((id): id is string => !!id);
      const nombresLlavePromise = obtenerNombresDeParticipantesMixto(idsCampeonesYTerceros);

      let todosLosResultados: FilaResultado[] = [];
      if (torneosConResultados.length > 0) {
        const { data } = await supabase
          .from("tournament_results")
          .select("tournament_id, participant_id, gano, puntaje")
          .in(
            "tournament_id",
            torneosConResultados.map((t) => t.id)
          );
        todosLosResultados = (data ?? []) as FilaResultado[];
      }

      const nombresLlave = await nombresLlavePromise;

      const filasPorTorneo = new Map<string, FilaResultado[]>();
      for (const fila of todosLosResultados) {
        const lista = filasPorTorneo.get(fila.tournament_id) ?? [];
        lista.push(fila);
        filasPorTorneo.set(fila.tournament_id, lista);
      }

      const todosLosParticipantIds = [...new Set(todosLosResultados.map((r) => r.participant_id))];
      const infoPorParticipante = await obtenerNombresDeParticipantes(todosLosParticipantIds);

      const resultadoPorTorneo = new Map<string, TorneoFinalizado>();

      for (const torneo of torneosLlave) {
        resultadoPorTorneo.set(torneo.id, {
          torneo,
          resultados: [],
          campeonNombre: torneo.campeon_participant_id
            ? nombresLlave[torneo.campeon_participant_id]?.nombre ?? "Jugador de RemorApp"
            : null,
          tercerLugarNombre:
            torneo.tiene_tercer_lugar && torneo.tercer_lugar_participant_id
              ? nombresLlave[torneo.tercer_lugar_participant_id]?.nombre ?? "Jugador de RemorApp"
              : null,
        });
      }

      for (const torneo of torneosConResultados) {
        const filas = filasPorTorneo.get(torneo.id) ?? [];
        // Las cuentas suspendidas no aparecen en listados públicos,
        // incluido el historial de resultados/ranking.
        resultadoPorTorneo.set(torneo.id, {
          torneo,
          campeonNombre: null,
          tercerLugarNombre: null,
          resultados: filas
            .filter((r) => !infoPorParticipante[r.participant_id as string]?.suspendido)
            .map((r) => ({
              participantId: r.participant_id as string,
              nombre: infoPorParticipante[r.participant_id as string]?.nombre ?? "Jugador de RemorApp",
              gano: r.gano as boolean,
              puntaje: r.puntaje as number | null,
            })),
        });
      }

      // El orden original (fecha_inicio desc) ya venía de la consulta
      // de torneos -- se reconstruye acá en vez de ordenar de nuevo.
      const resultado = torneos.map((t) => resultadoPorTorneo.get(t.id)).filter((r): r is TorneoFinalizado => !!r);

      setItems(resultado);
      setLoading(false);
    };

    cargarHistorial();
  }, []);

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Historial</h1>
      </div>

      {/* A pedido del usuario: mismo ida y vuelta que TournamentsPage.tsx,
          como pestañas en vez de un link de texto suelto. */}
      <div className="eventos-tabs">
        <Link to="/tournaments" className="eventos-tab">
          Eventos
        </Link>
        <span className="eventos-tab selected">Historial de eventos</span>
      </div>

      {loading && <p className="tournament-card-meta">Cargando historial...</p>}

      {!loading && items.length === 0 && (
        <p className="tournament-card-meta">Todavía no hay torneos finalizados.</p>
      )}

      <div className="history-list">
        {items.map(({ torneo, resultados, campeonNombre, tercerLugarNombre }) => {
          const esReyDeLaColina = torneo.modo === "rey_de_la_colina";
          const esEliminacionSimple = torneo.modo === "eliminacion_simple";
          const ranking = esReyDeLaColina ? calcularRanking(resultados) : [];

          return (
            <div key={torneo.id} className="history-card">
              <div className="detail-badges">
                <span className="badge badge-format">{getFormatoLabel(torneo.formato)}</span>
                <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
              </div>

              <h3 className="tournament-card-title">{torneo.nombre}</h3>
              <p className="tournament-card-meta">
                {formatFecha(torneo.fecha_inicio)}
                {torneo.pozo_premio !== null && <> · Pozo: {formatPozo(torneo.pozo_premio)}</>}
              </p>

              {esEliminacionSimple ? (
                <>
                  <p className="form-success">
                    <Trophy className="icon-inline" />
                    Campeón: {campeonNombre ?? "Sin definir todavía"}
                  </p>
                  {torneo.tiene_tercer_lugar && (
                    <p className="tournament-card-meta">
                      <Medal className="icon-inline" />
                      Tercer lugar: {tercerLugarNombre ?? "Sin definir todavía"}
                    </p>
                  )}
                </>
              ) : esReyDeLaColina ? (
                ranking.length === 0 ? (
                  <p className="detail-empty">Sin resultados registrados todavía.</p>
                ) : (
                  <ol className="ranking-list">
                    {ranking.map((r, i) => (
                      <li key={r.participantId} className="ranking-item">
                        <span className="ranking-position">{i + 1}</span>
                        <span className="ranking-name">{r.nombre}</span>
                        <span className="ranking-points">{r.puntos} pts</span>
                      </li>
                    ))}
                  </ol>
                )
              ) : resultados.length === 0 ? (
                <p className="detail-empty">Sin resultados registrados todavía.</p>
              ) : (
                <ul className="results-list">
                  {resultados.map((r, i) => (
                    <li key={i} className="results-item">
                      <span>{r.nombre}</span>
                      <span className={r.gano ? "result-win" : "result-loss"}>
                        {r.gano ? "Ganó" : "Perdió"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link to={`/tournaments/${torneo.id}`} className="btn-link">
                Ver torneo
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
