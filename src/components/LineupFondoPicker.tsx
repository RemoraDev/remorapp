import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { FONDO_LINEUP_OPTIONS } from "../types/teams";
import type { FondoLineup } from "../types/teams";
import type { FondoLineupImagen } from "../types/clanWars";

interface LineupFondoPickerProps {
  fondo: FondoLineup;
  fondoImagenId: string | null;
  onElegirClasico: (fondo: FondoLineup) => void | Promise<void>;
  onElegirImagen: (imagenId: string) => void | Promise<void>;
}

// Selector de fondo -- catálogo clásico (migración 051, en CSS) más el
// catálogo de imágenes subidas por el dueño/admin desde /admin
// (migración 067). Ambos son mutuamente excluyentes: elegir uno de un
// catálogo limpia la selección del otro. Compartido entre la sala de
// lineup de Clan War y "Look" de Guerra de Razas (migración 161) --
// quién guarda el cambio (y con qué RPC/columna) lo decide quien lo
// use, acá solo está el selector.
export default function LineupFondoPicker({
  fondo,
  fondoImagenId,
  onElegirClasico,
  onElegirImagen,
}: LineupFondoPickerProps) {
  const [fondosImagen, setFondosImagen] = useState<FondoLineupImagen[]>([]);

  useEffect(() => {
    supabase
      .from("catalogo_fondos_lineup")
      .select("id, nombre, image_url, created_at")
      .order("nombre")
      .then(({ data }) => setFondosImagen((data ?? []) as FondoLineupImagen[]));
  }, []);

  const handleCambiarFondoClasico = (nuevoFondo: FondoLineup) => {
    if (nuevoFondo === fondo && !fondoImagenId) return;
    onElegirClasico(nuevoFondo);
  };

  const handleElegirFondoImagen = (imagenId: string) => {
    if (imagenId === fondoImagenId) return;
    onElegirImagen(imagenId);
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
