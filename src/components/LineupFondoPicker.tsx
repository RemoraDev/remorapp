import { supabase } from "../lib/supabaseClient";
import { FONDO_LINEUP_OPTIONS } from "../types/teams";
import type { FondoLineup } from "../types/teams";

interface LineupFondoPickerProps {
  clanWarId: string;
  fondo: FondoLineup;
  onCambio: () => void;
}

// Selector de fondo para la sala de lineup de una Clan War -- catálogo
// propio (migración 051), distinto del BracketStylePicker de torneos:
// mismo espíritu (cada opción se aplica al instante, el mini-render de
// la tarjeta ES la vista previa), pero sin compartir componente ni
// selectores CSS con el de bracket.
export default function LineupFondoPicker({ clanWarId, fondo, onCambio }: LineupFondoPickerProps) {
  const handleCambiarFondo = async (nuevoFondo: FondoLineup) => {
    if (nuevoFondo === fondo) return;

    // cambiar_fondo_lineup_cw() (en la base) es la que de verdad
    // chequea que seas dueño o capitán y que la Clan War siga
    // aceptada/en curso -- esto de acá es solo el selector.
    const { error } = await supabase.rpc("cambiar_fondo_lineup_cw", {
      p_clan_war_id: clanWarId,
      p_fondo: nuevoFondo,
    });
    if (!error) onCambio();
  };

  return (
    <div className="bracket-picker-group">
      <h5 className="detail-subtitle">Fondo de la sala de lineup</h5>
      <div className="bracket-picker-options">
        {FONDO_LINEUP_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`bracket-picker-option ${fondo === o.value ? "selected" : ""}`}
            onClick={() => handleCambiarFondo(o.value)}
          >
            <div className="lineup-fondo-preview" data-fondo-lineup={o.value} />
            <span className="bracket-picker-option-label">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
