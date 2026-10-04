import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Pencil } from "lucide-react";
import HexPattern from "./HexPattern";
import { useAuth } from "../context/AuthContext";
import { useOverlayPanel } from "../hooks/useOverlayPanel";

// Columna izquierda del layout de 3 columnas de escritorio (Tauri) --
// decorativa (panal de hexágonos, mismo HexPattern.tsx que usaba el
// Hero de Inicio antes de que se reemplazara por el carrusel), ver
// App.tsx y halcon.css (".escritorio-cuerpo"). Nunca se monta en la
// web normal ni en celular: isTauri() se revisa en un useEffect (no
// directo en el render), mismo patrón que DesktopClaseHtml.tsx.
// Migración 156: si el usuario subió su propia franja lateral
// (profiles.escritorio_lateral_url -- directo o copiada de su clan,
// ver ProfilePage.tsx), esa imagen reemplaza el panal de hexágonos
// acá, "como un papel tapiz lateral". Sin esa imagen, sigue viéndose
// el panal de siempre. Migración 158: lápiz propio acá mismo (antes
// solo se llegaba desde Configurar Apariencia, nada lo indicaba acá) --
// abre Mi perfil como overlay, directo en esa sección.
export default function EscritorioColumnaLateral() {
  const [esEscritorio, setEsEscritorio] = useState(false);
  const { user, profile } = useAuth();
  const { abrirOverlay } = useOverlayPanel();

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  if (!esEscritorio) return null;

  const imagenPropia = profile?.escritorio_lateral_url ?? null;

  return (
    <div
      className="escritorio-columna-lateral escritorio-columna-izquierda"
      style={imagenPropia ? { backgroundImage: `url(${imagenPropia})` } : undefined}
    >
      <div className="escritorio-columna-glow" aria-hidden="true" />
      {!imagenPropia && <HexPattern id="escritorio-hex-izq" className="hex-pattern escritorio-columna-hex" />}
      {user && (
        <button
          type="button"
          className="escritorio-columna-lateral-edit-btn"
          onClick={() => abrirOverlay("/perfil?tab=franja-lateral")}
          aria-label="Cambiar la franja lateral de escritorio"
          title="Cambiar la franja lateral de escritorio"
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}
