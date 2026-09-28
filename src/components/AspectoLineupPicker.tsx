import { supabase } from "../lib/supabaseClient";
import type { AspectoLineup } from "../types/clanWars";

interface AspectoLineupPickerProps {
  clanWarId: string;
  aspecto: AspectoLineup;
  onCambio: () => void;
}

const ASPECTO_OPTIONS: { value: AspectoLineup; label: string; desc: string }[] = [
  { value: "4:3", label: "4:3", desc: "Más cuadrada, clásica" },
  { value: "16:9", label: "16:9", desc: "Panorámica, la de siempre" },
  { value: "16:10", label: "16:10", desc: "Panorámica, un poco más alta" },
  { value: "21:9", label: "21:9", desc: "Ultra panorámica, ideal para overlay de stream" },
];

// Elige la relación de aspecto de la tarjeta del lineup (migración
// 129) -- pensada sobre todo para quien usa /overlay/clan-war/:id como
// fuente de navegador en OBS y necesita que la tarjeta encaje con el
// resto de su composición. Mismo patrón que EstructuraLineupPicker.tsx:
// cambiar_aspecto_lineup_cw() en la base ya valida que quien llama sea
// capitán/dueño de alguno de los dos equipos, esto de acá es solo el
// selector.
export default function AspectoLineupPicker({ clanWarId, aspecto, onCambio }: AspectoLineupPickerProps) {
  const handleElegir = async (nuevo: AspectoLineup) => {
    if (nuevo === aspecto) return;
    const { error } = await supabase.rpc("cambiar_aspecto_lineup_cw", {
      p_clan_war_id: clanWarId,
      p_aspecto: nuevo,
    });
    if (!error) onCambio();
  };

  return (
    <div className="bracket-picker-group">
      <div className="bracket-picker-options estructura-picker-options">
        {ASPECTO_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`bracket-picker-option estructura-picker-option ${aspecto === o.value ? "selected" : ""}`}
            onClick={() => handleElegir(o.value)}
          >
            <div
              className="estructura-picker-preview aspecto-picker-preview"
              style={{ aspectRatio: o.value.replace(":", " / ") }}
              aria-hidden="true"
            />
            <span className="bracket-picker-option-label">{o.label}</span>
            <span className="estructura-picker-desc">{o.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
