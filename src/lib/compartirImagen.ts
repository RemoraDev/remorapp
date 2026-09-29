import { toBlob } from "html-to-image";
import { toast } from "sonner";

// Helper compartido para "Compartir imagen" -- usado en el marcador y
// las pestañas de Race War, y en la tarjeta de lineup de Clan War.
// Captura un nodo del DOM tal cual está en pantalla (con
// html-to-image) y lo comparte: en celular, vía el selector nativo
// (Web Share API, con la imagen ya adjunta -- ahí se elige WhatsApp
// como cualquier otra app instalada). Donde ese selector no soporta
// compartir archivos (PC/escritorio, donde WhatsApp Web/Desktop no
// tiene forma de recibir una imagen desde un link), se descarga la
// imagen y se abre WhatsApp Web con un mensaje ya escrito, para que el
// usuario la adjunte a mano.
//
// Importante: el nodo capturado NUNCA debe estar oculto con
// "position: fixed" + un corrimiento negativo -- html-to-image clona
// el nodo con sus propios estilos calculados, así que ese mismo
// corrimiento se copia adentro del SVG intermedio que arma la
// librería y el contenido termina renderizado fuera del área
// capturable (imagen en blanco). Si el nodo no se muestra en pantalla,
// ocultarlo recortando un CONTENEDOR de afuera (tamaño 0 +
// overflow:hidden), nunca la tarjeta misma.
async function capturarBlob(nodo: HTMLElement, pixelRatio: number, backgroundColor?: string): Promise<Blob | null> {
  return toBlob(nodo, { cacheBust: true, pixelRatio, backgroundColor });
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

export async function descargarImagenDeNodo(
  nodo: HTMLElement,
  nombreArchivo: string,
  opciones?: { pixelRatio?: number; backgroundColor?: string }
): Promise<void> {
  try {
    const blob = await capturarBlob(nodo, opciones?.pixelRatio ?? 2, opciones?.backgroundColor);
    if (!blob) {
      toast.error("No se pudo generar la imagen.");
      return;
    }
    descargarBlob(blob, nombreArchivo);
  } catch {
    toast.error("No se pudo generar la imagen.");
  }
}

export async function compartirImagenDeNodo(
  nodo: HTMLElement,
  nombreArchivo: string,
  texto: string,
  opciones?: { pixelRatio?: number; backgroundColor?: string }
): Promise<void> {
  try {
    const blob = await capturarBlob(nodo, opciones?.pixelRatio ?? 2, opciones?.backgroundColor);
    if (!blob) {
      toast.error("No se pudo generar la imagen.");
      return;
    }

    const archivo = new File([blob], nombreArchivo, { type: "image/png" });

    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: texto, text: texto });
      return;
    }

    descargarBlob(blob, nombreArchivo);
    toast.success("Se descargó la imagen -- adjuntala en el mensaje que se abrió abajo.");
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  } catch (err) {
    // AbortError: el usuario cerró el selector nativo de compartir sin
    // elegir nada -- no es un error real, no hace falta avisar.
    if (err instanceof Error && err.name !== "AbortError") {
      toast.error("No se pudo compartir la imagen.");
    }
  }
}

export function nombreArchivoDesde(texto: string): string {
  return texto.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() + ".png";
}
