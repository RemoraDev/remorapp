import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  FONDO_BRACKET_OPTIONS,
  ESTILO_LINEA_BRACKET_OPTIONS,
  ESTRUCTURA_BRACKET_OPTIONS,
} from "../types/tournaments";
import type { FondoBracket, EstiloLineaBracket, EstructuraBracket } from "../types/tournaments";

interface BracketStylePickerProps {
  tournamentId: string;
  fondo: FondoBracket;
  estiloLinea: EstiloLineaBracket;
  estructura: EstructuraBracket;
  onCambio: () => void;
}

// Mini-diagrama abstracto de cada estructura (migración 177) -- mismo
// espíritu que PreviewDiagrama de EstructuraLineupPicker.tsx, 4
// variantes bien distintas entre sí para que se entienda de un
// vistazo sin tener que leer la descripción.
function PreviewEstructura({ variante }: { variante: EstructuraBracket }) {
  if (variante === "vertical") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-vertical">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (variante === "embudo") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-embudo">
        <span />
        <span className="estructura-bracket-preview-centro" />
        <span />
      </div>
    );
  }
  if (variante === "compacta") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-compacta">
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }
  return (
    <div className="estructura-bracket-preview estructura-bracket-preview-clasico">
      <span />
      <span />
      <span />
    </div>
  );
}

// Mini-render del efecto de línea elegido (migración 176): a
// diferencia de la llave real, acá no hay nada que medir en el DOM --
// un trazo en escuadra fijo alcanza para mostrar el efecto, con el
// mismo CSS real (.bracket-conectores, ver halcon.css).
function MiniLinea({ estiloLinea }: { estiloLinea: EstiloLineaBracket }) {
  return (
    <div className="bracket-linea-preview">
      <svg className="bracket-conectores" data-estilo-linea={estiloLinea} viewBox="0 0 90 60">
        <path d="M 5 15 H 45 V 45 H 85" />
      </svg>
    </div>
  );
}

// Selector de estructura + fondo + efecto de línea, solo para el
// organizador. Cada opción se aplica al instante al elegirla (mismo
// patrón que la selección de tema de equipo en TeamDetailPage.tsx) --
// el mini-render de cada tarjeta ES la vista previa, no hace falta un
// paso de "confirmar" aparte.
//
// Migración 178, a pedido del usuario: "Estilo de bracket" (Clásico/
// Esports/StarCraft Oficial) sale del todo -- Esports queda como único
// estilo (ya se setea por default en la base, ver migración 178), sin
// selector visible acá.
export default function BracketStylePicker({
  tournamentId,
  fondo,
  estiloLinea,
  estructura,
  onCambio,
}: BracketStylePickerProps) {
  // Antes, si el update fallaba (por ejemplo porque el constraint de
  // la base todavía no tenía los valores nuevos), no pasaba nada
  // visible -- parecía que el botón "no hacía nada". Ahora se avisa.
  const [error, setError] = useState<string | null>(null);

  const handleCambiarFondo = async (nuevoFondo: FondoBracket) => {
    if (nuevoFondo === fondo) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ fondo_bracket: nuevoFondo })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarLinea = async (nuevaLinea: EstiloLineaBracket) => {
    if (nuevaLinea === estiloLinea) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ estilo_linea_bracket: nuevaLinea })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarEstructura = async (nueva: EstructuraBracket) => {
    if (nueva === estructura) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ estructura_bracket: nueva })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  return (
    <div className="bracket-picker">
      {error && <div className="form-error">{error}</div>}

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Estructura</h3>
        <div className="bracket-picker-options estructura-picker-options">
          {ESTRUCTURA_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option estructura-picker-option ${estructura === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarEstructura(o.value)}
            >
              <PreviewEstructura variante={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
              <span className="estructura-picker-desc">{o.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Efectos de líneas</h3>
        <div className="bracket-picker-options">
          {ESTILO_LINEA_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${estiloLinea === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarLinea(o.value)}
            >
              <MiniLinea estiloLinea={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Fondo</h3>
        <div className="bracket-picker-options">
          {FONDO_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${fondo === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarFondo(o.value)}
            >
              <div className="bracket-fondo-preview" data-fondo-bracket={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
