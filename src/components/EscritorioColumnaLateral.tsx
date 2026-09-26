import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import Logo from "./Logo";

// Columna izquierda del layout de 3 columnas de escritorio (Tauri) --
// puramente decorativa (patrón de estrellas + isotipo de RemorApp),
// ver App.tsx y halcon.css (".escritorio-cuerpo"). Nunca se monta en
// la web normal ni en celular: isTauri() se revisa en un useEffect
// (no directo en el render), mismo patrón que DesktopTitleBar.tsx.
export default function EscritorioColumnaLateral() {
  const [esEscritorio, setEsEscritorio] = useState(false);

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  if (!esEscritorio) return null;

  return (
    <div className="escritorio-columna-lateral escritorio-columna-izquierda" aria-hidden="true">
      <Logo />
    </div>
  );
}
