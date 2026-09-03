import { supabase } from "../lib/supabaseClient";
import {
  ESTILO_BRACKET_OPTIONS,
  FONDO_BRACKET_OPTIONS,
} from "../types/tournaments";
import type { EstiloBracket, FondoBracket } from "../types/tournaments";

interface BracketStylePickerProps {
  tournamentId: string;
  estilo: EstiloBracket;
  fondo: FondoBracket;
  onCambio: () => void;
}

// Mini-render real del estilo: mismas clases .bracket-match/.bracket-slot
// que la llave de verdad (ver BracketView.tsx y halcon.css), a tamaño
// reducido -- no es una captura de imagen, es el mismo CSS. Dos
// "rondas" de muestra para que también se vea la línea de conexión
// (esa regla exige un .bracket-round que no sea el último).
function MiniBracket({ estilo }: { estilo: EstiloBracket }) {
  return (
    <div className="bracket-style-preview" data-estilo-bracket={estilo}>
      <div className="bracket-round">
        <div className="bracket-match">
          <div className="bracket-slot winner">
            <span className="bracket-slot-logo" style={{ background: "var(--color-accent-soft)" }} />
            Equipo A
          </div>
          <div className="bracket-slot loser">Equipo B</div>
        </div>
      </div>
      <div className="bracket-round">
        <div className="bracket-match">
          <div className="bracket-slot">Final</div>
        </div>
      </div>
    </div>
  );
}

// Selector de estilo de bracket + fondo, solo para el organizador.
// Cada opción se aplica al instante al elegirla (mismo patrón que la
// selección de tema de equipo en TeamDetailPage.tsx) -- el mini-render
// de cada tarjeta ES la vista previa, no hace falta un paso de
// "confirmar" aparte.
export default function BracketStylePicker({ tournamentId, estilo, fondo, onCambio }: BracketStylePickerProps) {
  const handleCambiarEstilo = async (nuevoEstilo: EstiloBracket) => {
    if (nuevoEstilo === estilo) return;
    const { error } = await supabase
      .from("tournaments")
      .update({ estilo_bracket: nuevoEstilo })
      .eq("id", tournamentId);
    if (!error) onCambio();
  };

  const handleCambiarFondo = async (nuevoFondo: FondoBracket) => {
    if (nuevoFondo === fondo) return;
    const { error } = await supabase
      .from("tournaments")
      .update({ fondo_bracket: nuevoFondo })
      .eq("id", tournamentId);
    if (!error) onCambio();
  };

  return (
    <div className="bracket-picker">
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Estilo de bracket</h3>
        <div className="bracket-picker-options">
          {ESTILO_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${estilo === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarEstilo(o.value)}
            >
              <MiniBracket estilo={o.value} />
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
