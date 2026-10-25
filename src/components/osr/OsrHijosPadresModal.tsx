import { useEffect, useState } from "react";
import { X } from "lucide-react";
import useModalEscapeYFoco from "../../hooks/useModalEscapeYFoco";
import { obtenerHijosDe, obtenerPadresDe } from "../../lib/osr";
import type { OsrHijoOPadre } from "../../lib/osr";
import { CATEGORIAS_OSR } from "../../types/osr";

interface Props {
  userId: string;
  nick: string;
  tipo: "hijos" | "padres";
  onClose: () => void;
}

// Sección 9 del documento: al tocar el ícono de hijos/padres, abrir
// una lista con nickname, victorias en cada sentido, diferencia y
// categoría actual -- paternidad histórica (cruza todas las
// temporadas), no solo la activa.
export default function OsrHijosPadresModal({ userId, nick, tipo, onClose }: Props) {
  const [filas, setFilas] = useState<OsrHijoOPadre[] | null>(null);
  const panelRef = useModalEscapeYFoco(onClose, true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const resultado = tipo === "hijos" ? await obtenerHijosDe(userId) : await obtenerPadresDe(userId);
      if (!cancelado) setFilas(resultado);
    })();
    return () => {
      cancelado = true;
    };
  }, [userId, tipo]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="team-leader-panel osr-modal-hijos-padres" onClick={(e) => e.stopPropagation()} ref={panelRef} tabIndex={-1}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h3 className="section-title">
          {tipo === "hijos" ? "Hijos de" : "Padres de"} {nick}
        </h3>
        {filas === null ? (
          <p className="detail-empty">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="detail-empty">{tipo === "hijos" ? "Todavía no tiene hijos consolidados." : "Todavía no tiene padres consolidados."}</p>
        ) : (
          <table className="group-standings-table ranking-table">
            <thead>
              <tr>
                <th>Nickname</th>
                <th>Victorias de {nick}</th>
                <th>Victorias del otro</th>
                <th>Diferencia</th>
                <th>Categoría actual</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.user_id}>
                  <td>{f.nick ?? "Jugador de RemorApp"}</td>
                  <td>{f.victorias_jugador}</td>
                  <td>{f.victorias_otro}</td>
                  <td>+{Math.abs(f.diferencia)}</td>
                  <td>{f.categoria_actual ? CATEGORIAS_OSR.find((c) => c.value === f.categoria_actual)?.label ?? f.categoria_actual : "No inscripto esta temporada"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
