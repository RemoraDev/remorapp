import imageCompression from "browser-image-compression";

// Comprime cualquier imagen ANTES de subirla a Supabase Storage --
// reduce bastante el peso de una foto de celular (varios MB) sin
// pérdida de calidad notable a simple vista. imageCompression() solo
// acepta File, así que un Blob (el resultado habitual del recortador,
// ver imageCrop.ts) se envuelve primero, conservando su mismo tipo.
// Si algo sale mal (navegador sin soporte, imagen corrupta, etc.), se
// sube el archivo original sin comprimir en vez de bloquear la subida.
const OPCIONES_COMPRESION = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

export async function comprimirImagen(archivo: File | Blob, nombreSiEsBlob = "imagen"): Promise<File> {
  const file =
    archivo instanceof File ? archivo : new File([archivo], nombreSiEsBlob, { type: archivo.type });

  try {
    return await imageCompression(file, OPCIONES_COMPRESION);
  } catch {
    return file;
  }
}
