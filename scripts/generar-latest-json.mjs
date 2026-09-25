// Arma el manifiesto latest.json que necesita el autoactualizador de
// Tauri (@tauri-apps/plugin-updater) -- "tauri build" genera el
// instalador y su firma (.sig) pero NO arma este archivo solo, hay que
// construirlo a mano después de cada build. Ver
// docs/publicar-version-escritorio.md para el paso a paso completo.
//
// Uso: node scripts/generar-latest-json.mjs
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
const version = pkg.version;

// Nombre estable con el que se sube el instalador a cada GitHub
// Release -- así el link de descarga en Inicio (InstalarRemorApp.tsx)
// nunca cambia entre versiones, y el updater siempre lo encuentra en
// la misma URL.
const NOMBRE_ESTABLE = "RemorApp-Setup.exe";
const URL_DESCARGA = `https://github.com/RemoraDev/remorapp/releases/latest/download/${NOMBRE_ESTABLE}`;

const rutaExeOriginal = join(
  RAIZ,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  `RemorApp_${version}_x64-setup.exe`
);
const rutaFirma = `${rutaExeOriginal}.sig`;

let firma;
try {
  firma = readFileSync(rutaFirma, "utf8").trim();
} catch {
  console.error(`No se encontró la firma esperada en:\n  ${rutaFirma}`);
  console.error("¿Corriste 'npm run tauri build' con TAURI_SIGNING_PRIVATE_KEY configurada antes de esto?");
  process.exit(1);
}

const manifiesto = {
  version,
  notes: `RemorApp ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: firma,
      url: URL_DESCARGA,
    },
  },
};

const rutaSalida = join(RAIZ, "src-tauri", "target", "release", "bundle", "latest.json");
writeFileSync(rutaSalida, JSON.stringify(manifiesto, null, 2));

console.log("latest.json generado en:", rutaSalida);
console.log("\nArchivos para subir a la GitHub Release:");
console.log(`  1. ${rutaExeOriginal}  -- renombrar a "${NOMBRE_ESTABLE}" antes de subir`);
console.log(`  2. ${rutaSalida}  -- subir tal cual, con ese mismo nombre "latest.json"`);
