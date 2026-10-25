import { useEffect, useState } from "react";
import { obtenerAuditoria, obtenerEstadisticasGenerales, obtenerNombresJugadores } from "../../../lib/osr";
import type { OsrAuditoriaFila, OsrEstadisticasGenerales } from "../../../lib/osr";
import { formatFecha } from "../../../lib/formatters";

const ETIQUETA_ACCION: Record<string, string> = {
  creada: "Creada",
  verificada: "Verificada",
  rechazada: "Rechazada",
  corregida: "Corregida",
  eliminada: "Eliminada",
};

export default function OsrModAuditoriaYEstadisticas({ temporadaId }: { temporadaId: string }) {
  const [stats, setStats] = useState<OsrEstadisticasGenerales | null>(null);
  const [auditoria, setAuditoria] = useState<OsrAuditoriaFila[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [statsResultado, auditoriaResultado] = await Promise.all([
        obtenerEstadisticasGenerales(temporadaId),
        obtenerAuditoria(temporadaId),
      ]);
      if (cancelado) return;
      setStats(statsResultado);
      setAuditoria(auditoriaResultado);
      setNombres(await obtenerNombresJugadores(auditoriaResultado.map((a) => a.moderador_id)));
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId]);

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  return (
    <>
      <h4>Estadísticas generales</h4>
      {stats && (
        <div className="osr-resumen-grid">
          <div className="osr-resumen-card">
            <h4>Jugadores activos</h4>
            <strong>{stats.jugadores_activos}</strong>
          </div>
          <div className="osr-resumen-card">
            <h4>Partidas verificadas</h4>
            <strong>{stats.partidas_verificadas}</strong>
          </div>
          <div className="osr-resumen-card">
            <h4>Partidas pendientes</h4>
            <strong>{stats.partidas_pendientes}</strong>
          </div>
          <div className="osr-resumen-card">
            <h4>Partidas rechazadas</h4>
            <strong>{stats.partidas_rechazadas}</strong>
          </div>
          <div className="osr-resumen-card">
            <h4>Paternidades consolidadas</h4>
            <strong>{stats.paternidades_consolidadas}</strong>
          </div>
          <div className="osr-resumen-card">
            <h4>Paternidades en disputa</h4>
            <strong>{stats.paternidades_disputadas}</strong>
          </div>
        </div>
      )}

      <h4 className="osr-section-spacer">Historial de cambios (auditoría)</h4>
      {auditoria.length === 0 ? (
        <p className="detail-empty">Todavía no hay cambios registrados en esta temporada.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Moderador</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {auditoria.map((a) => (
              <tr key={a.id}>
                <td>{formatFecha(a.creado_en)}</td>
                <td>{ETIQUETA_ACCION[a.accion] ?? a.accion}</td>
                <td>{nombres[a.moderador_id] ?? "Jugador de RemorApp"}</td>
                <td>{a.motivo ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
