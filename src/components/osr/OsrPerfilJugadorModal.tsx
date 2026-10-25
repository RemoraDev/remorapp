import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import useModalEscapeYFoco from "../../hooks/useModalEscapeYFoco";
import { obtenerHijosDe, obtenerHistorialPartidasTodas, obtenerNombresJugadores, obtenerPadresDe } from "../../lib/osr";
import type { OsrHijoOPadre } from "../../lib/osr";
import { supabase } from "../../lib/supabaseClient";
import type { OsrJugador, OsrPartida } from "../../types/osr";
import { CATEGORIAS_OSR, RAZAS_OSR } from "../../types/osr";
import { formatFecha } from "../../lib/formatters";
import OsrHijosPadresModal from "./OsrHijosPadresModal";

interface Props {
  userId: string;
  nick: string;
  temporadaId: string;
  onClose: () => void;
}

// Sección 15 del documento: "en la página de cada jugador, permitir
// consultar sus estadísticas actuales y su historial" -- se llega acá
// tocando cualquier nick clickeable (rankings, historial, Top 5).
export default function OsrPerfilJugadorModal({ userId, nick, temporadaId, onClose }: Props) {
  const [jugador, setJugador] = useState<OsrJugador | null>(null);
  const [hijos, setHijos] = useState<OsrHijoOPadre[]>([]);
  const [padres, setPadres] = useState<OsrHijoOPadre[]>([]);
  const [partidas, setPartidas] = useState<OsrPartida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [listaAbierta, setListaAbierta] = useState<"hijos" | "padres" | null>(null);
  const panelRef = useModalEscapeYFoco(onClose, true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [{ data: jugadorFila }, hijosResultado, padresResultado, historial] = await Promise.all([
        supabase.from("osr_jugadores").select("*").eq("temporada_id", temporadaId).eq("user_id", userId).maybeSingle(),
        obtenerHijosDe(userId),
        obtenerPadresDe(userId),
        obtenerHistorialPartidasTodas(),
      ]);
      if (cancelado) return;
      setJugador((jugadorFila as OsrJugador) ?? null);
      setHijos(hijosResultado);
      setPadres(padresResultado);
      setPartidas(historial.filter((p) => p.ganador_user_id === userId || p.perdedor_user_id === userId));
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [userId, temporadaId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="team-leader-panel team-leader-panel-propio osr-modal-perfil" onClick={(e) => e.stopPropagation()} ref={panelRef} tabIndex={-1}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h3 className="section-title">{nick}</h3>

        {cargando ? (
          <p className="detail-empty">Cargando...</p>
        ) : (
          <>
            <div className="osr-resumen-grid">
              <div className="osr-resumen-card">
                <h4>Esta temporada</h4>
                {jugador ? (
                  <>
                    <span className={`osr-raza osr-raza-${jugador.raza_principal}`}>
                      {RAZAS_OSR.find((r) => r.value === jugador.raza_principal)?.label}
                    </span>
                    <p className="osr-raza-stat">{CATEGORIAS_OSR.find((c) => c.value === jugador.categoria)?.label}</p>
                    <p className="osr-raza-stat-sec">MMR del evento: {jugador.mmr_evento}</p>
                  </>
                ) : (
                  <span className="detail-empty">No inscripto esta temporada</span>
                )}
              </div>
              <div className="osr-resumen-card">
                <h4>Hijos consolidados</h4>
                <button type="button" className="btn-link" disabled={hijos.length === 0} onClick={() => setListaAbierta("hijos")}>
                  {hijos.length}
                </button>
              </div>
              <div className="osr-resumen-card">
                <h4>Padres consolidados</h4>
                <button type="button" className="btn-link" disabled={padres.length === 0} onClick={() => setListaAbierta("padres")}>
                  {padres.length}
                </button>
              </div>
            </div>

            <h4 className="osr-section-spacer">Historial (todas las temporadas)</h4>
            {partidas.length === 0 ? (
              <p className="detail-empty">Todavía no tiene partidas registradas.</p>
            ) : (
              <HistorialJugador partidas={partidas} userId={userId} />
            )}
          </>
        )}
      </div>

      {listaAbierta && (
        <OsrHijosPadresModal userId={userId} nick={nick} tipo={listaAbierta} onClose={() => setListaAbierta(null)} />
      )}
    </div>
  );
}

function HistorialJugador({ partidas, userId }: { partidas: OsrPartida[]; userId: string }) {
  const [nombres, setNombres] = useState<Record<string, string>>({});

  useEffect(() => {
    obtenerNombresJugadores(partidas.flatMap((p) => [p.ganador_user_id, p.perdedor_user_id])).then(setNombres);
  }, [partidas]);

  return (
    <table className="group-standings-table ranking-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Rival</th>
          <th>Resultado</th>
          <th>Puntos</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        {partidas.slice(0, 50).map((p) => {
          const gano = p.ganador_user_id === userId;
          const rivalId = gano ? p.perdedor_user_id : p.ganador_user_id;
          const puntos = gano ? p.puntos_ganador : p.puntos_perdedor;
          return (
            <tr key={p.id}>
              <td>{formatFecha(p.fecha)}</td>
              <td>{nombres[rivalId] ?? "Jugador de RemorApp"}</td>
              <td className={gano ? "osr-resultado-victoria" : "osr-resultado-derrota"}>
                {gano ? <CheckCircle2 size={14} className="icon-inline" /> : <XCircle size={14} className="icon-inline" />}{" "}
                {gano ? "Victoria" : "Derrota"}
              </td>
              <td>{p.estado === "verificada" || p.estado === "corregida" ? puntos : "--"}</td>
              <td>{p.estado}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
