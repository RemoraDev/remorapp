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
//
// Corrección: reporte de que con la app de escritorio simplemente
// abierta (sin estar siquiera en foco, por ejemplo en un segundo
// monitor mientras se juega en el principal) el PC se ponía lento y
// los juegos se relentizaban. Causa: hay bastantes animaciones CSS
// "infinite" en toda la app que nunca se apagan solas -- el anillo de
// marcos de prestigio del avatar (girar/destello/chispas) es la peor,
// porque el avatar del Header está SIEMPRE montado, en cualquier
// página. Un WebView2 sin foco no throttlea el renderizado solo por
// perder el foco (a diferencia de una pestaña de Chrome en segundo
// plano), así que esas animaciones seguían consumiendo GPU sin
// parar. Acá se agrega "es-escritorio-sin-foco" al <html> cuando la
// ventana pierde el foco (blur) -- halcon.css pausa con eso todas las
// animaciones CSS vía animation-play-state. Las animaciones SMIL de
// SVG (<animate>/<animateMotion>/<animateTransform>, como los efectos
// de clima de Guerra de Razas) no se pausan con CSS, así que se
// pausan/reanudan a mano acá mismo vía pauseAnimations()/
// unpauseAnimations() de cada <svg>.
export default function DesktopClaseHtml() {
  useEffect(() => {
    if (!isTauri()) return;
    document.documentElement.classList.add("es-escritorio");

    const pausarSvgs = (pausar: boolean) => {
      document.querySelectorAll("svg").forEach((svg) => {
        const el = svg as unknown as { pauseAnimations?: () => void; unpauseAnimations?: () => void };
        if (pausar) el.pauseAnimations?.();
        else el.unpauseAnimations?.();
      });
    };

    const alPerderFoco = () => {
      document.documentElement.classList.add("es-escritorio-sin-foco");
      pausarSvgs(true);
    };
    const alGanarFoco = () => {
      document.documentElement.classList.remove("es-escritorio-sin-foco");
      pausarSvgs(false);
    };

    if (!document.hasFocus()) alPerderFoco();
    window.addEventListener("blur", alPerderFoco);
    window.addEventListener("focus", alGanarFoco);
    return () => {
      window.removeEventListener("blur", alPerderFoco);
      window.removeEventListener("focus", alGanarFoco);
    };
  }, []);

  return null;
}
