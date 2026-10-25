import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

interface Resultado {
  id: string;
  nick: string | null;
  unique_id: number | null;
}

interface Props {
  etiqueta: string;
  seleccionado: Resultado | null;
  onSeleccionar: (jugador: Resultado | null) => void;
}

// Buscador simple por nick (ilike parcial, mismo criterio que
// BuscadorGlobal.tsx) -- reutilizado por las dos pantallas del Panel
// de moderador que necesitan elegir un jugador real (inscribir,
// registrar partida).
export default function BuscadorJugadorOsr({ etiqueta, seleccionado, onSeleccionar }: Props) {
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    if (termino.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const { data } = await supabase.from("profiles").select("id, nick, unique_id").ilike("nick", `%${termino.trim()}%`).limit(8);
    setResultados((data ?? []) as Resultado[]);
    setBuscando(false);
  }

  if (seleccionado) {
    return (
      <div className="osr-buscador-jugador">
        <label>{etiqueta}</label>
        <div className="osr-buscador-seleccionado">
          <span>
            {seleccionado.nick ?? "Jugador de RemorApp"}
            {seleccionado.unique_id ? `#${seleccionado.unique_id}` : ""}
          </span>
          <button type="button" className="btn-link" onClick={() => onSeleccionar(null)}>
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="osr-buscador-jugador">
      <label>{etiqueta}</label>
      <div className="osr-buscador-input-row">
        <input
          type="text"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscar())}
          placeholder="Buscar por nick..."
        />
        <button type="button" className="btn btn-ghost" onClick={buscar} disabled={buscando}>
          Buscar
        </button>
      </div>
      {resultados.length > 0 && (
        <ul className="osr-buscador-resultados">
          {resultados.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onSeleccionar(r)}>
                {r.nick ?? "Jugador de RemorApp"}
                {r.unique_id ? `#${r.unique_id}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
