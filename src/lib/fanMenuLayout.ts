// Geometría del abanico del botón central. Separado de FanMenu.tsx para
// poder probarlo/ajustarlo sin tocar el componente.

// Ángulos de cada opción, medidos desde arriba (0° = derecho hacia
// arriba), de izquierda a derecha. Deben coincidir en cantidad y orden
// con FAN_ITEMS en FanMenu.tsx.
//
// -75/75 para las puntas y -20/20 para el medio: no son parejos a
// propósito. Con ángulos parejos (ej. -66/-22/22/66) la pareja del
// medio queda con muchísimo más espacio del necesario mientras las
// parejas diagonales casi se tocan (es la separación entre puntos de
// un círculo, no entre las cajas cuadradas reales de cada hexágono).
// Estos valores salieron de una búsqueda numérica sobre el peor caso
// (pantalla de 320px) que maximiza la separación mínima entre
// cualquier par de hexágonos sin superar 75° (pasado eso, el abanico
// deja de leerse como arco y empieza a verse como una fila).
export const FAN_ANGULOS_GRADOS = [-75, -20, 20, 75];

const RADIO_IDEAL_PX = 150;
const HEX_SIZE_PX = 68;
const MARGEN_BORDE_PX = 12;
const RADIO_MINIMO_PX = 85;

export interface PosicionAbanico {
  x: number;
  y: number;
}

// Radio máximo que cabe en el ancho disponible sin que la opción más
// abierta (66°) se salga de la pantalla, dejando MARGEN_BORDE_PX de
// aire contra el borde. Nunca supera RADIO_IDEAL_PX (no hace falta más
// separación que esa en pantallas anchas) ni baja de RADIO_MINIMO_PX
// (para no dejar los hexágonos amontonados en el centro).
export function calcularRadioSeguro(anchoDisponible: number): number {
  const senoMax = Math.sin((Math.max(...FAN_ANGULOS_GRADOS.map(Math.abs)) * Math.PI) / 180);
  const mitadHex = HEX_SIZE_PX / 2;
  const radioMax = (anchoDisponible / 2 - MARGEN_BORDE_PX - mitadHex) / senoMax;
  return Math.min(RADIO_IDEAL_PX, Math.max(RADIO_MINIMO_PX, radioMax));
}

// Posición (x, y) en px de cada opción, relativa al botón central.
export function calcularPosiciones(radio: number): PosicionAbanico[] {
  return FAN_ANGULOS_GRADOS.map((grados) => {
    const rad = (grados * Math.PI) / 180;
    return { x: radio * Math.sin(rad), y: -radio * Math.cos(rad) };
  });
}

export const FAN_HEX_SIZE_PX = HEX_SIZE_PX;
