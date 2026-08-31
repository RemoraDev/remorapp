import type { Torneo } from "../types";

export const torneoDestacado: Torneo = {
  id: "t-destacado-1",
  nombre: "Copa RemorApp — Apertura",
  juego: "StarCraft II",
  formato: "1v1",
  visibilidad: "publico",
  cuposOcupados: 8,
  cuposTotales: 16,
  paises: ["Chile", "Perú", "Argentina"],
  fechaInicio: "14 de septiembre",
  pozo: "$50.000 CLP",
};

export const torneosActivos: Torneo[] = [
  {
    id: "t-1",
    nombre: "Liga Terran Rising",
    juego: "StarCraft II",
    formato: "1v1",
    visibilidad: "publico",
    cuposOcupados: 5,
    cuposTotales: 8,
    paises: ["Guatemala", "Bolivia"],
    fechaInicio: "20 de septiembre",
    pozo: "$25.000 CLP",
  },
  {
    id: "t-2",
    nombre: "Duelo de Titanes 2v2",
    juego: "StarCraft II",
    formato: "2v2",
    visibilidad: "privado",
    cuposOcupados: 3,
    cuposTotales: 4,
    paises: ["Puerto Rico"],
    fechaInicio: "5 de septiembre",
  },
  {
    id: "t-3",
    nombre: "Rey de la Colina — Novatos",
    juego: "StarCraft II",
    formato: "Rey de la Colina",
    visibilidad: "publico",
    cuposOcupados: 12,
    cuposTotales: 16,
    paises: ["Chile", "Argentina", "Bolivia"],
    fechaInicio: "28 de septiembre",
    pozo: "$15.000 CLP",
  },
];
