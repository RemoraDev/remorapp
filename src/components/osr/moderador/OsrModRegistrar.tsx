import { useState, type FormEvent } from "react";
import BuscadorJugadorOsr from "./BuscadorJugadorOsr";
import { registrarPartida } from "../../../lib/osr";

interface Jugador {
  id: string;
  nick: string | null;
  unique_id: number | null;
}

export default function OsrModRegistrar({ temporadaId, onRegistrada }: { temporadaId: string; onRegistrada: () => void }) {
  const [ganador, setGanador] = useState<Jugador | null>(null);
  const [perdedor, setPerdedor] = useState<Jugador | null>(null);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 16));
  const [fuente, setFuente] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ganador || !perdedor) {
      setError("Elegí ganador y perdedor.");
      return;
    }
    setEnviando(true);
    setError(null);
    setExito(false);
    const { error: err } = await registrarPartida({
      temporadaId,
      ganadorUserId: ganador.id,
      perdedorUserId: perdedor.id,
      fecha: new Date(fecha).toISOString(),
      fuenteVerificacion: fuente || undefined,
      evidenciaUrl: evidencia || undefined,
      observaciones: observaciones || undefined,
    });
    setEnviando(false);
    if (err) {
      setError(err);
      return;
    }
    setExito(true);
    setGanador(null);
    setPerdedor(null);
    setFuente("");
    setEvidencia("");
    setObservaciones("");
    onRegistrada();
  }

  return (
    <form onSubmit={handleSubmit} className="osr-form">
      <h4>Registrar una partida</h4>
      <p className="detail-empty">Queda en estado "pendiente" -- no afecta el MMR hasta que la verifiques.</p>
      {error && <div className="form-error">{error}</div>}
      {exito && <p className="osr-exito">Partida registrada como pendiente.</p>}

      <BuscadorJugadorOsr etiqueta="Ganador" seleccionado={ganador} onSeleccionar={setGanador} />
      <BuscadorJugadorOsr etiqueta="Perdedor" seleccionado={perdedor} onSeleccionar={setPerdedor} />

      <label>
        Fecha y hora
        <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
      </label>
      <label>
        Fuente de verificación (ej. link de SC2 Pulse)
        <input type="text" value={fuente} onChange={(e) => setFuente(e.target.value)} />
      </label>
      <label>
        Evidencia (link a la repetición, si corresponde)
        <input type="text" value={evidencia} onChange={(e) => setEvidencia(e.target.value)} />
      </label>
      <label>
        Observaciones
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} />
      </label>

      <button type="submit" className="btn btn-primary" disabled={enviando}>
        {enviando ? "Registrando..." : "Registrar partida"}
      </button>
    </form>
  );
}
