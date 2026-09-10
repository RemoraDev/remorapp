import { useState } from "react";
import { Link } from "react-router-dom";
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
  // Migración 078: presentación "de liga" para Todos contra todos --
  // tabla de posiciones en franjas por puesto (en vez de la tabla
  // simple) y el fixture en columnas por ronda (en vez de secciones
  // apiladas una debajo de otra). Ningún otro modo pasa esto: Suizo,
  // First Stand y la etapa de grupos clásica se ven exactamente igual
  // que siempre.
  estiloRanking?: boolean;
  // Migración 083: tag del equipo propio del usuario que mira la
  // página (si tiene uno) -- para armar el link "Ir a la Clan War" en
  // los partidos de liga que ya no se reportan con un click, sino
  // desde el Gestor de eventos del equipo.
  miEquipoTag?: string | null;
  // Migración 085: id de MI participante en ESTE torneo puntual (si
  // estoy inscrito) -- sin esto, el link "Ir a la Clan War" se ofrecía
  // a cualquiera que pudiera reportar (incluido el organizador, que
  // puede no pertenecer a ninguno de los dos clanes de ese partido
  // puntual), mandando a organizadores ajenos al panel de SU propio
  // equipo en vez de al de ninguno de los dos equipos reales del
  // partido.
  miParticipantId?: string | null;
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
  estiloRanking = false,
  miEquipoTag = null,
  miParticipantId = null,
}: GroupStageProps) {
  const [reportando, setReportando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  // Pestañas Posiciones/Partidos (migración 078): solo tiene sentido
  // con estiloRanking -- los demás modos siguen mostrando todo
  // apilado en una sola vista, como siempre.
  const [tabActiva, setTabActiva] = useState<"posiciones" | "partidos">("posiciones");

  // Migración 085: participant2_id null es un bye real (Suizo con
  // cantidad impar de inscritos), no un hueco esperando resultado --
  // se etiqueta igual que un bye de la llave eliminatoria.
  const nombreDe = (participantId: string | null) =>
    participantId ? nombresPorParticipante[participantId] ?? "Jugador de RemorApp" : "BYE";

  // Historial de un participante en orden de ronda: una tira de W/E/L
  // de sus partidos ya jugados, para ver de un vistazo cómo viene.
  // Migración 083: un partido de liga (Clan War vinculada) puede
  // terminar empatado -- ganador_id null con status 'jugado' ya no es
  // automáticamente una derrota.
  const historialDe = (partidasGrupo: TournamentGroupMatchRow[], participantId: string) =>
    partidasGrupo
      .filter(
        (m) => m.status === "jugado" && (m.participant1_id === participantId || m.participant2_id === participantId)
      )
      .sort((a, b) => (a.jornada ?? 0) - (b.jornada ?? 0))
      .map((m) => (m.ganador_id === null ? "E" : m.ganador_id === participantId ? "W" : "L"));

  const puedeReportar = (match: TournamentGroupMatchRow) => {
    if (!userId) return false;
    if (userId === organizadorId) return true;
    if (!permiteAutoreporte) return false;
    return (
      !!puedeReportarPorParticipante[match.participant1_id] ||
      (!!match.participant2_id && !!puedeReportarPorParticipante[match.participant2_id])
    );
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
          <div key={grupo.id} className={`group-stage-block ${estiloRanking ? "group-stage-block-ancho" : ""}`}>
            <h3 className="detail-subtitle">{grupo.nombre}</h3>

            {estiloRanking && (
              <div className="admin-tabs">
                <button
                  type="button"
                  className={`admin-tab ${tabActiva === "posiciones" ? "active" : ""}`}
                  onClick={() => setTabActiva("posiciones")}
                >
                  Posiciones
                </button>
                <button
                  type="button"
                  className={`admin-tab ${tabActiva === "partidos" ? "active" : ""}`}
                  onClick={() => setTabActiva("partidos")}
                >
                  Partidos
                </button>
              </div>
            )}

            {mostrarPosiciones && estiloRanking && tabActiva === "posiciones" && (
              <div className="ranking-strip-table">
                {posicionesGrupo.map((p, indice) => (
                  <div key={p.participant_id} className={`ranking-strip-row ${indice === 0 ? "top" : ""}`}>
                    <span className="ranking-strip-puesto">#{indice + 1}</span>
                    <span className="ranking-strip-nombre">{nombreDe(p.participant_id)}</span>
                    <span className="ranking-strip-historial">
                      {historialDe(partidasGrupo, p.participant_id).map((resultado, i) => (
                        <span
                          key={i}
                          className={`ranking-strip-badge ${
                            resultado === "W" ? "win" : resultado === "E" ? "draw" : "loss"
                          }`}
                        >
                          {resultado}
                        </span>
                      ))}
                    </span>
                    <span className="ranking-strip-stats">
                      <span>
                        PJ <b>{p.jugados}</b>
                      </span>
                      <span>
                        G <b>{p.ganados}</b>
                      </span>
                      <span>
                        E <b>{p.empatados}</b>
                      </span>
                      <span>
                        L <b>{p.jugados - p.ganados - p.empatados}</b>
                      </span>
                      <span>
                        Pts <b>{p.puntos}</b>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {mostrarPosiciones && !estiloRanking && (
              <div className="table-scroll">
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
              </div>
            )}

            {/* First Stand organiza el fixture en 7 jornadas fijas, y
                Suizo en rondas que se generan de a una -- las dos se
                muestran agrupadas; la etapa de grupos "clásica" (varios
                grupos chicos) sigue sin jornadas, todo junto. Todos
                contra todos (estiloRanking) también se agrupa por
                ronda, pero en columnas lado a lado en vez de
                secciones apiladas -- tiene sentido porque ahí SÍ se
                conocen todas las rondas de entrada, no se van
                generando de a una como en Suizo. Con estiloRanking,
                además, esto vive detrás de la pestaña "Partidos". */}
            {(!estiloRanking || tabActiva === "partidos") && (
            <div className={estiloRanking ? "group-stage-rondas-columnas" : undefined}>
              {(esFirstStand || agruparPorJornada
                ? [...new Set(partidasGrupo.map((m) => m.jornada ?? 0))].sort((a, b) => a - b)
                : [null]
              ).map((jornada) => (
              <div key={jornada ?? "unica"} className="group-stage-matches">
                {(esFirstStand || agruparPorJornada) && (
                  <h4 className="detail-subtitle">{agruparPorJornada ? `Ronda ${jornada}` : `Jornada ${jornada}`}</h4>
                )}
                {partidasGrupo
                  .filter((m) => (!esFirstStand && !agruparPorJornada) || m.jornada === jornada)
                  .map((match) => (
                    <div key={match.id} className="bracket-match group-stage-match">
                      <div
                        className={`bracket-slot ${
                          match.status !== "jugado"
                            ? ""
                            : match.ganador_id === null
                              ? "draw"
                              : match.ganador_id === match.participant1_id
                                ? "winner"
                                : "loser"
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
                          match.status !== "jugado"
                            ? ""
                            : match.ganador_id === null
                              ? "draw"
                              : match.ganador_id === match.participant2_id
                                ? "winner"
                                : "loser"
                        }`}
                      >
                        {nombreDe(match.participant2_id)}
                      </div>

                      {/* Migración 083: un partido de liga con Clan War
                          vinculada no se reporta con un click acá --
                          el resultado sale de cerrar_clan_war() cuando
                          los dos capitanes cierran la guerra. */}
                      {match.status === "pendiente" && match.clan_war_id && (
                        <div className="bracket-report">
                          {/* El link solo se ofrece si mi propio equipo es
                              justo uno de los dos de ESTE partido -- antes
                              se ofrecía a cualquiera que pudiera reportar
                              (incluido el organizador de un clan ajeno),
                              con el link apuntando a un equipo sin nada
                              que ver con este partido. */}
                          {miEquipoTag &&
                          (match.participant1_id === miParticipantId || match.participant2_id === miParticipantId) ? (
                            <Link className="btn btn-ghost" to={`/equipos/${miEquipoTag}?panel=eventos`}>
                              Ir a la Clan War
                            </Link>
                          ) : (
                            <p className="tournament-card-meta">Se juega como Clan War entre los dos clanes.</p>
                          )}
                        </div>
                      )}

                      {match.status === "pendiente" &&
                        match.participant2_id &&
                        puedeReportar(match) &&
                        !esFirstStand &&
                        !match.clan_war_id && (
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
                            onClick={() => handleReportar(match.id, match.participant2_id as string)}
                          >
                            Ganó {nombreDe(match.participant2_id)}
                          </button>
                        </div>
                      )}

                      {/* First Stand es al mejor de 3: hace falta el
                          resultado del que pierde (0 o 1) para el
                          sistema de puntos, además de quién gana.
                          Migración 087: si el partido ya tiene una
                          Clan War vinculada, el resultado sale de ahí
                          (ver el bloque de arriba, "Ir a la Clan
                          War") -- este botón de un solo clic ya no
                          aplica, reportar_resultado_grupo() lo
                          rechaza igual, pero no queremos ni mostrarlo. */}
                      {match.status === "pendiente" &&
                        match.participant2_id &&
                        puedeReportar(match) &&
                        esFirstStand &&
                        !match.clan_war_id && (
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
                            onClick={() => handleReportar(match.id, match.participant2_id as string, 1)}
                          >
                            Ganó {nombreDe(match.participant2_id)} 2-1
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={reportando === match.id}
                            onClick={() => handleReportar(match.id, match.participant2_id as string, 0)}
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
            )}
          </div>
        );
      })}
    </div>
  );
}
