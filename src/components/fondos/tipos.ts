import type * as THREE from "three";

// Contrato que cumple cada escena de fondo. Vivía dentro de
// FondoWebgpu.tsx; se sacó acá cuando las escenas empezaron a ser
// archivos propios (migración 218, fondos de paisaje procedurales).
export type Updater = (t: number) => void;

export interface ResultadoEscena {
  updater: Updater;
  // Se llama después de redimensionar() -- deja que la escena
  // recalcule tamaños que dependen del aspecto real de la cámara
  // (pantalla normal vs. pantalla completa, cambios de tamaño de
  // ventana, etc.), en vez de quedar fijos al tamaño que tenía el
  // contenedor cuando se armó la escena.
  alRedimensionar?: (camera: THREE.PerspectiveCamera) => void;
}

// Una escena recibe la Scene vacía y devuelve con qué animarla.
export type ConstructorEscena = (scene: THREE.Scene) => Promise<ResultadoEscena>;
