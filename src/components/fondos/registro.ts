import { crearEscenaBosqueElfico } from "./bosqueElfico";
import { crearEscenaTormenta } from "./tormenta";
import { crearEscenaNavidad } from "./navidad";
import { crearEscenaHalloween } from "./halloween";
import { crearEscenaNoMuertos } from "./noMuertos";
import { crearEscenaOrcos } from "./orcos";
import { crearEscenaHumanos } from "./humanos";
import type { ConstructorEscena } from "./tipos";

// Registro de las escenas procedurales (las que se dibujan por código,
// a diferencia de las que son una foto con efectos encima).
//
// Existe para que el horneador no lleve su propia lista: ya pasó una vez
// que una lista hardcodeada quedó desincronizada del tipo y el fondo
// nuevo no se mostraba nunca. Agregar una escena acá alcanza para que
// entre al horneado.
export interface EscenaProcedural {
  /** Mismo valor que en FondoBracketWebgpu: es el nombre del AVIF que se hornea. */
  id: string;
  etiqueta: string;
  construir: ConstructorEscena;
  /**
   * Segundo del reloj de la escena en el que conviene capturarla. No es
   * capricho: en t=0 el viento está en reposo y las nubes sin formar, y
   * la miniatura sale más pobre de lo que la escena realmente se ve.
   */
  segundoCaptura: number;
}

export const ESCENAS_PROCEDURALES: EscenaProcedural[] = [
  {
    id: "bosque_elfico",
    etiqueta: "Bosque élfico",
    construir: crearEscenaBosqueElfico,
    segundoCaptura: 14,
  },
  {
    id: "tormenta",
    etiqueta: "Tormenta",
    construir: crearEscenaTormenta,
    // Justo sobre un relampago: la miniatura tiene que mostrar lo que
    // hace especial a la escena, no un cielo gris cualquiera.
    segundoCaptura: 12.6,
  },
  {
    id: "navidad",
    etiqueta: "Noche de nieve",
    construir: crearEscenaNavidad,
    segundoCaptura: 18,
  },
  {
    id: "halloween",
    etiqueta: "Noche de brujas",
    construir: crearEscenaHalloween,
    segundoCaptura: 16,
  },
  {
    id: "no_muertos",
    etiqueta: "Tierras malditas",
    construir: crearEscenaNoMuertos,
    segundoCaptura: 20,
  },
  {
    id: "orcos",
    etiqueta: "Durotar",
    construir: crearEscenaOrcos,
    segundoCaptura: 15,
  },
  {
    id: "humanos",
    etiqueta: "Lordaeron",
    construir: crearEscenaHumanos,
    segundoCaptura: 17,
  },
];

export function escenaProceduralPorId(id: string): EscenaProcedural | undefined {
  return ESCENAS_PROCEDURALES.find((e) => e.id === id);
}
