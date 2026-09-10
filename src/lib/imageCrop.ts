import type { Area } from "react-easy-crop";

// Genera el Blob final a partir del archivo original y el área de
// recorte en píxeles que entrega react-easy-crop (onCropComplete) --
// reemplaza el recorte automático centrado que existía antes (ver
// RecortadorImagenModal.tsx), esta vez con el encuadre elegido por el
// usuario en el recortador interactivo. Mantiene PNG con transparencia
// y exporta cualquier otro formato como JPEG, igual que antes.
export function recortarImagenDesdeArea(archivo: File, area: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);

    img.onload = () => {
      const ancho = Math.round(area.width);
      const alto = Math.round(area.height);

      const canvas = document.createElement("canvas");
      canvas.width = ancho;
      canvas.height = alto;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo procesar la imagen."));
        return;
      }

      ctx.drawImage(img, Math.round(area.x), Math.round(area.y), ancho, alto, 0, 0, ancho, alto);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("No se pudo procesar la imagen."));
        },
        archivo.type === "image/png" ? "image/png" : "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };

    img.src = url;
  });
}
