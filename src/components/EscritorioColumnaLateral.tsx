import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import HexPattern from "./HexPattern";
import { useAuth } from "../context/AuthContext";

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
// el panal de siempre.
export default function EscritorioColumnaLateral() {
  const [esEscritorio, setEsEscritorio] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  if (!esEscritorio) return null;

  const imagenPropia = profile?.escritorio_lateral_url ?? null;

  return (
    <div
      className="escritorio-columna-lateral escritorio-columna-izquierda"
      aria-hidden="true"
      style={imagenPropia ? { backgroundImage: `url(${imagenPropia})` } : undefined}
    >
      <div className="escritorio-columna-glow" />
      {!imagenPropia && <HexPattern id="escritorio-hex-izq" className="hex-pattern escritorio-columna-hex" />}
    </div>
  );
}
