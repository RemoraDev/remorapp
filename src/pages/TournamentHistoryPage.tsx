import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { obtenerNombresDeParticipantes } from "../lib/participants";
import { getModoLabel } from "../lib/tournamentOptions";
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
}

interface PosicionRanking {
  participantId: string;
  nombre: string;
  puntos: number;
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

      const resultado: TorneoFinalizado[] = [];

      for (const torneo of torneosData as TournamentRow[]) {
        const { data: resultadosData } = await supabase
          .from("tournament_results")
          .select("participant_id, gano, puntaje")
          .eq("tournament_id", torneo.id);

        const filas = resultadosData ?? [];
        const participantIds = [...new Set(filas.map((r) => r.participant_id as string))];
        const nombresPorParticipante = await obtenerNombresDeParticipantes(participantIds);

        resultado.push({
          torneo,
          resultados: filas.map((r) => ({
            participantId: r.participant_id as string,
            nombre: nombresPorParticipante[r.participant_id as string] ?? "Jugador de RemorApp",
            gano: r.gano as boolean,
            puntaje: r.puntaje as number | null,
          })),
        });
      }

      setItems(resultado);
      setLoading(false);
    };

    cargarHistorial();
  }, []);

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Historial</h1>
        <Link to="/tournaments" className="btn-link">
          Ver torneos abiertos
        </Link>
      </div>

      {loading && <p className="tournament-card-meta">Cargando historial...</p>}

      {!loading && items.length === 0 && (
        <p className="tournament-card-meta">Todavía no hay torneos finalizados.</p>
      )}

      <div className="history-list">
        {items.map(({ torneo, resultados }) => {
          const esReyDeLaColina = torneo.modo === "rey_de_la_colina";
          const ranking = esReyDeLaColina ? calcularRanking(resultados) : [];

          return (
            <div key={torneo.id} className="history-card">
              <div className="detail-badges">
                <span className="badge badge-format">{torneo.formato}</span>
                <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
              </div>

              <h3 className="tournament-card-title">{torneo.nombre}</h3>
              <p className="tournament-card-meta">
                {formatFecha(torneo.fecha_inicio)} · Pozo: {formatPozo(torneo.pozo_premio)}
              </p>

              {esReyDeLaColina ? (
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
