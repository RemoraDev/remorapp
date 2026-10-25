import { useEffect, useState } from "react";
import { obtenerNombresJugadores, obtenerPartidasPendientes, verificarPartida } from "../../../lib/osr";
import type { OsrPartida } from "../../../types/osr";
import { formatFecha } from "../../../lib/formatters";

export default function OsrModPendientes({ temporadaId }: { temporadaId: string }) {
  const [partidas, setPartidas] = useState<OsrPartida[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    const resultado = await obtenerPartidasPendientes(temporadaId);
    setPartidas(resultado);
    setNombres(await obtenerNombresJugadores(resultado.flatMap((p) => [p.ganador_user_id, p.perdedor_user_id])));
    setCargando(false);
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporadaId]);

  async function manejar(partidaId: string, aprobar: boolean) {
    setError(null);
    setProcesando(partidaId);
    const { error: err } = await verificarPartida(partidaId, aprobar);
    setProcesando(null);
    if (err) setError(err);
    else await recargar();
  }

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  return (
    <>
      <h4>Partidas pendientes de verificar</h4>
      {error && <div className="form-error">{error}</div>}
      {partidas.length === 0 ? (
        <p className="detail-empty">No hay partidas pendientes ahora mismo.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ganador</th>
              <th>Perdedor</th>
              <th>Fuente</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id}>
                <td>{formatFecha(p.fecha)}</td>
                <td>{nombres[p.ganador_user_id] ?? "Jugador de RemorApp"}</td>
                <td>{nombres[p.perdedor_user_id] ?? "Jugador de RemorApp"}</td>
                <td>
                  {p.fuente_verificacion ?? "--"}
                  {p.evidencia_url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={p.evidencia_url} target="_blank" rel="noreferrer">
                        evidencia
                      </a>
                    </>
                  )}
                </td>
                <td className="osr-acciones-partida">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={procesando === p.id}
                    onClick={() => manejar(p.id, true)}
                  >
                    Verificar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={procesando === p.id}
                    onClick={() => manejar(p.id, false)}
                  >
                    Rechazar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
