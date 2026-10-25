import { useEffect, useState, type FormEvent } from "react";
import { abrirTemporada, agregarModeradorOsr, esDuenoEquipoOsr, quitarModeradorOsr } from "../../../lib/osr";
import BuscadorJugadorOsr from "./BuscadorJugadorOsr";
import { supabase } from "../../../lib/supabaseClient";
import type { OsrTemporada } from "../../../types/osr";

interface Jugador {
  id: string;
  nick: string | null;
  unique_id: number | null;
}

interface Moderador {
  user_id: string;
  nick: string | null;
  unique_id: number | null;
}

export default function OsrModTemporadaYModeradores({
  temporada,
  onTemporadaAbierta,
}: {
  temporada: OsrTemporada | null;
  onTemporadaAbierta: () => void;
}) {
  const [esDueno, setEsDueno] = useState(false);

  useEffect(() => {
    esDuenoEquipoOsr().then(setEsDueno);
  }, []);

  return (
    <>
      <AbrirTemporada temporadaActual={temporada} onAbierta={onTemporadaAbierta} />
      {esDueno && <GestionarModeradores />}
    </>
  );
}

function AbrirTemporada({ temporadaActual, onAbierta }: { temporadaActual: OsrTemporada | null; onAbierta: () => void }) {
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (temporadaActual) {
      const confirma = window.confirm(
        `Esto cierra "${temporadaActual.nombre}" y abre una temporada nueva. El MMR del evento arranca en 0 para todos -- el historial de partidas y las paternidades NO se borran. ¿Confirmás?`
      );
      if (!confirma) return;
    }
    setEnviando(true);
    setError(null);
    const { error: err } = await abrirTemporada(nombre.trim());
    setEnviando(false);
    if (err) {
      setError(err);
      return;
    }
    setNombre("");
    onAbierta();
  }

  return (
    <form onSubmit={handleSubmit} className="osr-form">
      <h4>Temporada</h4>
      <p className="detail-empty">
        {temporadaActual ? `Temporada activa: ${temporadaActual.nombre}.` : "No hay ninguna temporada activa."} Abrir una nueva
        cierra la actual (si hay) y reinicia el MMR del evento -- el historial y las paternidades quedan intactos.
      </p>
      {error && <div className="form-error">{error}</div>}
      <label>
        Nombre de la nueva temporada
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={enviando || !nombre.trim()}>
        {enviando ? "Abriendo..." : "Abrir temporada nueva"}
      </button>
    </form>
  );
}

function GestionarModeradores() {
  const [moderadores, setModeradores] = useState<Moderador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState<Jugador | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    const { data } = await supabase.from("osr_moderadores").select("user_id, profiles!user_id(nick, unique_id)");
    const filas: Moderador[] = (data ?? []).map((m) => {
      const perfil = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { user_id: m.user_id, nick: perfil?.nick ?? null, unique_id: perfil?.unique_id ?? null };
    });
    setModeradores(filas);
    setCargando(false);
  }

  useEffect(() => {
    recargar();
  }, []);

  async function handleAgregar() {
    if (!nuevo) return;
    setError(null);
    const { error: err } = await agregarModeradorOsr(nuevo.id);
    if (err) {
      setError(err);
      return;
    }
    setNuevo(null);
    await recargar();
  }

  async function handleQuitar(userId: string) {
    setError(null);
    const { error: err } = await quitarModeradorOsr(userId);
    if (err) setError(err);
    else await recargar();
  }

  return (
    <div className="osr-section-spacer">
      <h4>Moderadores</h4>
      <p className="detail-empty">Vos, como dueño del equipo, siempre podés moderar aunque no estés en esta lista.</p>
      {error && <div className="form-error">{error}</div>}

      <div className="osr-buscador-con-boton">
        <BuscadorJugadorOsr etiqueta="Agregar moderador" seleccionado={nuevo} onSeleccionar={setNuevo} />
        {nuevo && (
          <button type="button" className="btn btn-primary" onClick={handleAgregar}>
            Agregar
          </button>
        )}
      </div>

      {cargando ? (
        <p className="detail-empty">Cargando...</p>
      ) : moderadores.length === 0 ? (
        <p className="detail-empty">No agregaste a nadie más todavía.</p>
      ) : (
        <ul className="osr-lista-moderadores">
          {moderadores.map((m) => (
            <li key={m.user_id}>
              <span>
                {m.nick ? `${m.nick}#${m.unique_id}` : "Jugador de RemorApp"}
              </span>
              <button type="button" className="btn-link" onClick={() => handleQuitar(m.user_id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
