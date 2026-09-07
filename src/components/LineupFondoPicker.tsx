import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { FONDO_LINEUP_OPTIONS } from "../types/teams";
import type { FondoLineup } from "../types/teams";
import type { FondoLineupImagen } from "../types/clanWars";

interface LineupFondoPickerProps {
  clanWarId: string;
  fondo: FondoLineup;
  fondoImagenId: string | null;
  onCambio: () => void;
}

// Selector de fondo para la sala de lineup de una Clan War -- catálogo
// clásico (migración 051, en CSS) más el catálogo de imágenes subidas
// por el dueño/admin desde /admin (migración 067). Ambos son
// mutuamente excluyentes: elegir uno de un catálogo limpia la
// selección del otro (lo resuelve cambiar_fondo_lineup_cw()/
// cambiar_fondo_lineup_imagen_cw() en la base).
export default function LineupFondoPicker({ clanWarId, fondo, fondoImagenId, onCambio }: LineupFondoPickerProps) {
  const [fondosImagen, setFondosImagen] = useState<FondoLineupImagen[]>([]);

  useEffect(() => {
    supabase
      .from("catalogo_fondos_lineup")
      .select("id, nombre, image_url, created_at")
      .order("nombre")
      .then(({ data }) => setFondosImagen((data ?? []) as FondoLineupImagen[]));
  }, []);

  const handleCambiarFondoClasico = async (nuevoFondo: FondoLineup) => {
    if (nuevoFondo === fondo && !fondoImagenId) return;

    // cambiar_fondo_lineup_cw() (en la base) es la que de verdad
    // chequea que seas dueño o capitán y que la Clan War siga
    // aceptada/en curso -- esto de acá es solo el selector.
    const { error } = await supabase.rpc("cambiar_fondo_lineup_cw", {
      p_clan_war_id: clanWarId,
      p_fondo: nuevoFondo,
    });
    if (!error) onCambio();
  };

  const handleElegirFondoImagen = async (imagenId: string) => {
    if (imagenId === fondoImagenId) return;

    const { error } = await supabase.rpc("cambiar_fondo_lineup_imagen_cw", {
      p_clan_war_id: clanWarId,
      p_imagen_id: imagenId,
    });
    if (!error) onCambio();
  };

  return (
    <div className="bracket-picker-group">
      <h5 className="detail-subtitle">Fondo de la sala de lineup</h5>

      {fondosImagen.length > 0 && (
        <div className="bracket-picker-options">
          {fondosImagen.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`bracket-picker-option ${fondoImagenId === f.id ? "selected" : ""}`}
              onClick={() => handleElegirFondoImagen(f.id)}
            >
              <div
                className="lineup-fondo-preview-imagen"
                style={{ backgroundImage: `url(${f.image_url})` }}
              />
              <span className="bracket-picker-option-label">{f.nombre}</span>
            </button>
          ))}
        </div>
      )}

      <p className="form-hint">Fondos clásicos</p>
      <div className="bracket-picker-options">
        {FONDO_LINEUP_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`bracket-picker-option ${!fondoImagenId && fondo === o.value ? "selected" : ""}`}
            onClick={() => handleCambiarFondoClasico(o.value)}
          >
            <div className="lineup-fondo-preview" data-fondo-lineup={o.value} />
            <span className="bracket-picker-option-label">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
