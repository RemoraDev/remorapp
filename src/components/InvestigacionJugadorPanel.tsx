import { formatFecha } from "../lib/formatters";
import type { InvestigacionJugador } from "../types/investigacion";

interface InvestigacionJugadorPanelProps {
  investigacion: InvestigacionJugador;
}

// Resultado de investigar_jugador() (migración 025), organizado por
// secciones: identidad, historial de nicks, historial de equipos, y
// reportes de inasistencia. Solo se llega acá si quien mira ya pasó
// el chequeo de permiso en la base (dueño de algún equipo o admin) --
// este componente no vuelve a validar nada, solo muestra.
export default function InvestigacionJugadorPanel({ investigacion }: InvestigacionJugadorPanelProps) {
  const { identidad, historial_nicks, historial_equipos, reportes_no_presentado } = investigacion;

  return (
    <div className="team-leader-panel">
      <p className="form-error">
        Esta información es solo para líderes de clan y administradores -- no se la muestres al
        jugador investigado.
      </p>

      <h3 className="detail-subtitle">Identidad</h3>
      <p className="tournament-card-meta">
        {identidad.nick ?? "Sin nick"}
        {identidad.unique_id && <span className="profile-nick-id">#{identidad.unique_id}</span>} ·{" "}
        {identidad.liga_1v1}
      </p>
      <p className="tournament-card-meta">
        {identidad.suspendido && "Cuenta suspendida · "}
        {identidad.poco_confiable && "Poco Responsable · "}
        Valentía {identidad.valentia_jugador}% · Responsabilidad en Clan Wars{" "}
        {identidad.responsabilidad_cw}% · Responsabilidad en torneos {identidad.responsabilidad_torneos}%
      </p>

      <h3 className="detail-subtitle">Historial de nicks</h3>
      {historial_nicks.length === 0 ? (
        <p className="detail-empty">Nunca se cambió el nick.</p>
      ) : (
        <div className="detail-participant-list">
          {historial_nicks.map((n, i) => (
            <div key={i} className="reto-item">
              <p className="reto-desc">{n.nick_anterior}</p>
              <p className="reto-fecha">{formatFecha(n.cambiado_en)}</p>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Historial de equipos</h3>
      {historial_equipos.length === 0 ? (
        <p className="detail-empty">Nunca perteneció a un equipo.</p>
      ) : (
        <div className="detail-participant-list">
          {historial_equipos.map((e, i) => (
            <div key={i} className="reto-item">
              <p className="reto-desc">
                {e.nombre} [{e.tag}]
                <span className="reto-status">{e.salida_en ? e.motivo_salida ?? "Salió" : "Actual"}</span>
              </p>
              <p className="reto-fecha">
                Entrada: {e.entrada_en ? formatFecha(e.entrada_en) : "sin registro"}
                {e.salida_en && ` · Salida: ${formatFecha(e.salida_en)}`}
              </p>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Reportes de "no se presentó"</h3>
      {reportes_no_presentado.length === 0 ? (
        <p className="detail-empty">Sin reportes de inasistencia.</p>
      ) : (
        <div className="detail-participant-list">
          {reportes_no_presentado.map((r, i) => (
            <div key={i} className="reto-item">
              <p className="reto-desc">Reportado por {r.reportado_por_nombre}</p>
              <p className="reto-fecha">{formatFecha(r.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
