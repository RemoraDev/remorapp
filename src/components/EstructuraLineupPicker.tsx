import { supabase } from "../lib/supabaseClient";
import type { EstructuraLineup } from "../types/clanWars";

interface EstructuraLineupPickerProps {
  clanWarId: string;
  estructura: EstructuraLineup;
  onCambio: () => void;
}

const ESTRUCTURA_OPTIONS: { value: EstructuraLineup; label: string; desc: string }[] = [
  { value: "clasico", label: "Clásico", desc: "Equipos lado a lado, una fila por enfrentamiento" },
  { value: "cascada", label: "Cascada", desc: "Un equipo arriba, marcador grande al centro, el otro abajo" },
];

// Elige la maqueta de la tarjeta del lineup (migración 127) -- mismo
// patrón que LineupFondoPicker.tsx: cambiar_estructura_lineup_cw() en
// la base ya valida que quien llama sea capitán/dueño de alguno de los
// dos equipos, esto de acá es solo el selector.
export default function EstructuraLineupPicker({ clanWarId, estructura, onCambio }: EstructuraLineupPickerProps) {
  const handleElegir = async (nueva: EstructuraLineup) => {
    if (nueva === estructura) return;
    const { error } = await supabase.rpc("cambiar_estructura_lineup_cw", {
      p_clan_war_id: clanWarId,
      p_estructura: nueva,
    });
    if (!error) onCambio();
  };

  return (
    <div className="bracket-picker-group">
      <div className="bracket-picker-options estructura-picker-options">
        {ESTRUCTURA_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`bracket-picker-option estructura-picker-option ${estructura === o.value ? "selected" : ""}`}
            onClick={() => handleElegir(o.value)}
          >
            <div className={`estructura-picker-preview estructura-picker-preview-${o.value}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="bracket-picker-option-label">{o.label}</span>
            <span className="estructura-picker-desc">{o.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
