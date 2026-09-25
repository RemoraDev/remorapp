import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { revisarActualizacionDesktop } from "../lib/tauriUpdater";

// Cada cuánto se revisa sola, además de al abrir la app -- 4 horas es
// frecuente sin ser molesto (no hace falta más que eso para algo que
// no es crítico de seguridad).
const INTERVALO_REVISION_MS = 4 * 60 * 60 * 1000;

// Autoactualización de la versión de escritorio: no hace nada en la
// versión web (revisarActualizacionDesktop() resuelve "no disponible"
// de inmediato ahí). Con confirmación, no silenciosa -- instalar
// obliga a reiniciar la app, así que se le avisa al usuario con un
// toast y se espera a que él decida cuándo. Montado una única vez en
// App.tsx, no renderiza nada visible por sí solo.
export default function ActualizacionDesktop() {
  const yaAvisado = useRef(false);

  useEffect(() => {
    let cancelado = false;

    const revisar = async () => {
      if (yaAvisado.current) return;
      const resultado = await revisarActualizacionDesktop().catch(() => null);
      if (cancelado || !resultado?.disponible || !resultado.aplicar) return;

      yaAvisado.current = true;
      const aplicar = resultado.aplicar;

      const idToast = toast(`Hay una versión nueva de RemorApp disponible (${resultado.version}).`, {
        duration: Infinity,
        action: {
          label: "Actualizar y reiniciar",
          onClick: async () => {
            toast.loading("Descargando la actualización...", { id: idToast });
            try {
              await aplicar();
            } catch (err) {
              toast.error(
                "No se pudo instalar la actualización: " + (err instanceof Error ? err.message : String(err)),
                { id: idToast }
              );
              yaAvisado.current = false;
            }
          },
        },
      });
    };

    revisar();
    const intervalo = setInterval(revisar, INTERVALO_REVISION_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  return null;
}
