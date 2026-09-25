import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Autoactualización de la versión de escritorio (Tauri): revisa el
// manifiesto publicado en GitHub Releases (ver
// src-tauri/tauri.conf.json -> plugins.updater.endpoints) y, si hay
// una versión más nueva, la deja lista para descargar e instalar.
//
// A propósito NO es silenciosa/automática: se le avisa al usuario con
// un toast y recién descarga/instala cuando él confirma -- instalar
// una actualización obliga a reiniciar la app, algo que no debería
// pasar sin avisar mientras alguien está en medio de organizar un
// torneo o una transmisión.
//
// isTauri() evita que esto haga nada en la versión web (Vercel): el
// mismo código de React corre en los dos, así que esta función es la
// única puerta -- el resto de la app no necesita saber si está
// corriendo en el navegador o en la app de escritorio.
export async function revisarActualizacionDesktop(): Promise<{
  disponible: boolean;
  version?: string;
  notas?: string | null;
  aplicar?: () => Promise<void>;
}> {
  if (!isTauri()) return { disponible: false };

  const actualizacion = await check();
  if (!actualizacion?.available) return { disponible: false };

  return {
    disponible: true,
    version: actualizacion.version,
    notas: actualizacion.body,
    aplicar: async () => {
      await actualizacion.downloadAndInstall();
      await relaunch();
    },
  };
}
