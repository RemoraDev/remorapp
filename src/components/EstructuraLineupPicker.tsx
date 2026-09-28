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
  { value: "enfrentamientos", label: "Enfrentamientos", desc: "Un duelo 1 vs 1 por tarjeta, en fila" },
  { value: "poster", label: "Póster", desc: "Split vertical estilo cartel de versus, VS al centro" },
];

// Cada maqueta dibuja su propio mini-diagrama abstracto -- ya no
// alcanza con los mismos 3 <span/> genéricos de antes (migración 127)
// ahora que "enfrentamientos" necesita varias filas en vez de una sola
// franja partida.
function PreviewDiagrama({ variante }: { variante: EstructuraLineup }) {
  if (variante === "enfrentamientos") {
    return (
      <>
        <div className="estructura-picker-duelo">
          <span />
          <span />
        </div>
        <div className="estructura-picker-duelo">
          <span />
          <span />
        </div>
        <div className="estructura-picker-duelo">
          <span />
          <span />
        </div>
      </>
    );
  }
  if (variante === "poster") {
    return (
      <>
        <span />
        <span className="estructura-picker-poster-vs" />
        <span />
      </>
    );
  }
  return (
    <>
      <span />
      <span />
      <span />
    </>
  );
}

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
              <PreviewDiagrama variante={o.value} />
            </div>
            <span className="bracket-picker-option-label">{o.label}</span>
            <span className="estructura-picker-desc">{o.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
