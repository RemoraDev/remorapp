export type Formato = "1v1" | "2v2" | "Rey de la Colina";

export type Visibilidad = "publico" | "privado";

export interface Torneo {
  id: string;
  nombre: string;
  juego: string;
  formato: Formato;
  visibilidad: Visibilidad;
  cuposOcupados: number;
  cuposTotales: number;
  paises: string[];
  fechaInicio: string;
  pozo?: string;
}
