// Tabla de ligas oficiales de StarCraft II -- espejo exacto, en el
// frontend, de calcular_liga() en la base (supabase/schema_tournaments.sql,
// migración 020). Se duplica a propósito: la barra de progreso de MMR
// se calcula enteramente en el cliente (no hace falta ni una consulta
// ni una migración nueva para esto), así que necesita conocer los
// mismos rangos. Si algún día cambia la tabla de ligas, hay que
// actualizar los dos lugares.
export interface RangoLiga {
  nombre: string;
  minimo: number;
  // null = liga sin techo (Gran Maestro).
  maximo: number | null;
}

export const RANGOS_LIGA: RangoLiga[] = [
  { nombre: "Bronce 3", minimo: 1000, maximo: 1200 },
  { nombre: "Bronce 2", minimo: 1201, maximo: 1440 },
  { nombre: "Bronce 1", minimo: 1441, maximo: 1680 },
  { nombre: "Plata 3", minimo: 1681, maximo: 1880 },
  { nombre: "Plata 2", minimo: 1881, maximo: 2080 },
  { nombre: "Plata 1", minimo: 2081, maximo: 2280 },
  { nombre: "Oro 3", minimo: 2281, maximo: 2427 },
  { nombre: "Oro 2", minimo: 2428, maximo: 2573 },
  { nombre: "Oro 1", minimo: 2574, maximo: 2720 },
  { nombre: "Platino 3", minimo: 2721, maximo: 2853 },
  { nombre: "Platino 2", minimo: 2854, maximo: 2987 },
  { nombre: "Platino 1", minimo: 2988, maximo: 3120 },
  { nombre: "Diamante 3", minimo: 3121, maximo: 3493 },
  { nombre: "Diamante 2", minimo: 3494, maximo: 3867 },
  { nombre: "Diamante 1", minimo: 3868, maximo: 4240 },
  { nombre: "Maestro 3", minimo: 4241, maximo: 4480 },
  { nombre: "Maestro 2", minimo: 4481, maximo: 4720 },
  { nombre: "Maestro 1", minimo: 4721, maximo: 4960 },
  { nombre: "Gran Maestro", minimo: 4961, maximo: null },
];

export interface ProgresoLiga {
  // 0-100, qué tan lleno está el tramo actual.
  porcentaje: number;
  // Techo del tramo actual (nunca null acá -- Gran Maestro se maneja
  // aparte en el componente, no llega a necesitar esto).
  maximo: number;
  // Cuánto MMR falta para llegar al techo del tramo actual.
  faltante: number;
  // Nombre de la siguiente liga, o null si ya es la última definida
  // (no debería pasar en la práctica: Gran Maestro no tiene techo y
  // se filtra antes de llegar acá).
  siguienteLiga: string | null;
}

// p_liga tiene que ser uno de los nombres de RANGOS_LIGA (viene de
// liga_1v1 / liga_equipos / teams.liga, calculados en la base con la
// misma tabla) -- si por algún motivo no matchea ninguno, se cae al
// primer tramo en vez de romper la barra.
export function calcularProgresoLiga(mmr: number, liga: string): ProgresoLiga {
  const indice = RANGOS_LIGA.findIndex((r) => r.nombre === liga);
  const rango = indice >= 0 ? RANGOS_LIGA[indice] : RANGOS_LIGA[0];
  const siguiente = indice >= 0 ? RANGOS_LIGA[indice + 1] : undefined;
  const maximo = rango.maximo ?? mmr;

  const porcentaje =
    maximo > rango.minimo
      ? Math.max(0, Math.min(100, ((mmr - rango.minimo) / (maximo - rango.minimo)) * 100))
      : 100;

  return {
    porcentaje,
    maximo,
    faltante: Math.max(0, maximo - mmr),
    siguienteLiga: siguiente ? siguiente.nombre : null,
  };
}
