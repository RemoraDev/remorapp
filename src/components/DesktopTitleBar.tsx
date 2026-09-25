import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

// Barra superior propia de la versión de escritorio (Tauri) -- no
// existe en la web normal, ver el "if (!isTauri())" de abajo.
//
// Decisión de diseño: se mantiene la barra de título NATIVA de Windows
// (minimizar/maximizar/cerrar del sistema operativo), en vez de
// sacarla (decorations: false) y reimplementar esos controles a mano.
// Una barra de título 100% propia -- estilo Discord/Slack -- se ve
// más "de una sola pieza", pero exige reconstruir también el
// arrastre de la ventana, el redimensionado desde los bordes, la
// sombra de la ventana y el soporte de "Snap" de Windows 11 -- ninguno
// de esos viene gratis al sacar la barra nativa, y son justo el tipo
// de detalle que se rompe fácil y se nota. Esta franja de acá abajo
// (fija, justo debajo de la barra nativa) es la forma de sumar
// identidad propia sin ese riesgo: la barra de Windows sigue
// resolviendo mover/cambiar de tamaño/minimizar tal como el usuario ya
// espera de cualquier programa de Windows.
export default function DesktopTitleBar() {
  // Se revisa isTauri() adentro de un useEffect (no directo en el
  // render) para agregar la clase "es-escritorio" al <html> de forma
  // controlada, después de montar.
  const [esEscritorio, setEsEscritorio] = useState(false);

  useEffect(() => {
    if (isTauri()) {
      setEsEscritorio(true);
      document.documentElement.classList.add("es-escritorio");
    }
  }, []);

  if (!esEscritorio) return null;

  return (
    <div className="app-titlebar-escritorio">
      <span className="app-titlebar-escritorio-logo">
        Remor<span className="app-titlebar-escritorio-accent">App</span>
      </span>
    </div>
  );
}
