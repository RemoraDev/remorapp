// Chequeo de higiene del build. Corre DESPUÉS de vite build y falla
// con código 1 si encuentra algo que no debe salir publicado.
//
// Por qué existe: el motor de fondos se desarrolla contra una página de
// pruebas (scripts/motor/) que manda la medición de GPU a un colector
// HTTP local, porque dentro de Tauri/WebView2 no hay consola ni
// protocolo de depuración que leer. Ese colector es una herramienta de
// desarrollo y no tiene nada que hacer en la app de un streamer.
//
// Hoy no se cuela porque Vite empaqueta solo index.html, y además la
// llamada está detrás de import.meta.env.DEV. Pero las dos cosas son
// detalles que un cambio futuro puede romper en silencio. Esto lo
// convierte en un error de build en vez de un descubrimiento incómodo.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const DIST = "dist";

// Cada patrón es [expresión, por qué no puede estar].
const PROHIBIDO = [
  [/127\.0\.0\.1:9777/, "colector HTTP de depuración del motor de fondos"],
  [/localhost:9777/, "colector HTTP de depuración del motor de fondos"],
  [/__capturar/, "gancho de capturas del banco de pruebas"],
  [/scripts\/motor\//, "página de desarrollo del motor"],
  [/scripts\/hornear\//, "herramienta de horneado de fondos"],
];

// Solo tiene sentido mirar texto: una coincidencia dentro de un .avif
// sería casualidad de bytes, no código filtrado.
const TEXTO = /\.(js|mjs|cjs|css|html|json|webmanifest|map|svg)$/i;

async function archivos(dir) {
  const salida = [];
  for (const nombre of await readdir(dir)) {
    const ruta = join(dir, nombre);
    const info = await stat(ruta);
    if (info.isDirectory()) salida.push(...(await archivos(ruta)));
    else if (TEXTO.test(nombre)) salida.push(ruta);
  }
  return salida;
}

let fallas = 0;
let revisados = 0;

try {
  await stat(DIST);
} catch {
  console.error("No existe dist/. Correr vite build antes de este chequeo.");
  process.exit(1);
}

for (const ruta of await archivos(DIST)) {
  const contenido = await readFile(ruta, "utf8");
  revisados++;
  for (const [patron, motivo] of PROHIBIDO) {
    if (patron.test(contenido)) {
      console.error(`FALLA  ${ruta}\n       contiene ${patron} -- ${motivo}`);
      fallas++;
    }
  }
}

if (fallas > 0) {
  console.error(`\n${fallas} hallazgo(s) de depuración en el build. No publicar así.`);
  process.exit(1);
}
console.log(`dist/ limpio: ${revisados} archivo(s) de texto revisados, nada de depuración.`);
