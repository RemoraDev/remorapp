import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";
import { isTauri } from "@tauri-apps/api/core";

// Diagnóstico real detrás de "el fix de layout no tuvo efecto": el
// service worker (vite.config.ts, registerType: "autoUpdate") precachea
// TODO el bundle con estrategia cache-first -- activa la versión nueva
// solo en segundo plano (skipWaiting + clientsClaim), pero nunca
// recarga sola la pestaña ya abierta, así que un cambio de código
// puede quedar invisible para quien ya tenía la app abierta hasta que
// recargue a mano dos veces. Mismo mecanismo que el caché de WebView2
// que ya se encontró en la versión de escritorio. Se resuelve con el
// mismo patrón de ActualizacionDesktop.tsx: un aviso con confirmación,
// nunca una recarga sorpresiva en medio de lo que se esté haciendo.
export default function ActualizacionWeb() {
  const yaAvisado = useRef(false);

  useEffect(() => {
    // La versión de escritorio (Tauri) no usa este service worker --
    // ActualizacionDesktop.tsx ya cubre su propio mecanismo de
    // actualización, distinto.
    if (isTauri() || !("serviceWorker" in navigator)) return;

    const actualizarSW = registerSW({
      onNeedRefresh() {
        if (yaAvisado.current) return;
        yaAvisado.current = true;
        toast("Hay una versión nueva de RemorApp disponible.", {
          duration: Infinity,
          action: {
            label: "Actualizar",
            onClick: () => actualizarSW(true),
          },
        });
      },
    });
  }, []);

  return null;
}
