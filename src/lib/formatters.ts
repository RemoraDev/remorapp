// Formateadores compartidos para mostrar datos de torneos.
// Centralizados acá para que "Sin premio en efectivo" y el
// formato de fecha se vean siempre igual en tarjetas y detalle.

const formatoMoneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const formatoFecha = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatPozo(pozoPremio: number | null): string {
  // El pozo es opcional (torneos públicos o privados sin premio en
  // efectivo): nunca se muestra en blanco ni como $0.
  if (pozoPremio === null || pozoPremio === undefined) {
    return "Sin premio en efectivo";
  }
  return formatoMoneda.format(pozoPremio);
}

export function formatFecha(fechaIso: string): string {
  return formatoFecha.format(new Date(fechaIso));
}

export function formatCuposDisponibles(cuposTotales: number, cuposOcupados: number): string {
  const disponibles = cuposTotales - cuposOcupados;
  return disponibles === 1 ? "1 cupo disponible" : `${disponibles} cupos disponibles`;
}
