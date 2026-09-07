import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PosicionGrupo, TournamentGroupMatchRow, TournamentGroupRow } from "../types/tournaments";

interface GroupStageProps {
  grupos: TournamentGroupRow[];
  partidas: TournamentGroupMatchRow[];
  posiciones: PosicionGrupo[];
  nombresPorParticipante: Record<string, string>;
  puedeReportarPorParticipante: Record<string, boolean>;
  userId: string | null;
  organizadorId: string;
  onCambio: () => void;
  // Migración 057: First Stand organiza sus partidos por jornada y
  // pide el resultado detallado (2-0/2-1) para calcular puntos -- un
  // torneo de grupos "clásico" (varios grupos) sigue reportando con un
  // solo clic, sin jornadas.
  esFirstStand?: boolean;
  // Migración 069 (Suizo): agrupa los partidos por jornada igual que
  // First Stand, pero sin su selector de resultado 2-0/2-1 -- Suizo
  // reporta con un solo clic (ganó/perdió), como la etapa de grupos
  // "clásica".
  agruparPorJornada?: boolean;
  // Migración 069: en false, solo el organizador puede reportar.
  permiteAutoreporte?: boolean;
  // Migración 069 (opciones avanzadas, pestaña Misc): en false, oculta
  // la tabla de posiciones -- los partidos se siguen mostrando igual.
  mostrarPosiciones?: boolean;
}

// Etapa de grupos (migración 041): tabla de posiciones + partidos de
// todos contra todos de cada grupo, antes de que exista la llave
// eliminatoria. Mismo espíritu que BracketView.tsx, pero sin rondas ni
// líneas de conexión -- acá todos los partidos de un grupo son de la
// misma "ronda" (todos contra todos).
export default function GroupStage({
  grupos,
  partidas,
  posiciones,
  nombresPorParticipante,
  puedeReportarPorParticipante,
  userId,
  organizadorId,
  onCambio,
  esFirstStand = false,
  agruparPorJornada = false,
  permiteAutoreporte = true,
  mostrarPosiciones = true,
}: GroupStageProps) {
  const [reportando, setReportando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const nombreDe = (participantId: string) => nombresPorParticipante[participantId] ?? "Jugador de RemorApp";

  const puedeReportar = (match: TournamentGroupMatchRow) => {
    if (!userId) return false;
    if (userId === organizadorId) return true;
    if (!permiteAutoreporte) return false;
    return !!puedeReportarPorParticipante[match.participant1_id] || !!puedeReportarPorParticipante[match.participant2_id];
  };

  const handleReportar = async (matchId: string, ganadorId: string, resultadoPerdedor: number | null = null) => {
    setReportando(matchId);
    setErrores((prev) => ({ ...prev, [matchId]: "" }));

    const { error } = await supabase.rpc("reportar_resultado_grupo", {
      p_match_id: matchId,
      p_ganador_id: ganadorId,
      p_resultado_perdedor: resultadoPerdedor,
    });

    setReportando(null);

    if (error) {
      setErrores((prev) => ({ ...prev, [matchId]: error.message }));
      return;
    }

    onCambio();
  };

  return (
    <div className="group-stage">
      {grupos.map((grupo) => {
        const posicionesGrupo = posiciones.filter((p) => p.group_id === grupo.id);
        const partidasGrupo = partidas.filter((m) => m.group_id === grupo.id);

        return (
          <div key={grupo.id} className="group-stage-block">
            <h3 className="detail-subtitle">{grupo.nombre}</h3>

            {mostrarPosiciones && (
              <table className="group-standings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Participante</th>
                    <th>G</th>
                    <th>J</th>
                    {(esFirstStand || agruparPorJornada) && (
                      <>
                        <th>Pts</th>
                        <th>Dif</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {posicionesGrupo.map((p, indice) => (
                    <tr key={p.participant_id}>
                      <td>{indice + 1}</td>
                      <td>{nombreDe(p.participant_id)}</td>
                      <td>{p.ganados}</td>
                      <td>{p.jugados}</td>
                      {(esFirstStand || agruparPorJornada) && (
                        <>
                          <td>{p.puntos}</td>
                          <td>{p.dif_mapas > 0 ? `+${p.dif_mapas}` : p.dif_mapas}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* First Stand organiza el fixture en 7 jornadas fijas, y
                Suizo en rondas que se generan de a una -- las dos se
                muestran agrupadas; la etapa de grupos "clásica" (varios
                grupos chicos) sigue sin jornadas, todo junto. */}
            {(esFirstStand || agruparPorJornada
              ? [...new Set(partidasGrupo.map((m) => m.jornada ?? 0))].sort((a, b) => a - b)
              : [null]
            ).map((jornada) => (
              <div key={jornada ?? "unica"} className="group-stage-matches">
                {(esFirstStand || agruparPorJornada) && (
                  <h4 className="detail-subtitle">{agruparPorJornada ? `Ronda ${jornada}` : `Jornada ${jornada}`}</h4>
                )}
                {partidasGrupo
                  .filter((m) => !esFirstStand || m.jornada === jornada)
                  .map((match) => (
                    <div key={match.id} className="bracket-match group-stage-match">
                      <div
                        className={`bracket-slot ${
                          match.ganador_id === match.participant1_id ? "winner" : match.status === "jugado" ? "loser" : ""
                        }`}
                      >
                        {nombreDe(match.participant1_id)}
                        {match.status === "jugado" && match.resultado_participant1 !== null && (
                          <span className="veto-tag">
                            {" "}
                            {match.resultado_participant1}-{match.resultado_participant2}
                          </span>
                        )}
                      </div>
                      <div
                        className={`bracket-slot ${
                          match.ganador_id === match.participant2_id ? "winner" : match.status === "jugado" ? "loser" : ""
                        }`}
                      >
                        {nombreDe(match.participant2_id)}
                      </div>

                      {match.status === "pendiente" && puedeReportar(match) && !esFirstStand && (
                        <div className="bracket-report">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant1_id)}
                          >
                            Ganó {nombreDe(match.participant1_id)}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant2_id)}
                          >
                            Ganó {nombreDe(match.participant2_id)}
                          </button>
                        </div>
                      )}

                      {/* First Stand es al mejor de 3: hace falta el
                          resultado del que pierde (0 o 1) para el
                          sistema de puntos, además de quién gana. */}
                      {match.status === "pendiente" && puedeReportar(match) && esFirstStand && (
                        <div className="bracket-report">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant1_id, 0)}
                          >
                            Ganó {nombreDe(match.participant1_id)} 2-0
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant1_id, 1)}
                          >
                            Ganó {nombreDe(match.participant1_id)} 2-1
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant2_id, 1)}
                          >
                            Ganó {nombreDe(match.participant2_id)} 2-1
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant2_id, 0)}
                          >
                            Ganó {nombreDe(match.participant2_id)} 2-0
                          </button>
                        </div>
                      )}

                      {errores[match.id] && <div className="form-error">{errores[match.id]}</div>}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
