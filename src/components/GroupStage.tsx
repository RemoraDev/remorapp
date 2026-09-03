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
}: GroupStageProps) {
  const [reportando, setReportando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const nombreDe = (participantId: string) => nombresPorParticipante[participantId] ?? "Jugador de RemorApp";

  const puedeReportar = (match: TournamentGroupMatchRow) => {
    if (!userId) return false;
    if (userId === organizadorId) return true;
    return !!puedeReportarPorParticipante[match.participant1_id] || !!puedeReportarPorParticipante[match.participant2_id];
  };

  const handleReportar = async (matchId: string, ganadorId: string) => {
    setReportando(matchId);
    setErrores((prev) => ({ ...prev, [matchId]: "" }));

    const { error } = await supabase.rpc("reportar_resultado_grupo", {
      p_match_id: matchId,
      p_ganador_id: ganadorId,
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

            <table className="group-standings-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Participante</th>
                  <th>G</th>
                  <th>J</th>
                </tr>
              </thead>
              <tbody>
                {posicionesGrupo.map((p, indice) => (
                  <tr key={p.participant_id}>
                    <td>{indice + 1}</td>
                    <td>{nombreDe(p.participant_id)}</td>
                    <td>{p.ganados}</td>
                    <td>{p.jugados}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="group-stage-matches">
              {partidasGrupo.map((match) => (
                <div key={match.id} className="bracket-match group-stage-match">
                  <div className={`bracket-slot ${match.ganador_id === match.participant1_id ? "winner" : match.status === "jugado" ? "loser" : ""}`}>
                    {nombreDe(match.participant1_id)}
                  </div>
                  <div className={`bracket-slot ${match.ganador_id === match.participant2_id ? "winner" : match.status === "jugado" ? "loser" : ""}`}>
                    {nombreDe(match.participant2_id)}
                  </div>

                  {match.status === "pendiente" && puedeReportar(match) && (
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

                  {errores[match.id] && <div className="form-error">{errores[match.id]}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
