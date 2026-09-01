import { useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";
import type { BracketMatchRow } from "../types/bracket";

interface BracketViewProps {
  matches: BracketMatchRow[];
  // tournament_participants.id -> nombre para mostrar (nombre del
  // jugador en 1v1, nombre del equipo en 2v2/3v3/4v4).
  nombresPorParticipante: Record<string, string>;
  // tournament_participants.id -> logo del equipo (solo en torneos por
  // equipo; en 1v1 no se pasa este prop).
  logosPorParticipante?: Record<string, string | null>;
  // tournament_participants.id -> si el usuario logueado puede
  // reportar por ese participante: ya viene resuelto desde afuera
  // (BracketView no sabe ni le importa si el torneo es 1v1 o por
  // equipo -- en 1v1 es "soy yo", en equipo es "soy el dueño de ese
  // equipo", pero acá ya llega como un booleano listo).
  puedeReportarPorParticipante: Record<string, boolean>;
  userId: string | null;
  organizadorId: string;
  onCambio: () => void;
}

const ALTURA_PARTIDO_PX = 96;

export default function BracketView({
  matches,
  nombresPorParticipante,
  logosPorParticipante,
  puedeReportarPorParticipante,
  userId,
  organizadorId,
  onCambio,
}: BracketViewProps) {
  const [reportando, setReportando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const rondas = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const partidosPorRonda = rondas.map((r) =>
    matches.filter((m) => m.round === r).sort((a, b) => a.match_number - b.match_number)
  );
  // La ronda 1 siempre tiene la mayor cantidad de partidas: se usa esa
  // altura para las demás columnas, y "justify-content: space-around"
  // (ver .bracket-round en halcon.css) hace que las rondas con menos
  // partidas se centren solas dentro de ese mismo alto -- así se ve
  // el achicamiento típico de una llave sin tener que calcular a mano
  // en qué posición exacta va cada partida.
  const alturaBracket = (partidosPorRonda[0]?.length ?? 1) * ALTURA_PARTIDO_PX;

  const nombreDe = (participantId: string | null) =>
    participantId ? nombresPorParticipante[participantId] ?? "Jugador de RemorApp" : "BYE";

  const logoDe = (participantId: string | null) =>
    participantId ? logosPorParticipante?.[participantId] ?? null : null;

  const puedeReportar = (match: BracketMatchRow) => {
    if (!userId) return false;
    if (userId === organizadorId) return true;
    if (match.participant1_id && puedeReportarPorParticipante[match.participant1_id]) return true;
    if (match.participant2_id && puedeReportarPorParticipante[match.participant2_id]) return true;
    return false;
  };

  const handleReportar = async (matchId: string, ganadorId: string) => {
    setReportando(matchId);
    setErrores((prev) => ({ ...prev, [matchId]: "" }));

    const { error } = await supabase.rpc("reportar_resultado", {
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
    <div className="bracket" style={{ height: `${alturaBracket}px` } as CSSProperties}>
      {partidosPorRonda.map((partidos, indiceRonda) => (
        <div key={rondas[indiceRonda]} className="bracket-round">
          <div className="bracket-round-title">
            {partidos.length === 1 ? "Final" : `Ronda ${rondas[indiceRonda]}`}
          </div>

          {partidos.map((match) => {
            const p1Gana = !!match.winner_id && match.winner_id === match.participant1_id;
            const p2Gana = !!match.winner_id && match.winner_id === match.participant2_id;

            return (
              <div key={match.id} className="bracket-match">
                <div className={`bracket-slot ${p1Gana ? "winner" : match.winner_id ? "loser" : ""}`}>
                  {logoDe(match.participant1_id) && (
                    <img src={logoDe(match.participant1_id) ?? ""} alt="" className="bracket-slot-logo" />
                  )}
                  {nombreDe(match.participant1_id)}
                </div>
                <div
                  className={`bracket-slot ${
                    p2Gana ? "winner" : match.winner_id && match.participant2_id ? "loser" : ""
                  }`}
                >
                  {logoDe(match.participant2_id) && (
                    <img src={logoDe(match.participant2_id) ?? ""} alt="" className="bracket-slot-logo" />
                  )}
                  {nombreDe(match.participant2_id)}
                </div>

                {match.status === "en_disputa" && (
                  <p className="bracket-disputa">
                    Resultado en disputa, un administrador debe resolverlo.
                  </p>
                )}

                {match.status === "pendiente" &&
                  match.participant1_id &&
                  match.participant2_id &&
                  puedeReportar(match) && (
                    <div className="bracket-report">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={reportando === match.id}
                        onClick={() => handleReportar(match.id, match.participant1_id as string)}
                      >
                        Ganó {nombreDe(match.participant1_id)}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={reportando === match.id}
                        onClick={() => handleReportar(match.id, match.participant2_id as string)}
                      >
                        Ganó {nombreDe(match.participant2_id)}
                      </button>
                    </div>
                  )}

                {errores[match.id] && <div className="form-error">{errores[match.id]}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
