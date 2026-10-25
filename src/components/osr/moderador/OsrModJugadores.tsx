import { useEffect, useState, type FormEvent } from "react";
import BuscadorJugadorOsr from "./BuscadorJugadorOsr";
import { activarJugador, inscribirJugador, obtenerJugadoresTemporadaTodos } from "../../../lib/osr";
import { CATEGORIAS_OSR, RAZAS_OSR } from "../../../types/osr";
import type { OsrJugador, RazaOsr, CategoriaOsr } from "../../../types/osr";
import { supabase } from "../../../lib/supabaseClient";

interface Jugador {
  id: string;
  nick: string | null;
  unique_id: number | null;
}

export default function OsrModJugadores({ temporadaId }: { temporadaId: string }) {
  const [inscriptos, setInscriptos] = useState<OsrJugador[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [perfiles, setPerfiles] = useState<Record<string, Jugador>>({});
  const [cargando, setCargando] = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const [jugador, setJugador] = useState<Jugador | null>(null);
  const [raza, setRaza] = useState<RazaOsr>("terran");
  const [categoria, setCategoria] = useState<CategoriaOsr>("3500");
  const [mmrOficial, setMmrOficial] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    const filas = await obtenerJugadoresTemporadaTodos(temporadaId);
    setInscriptos(filas);
    if (filas.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, nick, unique_id")
        .in("id", filas.map((f) => f.user_id));
      setNombres(Object.fromEntries((data ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])));
      setPerfiles(Object.fromEntries((data ?? []).map((p) => [p.id, { id: p.id, nick: p.nick, unique_id: p.unique_id }])));
    }
    setCargando(false);
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporadaId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!jugador) {
      setError("Elegí un jugador.");
      return;
    }
    const mmr = Number(mmrOficial);
    if (!Number.isFinite(mmr) || mmr < 0) {
      setError("El MMR oficial tiene que ser un número válido.");
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: err } = await inscribirJugador({ temporadaId, userId: jugador.id, raza, categoria, mmrOficial: mmr });
    setEnviando(false);
    if (err) {
      setError(err);
      return;
    }
    setJugador(null);
    setMmrOficial("");
    setEditandoId(null);
    await recargar();
  }

  async function handleActivar(jugadorId: string, activo: boolean) {
    await activarJugador(jugadorId, activo);
    await recargar();
  }

  function handleEditar(j: OsrJugador) {
    setEditandoId(j.id);
    setJugador(perfiles[j.user_id] ?? { id: j.user_id, nick: nombres[j.user_id] ?? null, unique_id: null });
    setRaza(j.raza_principal);
    setCategoria(j.categoria);
    setMmrOficial(String(j.mmr_oficial_inicial));
    setError(null);
  }

  function handleCancelarEdicion() {
    setEditandoId(null);
    setJugador(null);
    setMmrOficial("");
    setError(null);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="osr-form">
        <h4>{editandoId ? "Editar jugador" : "Inscribir jugador"}</h4>
        <p className="detail-empty">
          La categoría y la raza quedan fijas para toda la temporada. El MMR oficial solo se usa para asignar la categoría, no es
          el MMR del evento.
        </p>
        {error && <div className="form-error">{error}</div>}

        <BuscadorJugadorOsr etiqueta="Jugador" seleccionado={jugador} onSeleccionar={setJugador} />

        <label>
          Raza principal (de este evento)
          <select value={raza} onChange={(e) => setRaza(e.target.value as RazaOsr)}>
            {RAZAS_OSR.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaOsr)}>
            {CATEGORIAS_OSR.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          MMR oficial de SC2 (al momento de inscribirse)
          <input type="number" min={0} value={mmrOficial} onChange={(e) => setMmrOficial(e.target.value)} required />
        </label>

        <div className="osr-acciones-partida">
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? "Guardando..." : editandoId ? "Guardar cambios" : "Inscribir"}
          </button>
          {editandoId && (
            <button type="button" className="btn btn-ghost" onClick={handleCancelarEdicion}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <h4 className="osr-section-spacer">Jugadores inscriptos</h4>
      {cargando ? (
        <p className="detail-empty">Cargando...</p>
      ) : inscriptos.length === 0 ? (
        <p className="detail-empty">Todavía no hay jugadores inscriptos en esta temporada.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Raza</th>
              <th>Categoría</th>
              <th>MMR del evento</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inscriptos.map((j) => (
              <tr key={j.id}>
                <td>{nombres[j.user_id] ?? "Jugador de RemorApp"}</td>
                <td>{RAZAS_OSR.find((r) => r.value === j.raza_principal)?.label}</td>
                <td>{CATEGORIAS_OSR.find((c) => c.value === j.categoria)?.label}</td>
                <td>{j.mmr_evento}</td>
                <td>{j.activo ? "Activo" : "Desactivado"}</td>
                <td className="osr-acciones-partida">
                  <button type="button" className="btn-link" onClick={() => handleEditar(j)}>
                    Editar
                  </button>
                  <button type="button" className="btn-link" onClick={() => handleActivar(j.id, !j.activo)}>
                    {j.activo ? "Desactivar" : "Reactivar"}
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
