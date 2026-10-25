import { useEffect, useState, type FormEvent } from "react";
import { corregirPartida, eliminarPartida, obtenerNombresJugadores, obtenerPartidasVerificadas } from "../../../lib/osr";
import type { OsrPartida } from "../../../types/osr";
import { formatFecha } from "../../../lib/formatters";
import BuscadorJugadorOsr from "./BuscadorJugadorOsr";

interface Jugador {
  id: string;
  nick: string | null;
  unique_id: number | null;
}

export default function OsrModCorregir({ temporadaId }: { temporadaId: string }) {
  const [partidas, setPartidas] = useState<OsrPartida[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<OsrPartida | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    const resultado = await obtenerPartidasVerificadas(temporadaId);
    setPartidas(resultado);
    setNombres(await obtenerNombresJugadores(resultado.flatMap((p) => [p.ganador_user_id, p.perdedor_user_id])));
    setCargando(false);
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporadaId]);

  async function handleEliminar(p: OsrPartida) {
    const motivo = window.prompt("Motivo para eliminar esta partida (obligatorio, queda en la auditoría):");
    if (!motivo || !motivo.trim()) return;
    setError(null);
    const { error: err } = await eliminarPartida(p.id, motivo.trim());
    if (err) setError(err);
    else await recargar();
  }

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  return (
    <>
      <h4>Partidas verificadas -- corregir o eliminar</h4>
      {error && <div className="form-error">{error}</div>}
      {partidas.length === 0 ? (
        <p className="detail-empty">Todavía no hay partidas verificadas en esta temporada.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ganador</th>
              <th>Perdedor</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id}>
                <td>{formatFecha(p.fecha)}</td>
                <td>{nombres[p.ganador_user_id] ?? "Jugador de RemorApp"}</td>
                <td>{nombres[p.perdedor_user_id] ?? "Jugador de RemorApp"}</td>
                <td>{p.estado === "corregida" ? "Corregida" : "Verificada"}</td>
                <td className="osr-acciones-partida">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditando(p)}>
                    Corregir
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => handleEliminar(p)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando && (
        <FormularioCorreccion
          partida={editando}
          onCancelar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null);
            recargar();
          }}
        />
      )}
    </>
  );
}

function FormularioCorreccion({
  partida,
  onCancelar,
  onGuardada,
}: {
  partida: OsrPartida;
  onCancelar: () => void;
  onGuardada: () => void;
}) {
  const [ganador, setGanador] = useState<Jugador | null>(null);
  const [perdedor, setPerdedor] = useState<Jugador | null>(null);
  const [fecha, setFecha] = useState(() => new Date(partida.fecha).toISOString().slice(0, 16));
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ganadorId = ganador?.id ?? partida.ganador_user_id;
    const perdedorId = perdedor?.id ?? partida.perdedor_user_id;
    if (!motivo.trim()) {
      setError("El motivo es obligatorio -- queda en la auditoría.");
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: err } = await corregirPartida({
      partidaId: partida.id,
      nuevoGanadorUserId: ganadorId,
      nuevoPerdedorUserId: perdedorId,
      nuevaFecha: new Date(fecha).toISOString(),
      motivo: motivo.trim(),
    });
    setEnviando(false);
    if (err) {
      setError(err);
      return;
    }
    onGuardada();
  }

  return (
    <form onSubmit={handleSubmit} className="osr-form osr-section-spacer">
      <h4>Corregir partida</h4>
      <p className="detail-empty">Dejá el buscador sin tocar si no cambia ese jugador -- solo se actualiza lo que elijas.</p>
      {error && <div className="form-error">{error}</div>}

      <BuscadorJugadorOsr etiqueta="Nuevo ganador (opcional)" seleccionado={ganador} onSeleccionar={setGanador} />
      <BuscadorJugadorOsr etiqueta="Nuevo perdedor (opcional)" seleccionado={perdedor} onSeleccionar={setPerdedor} />

      <label>
        Fecha y hora
        <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
      </label>
      <label>
        Motivo de la corrección
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} required />
      </label>

      <div className="osr-acciones-partida">
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? "Guardando..." : "Guardar corrección"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
