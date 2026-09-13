import type { Area } from "react-easy-crop";

export interface RecorteImagen {
  blob: Blob;
  // true si algún píxel del recorte final quedó con alpha real (no
  // completamente opaco) -- solo se calcula para PNG/WebP, los únicos
  // formatos que el canvas puede exportar con canal alfa; un JPEG
  // nunca tiene transparencia, así que siempre da false.
  tieneTransparencia: boolean;
}

// Formatos que el canvas puede exportar preservando el canal alfa --
// cualquier otro (JPEG, y cualquier tipo desconocido) se exporta como
// JPEG, igual que siempre, porque nunca tuvo transparencia real que
// perder.
function formatoConservaAlpha(tipo: string): tipo is "image/png" | "image/webp" {
  return tipo === "image/png" || tipo === "image/webp";
}

// Genera el Blob final a partir del archivo original y el área de
// recorte en píxeles que entrega react-easy-crop (onCropComplete) --
// reemplaza el recorte automático centrado que existía antes (ver
// RecortadorImagenModal.tsx), esta vez con el encuadre elegido por el
// usuario en el recortador interactivo. Mantiene PNG y WebP (los dos
// formatos con canal alfa) en su propio formato, para no perder la
// transparencia real del archivo original -- cualquier otro formato
// (JPEG, etc.) se exporta como JPEG, igual que antes.
export function recortarImagenDesdeArea(archivo: File, area: Area): Promise<RecorteImagen> {
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

      const conservaAlpha = formatoConservaAlpha(archivo.type);

      // Se recorre el canal alfa de cada píxel ANTES de exportar --
      // toBlob() no informa si el resultado tiene transparencia real,
      // así que es la única forma de saberlo. Un umbral de 250 (en vez
      // de exigir 255 exacto) tolera un eventual redondeo sin generar
      // falsos positivos en una imagen que en la práctica es opaca.
      let tieneTransparencia = false;
      if (conservaAlpha) {
        const { data } = ctx.getImageData(0, 0, ancho, alto);
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 250) {
            tieneTransparencia = true;
            break;
          }
        }
      }

      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, tieneTransparencia });
          else reject(new Error("No se pudo procesar la imagen."));
        },
        conservaAlpha ? archivo.type : "image/jpeg",
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
