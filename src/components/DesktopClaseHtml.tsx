import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";

// Antes renderizaba una franja propia con el logo "RemorApp" justo
// debajo de la barra de título nativa de Windows -- se sacó (quedaba
// redundante: la barra nativa ya muestra "RemorApp" como título de la
// ventana, y el header de la app también lleva el logo, así que el
// nombre terminaba repetido 3 veces seguidas). Lo único que sigue
// haciendo falta de acá es agregar la clase "es-escritorio" al <html>
// -- de eso dependen el resto de los ajustes de escritorio (padding de
// <main>, scroll fino, layout de 3 columnas, etc.), y solo se agrega
// cuando la app corre dentro de Tauri. No renderiza nada.
export default function DesktopClaseHtml() {
  useEffect(() => {
    if (isTauri()) {
      document.documentElement.classList.add("es-escritorio");
    }
  }, []);

  return null;
}
