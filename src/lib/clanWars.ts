// Ayudas de fecha/hora para Clan Wars (migración 021). Todo se guarda
// como un instante absoluto (timestamptz) -- ver la explicación larga
// en la migración -- así que "convertir a CET" y "convertir a la hora
// local de cada quien" son siempre una conversión de huso horario
// normal, correcta durante todo el año (CET/CEST según corresponda).
const ZONA_CET = "Europe/Berlin";

// El organizador ingresa la fecha/hora en un <input type="datetime-local">,
// que no lleva huso horario -- el constructor Date interpreta ese texto
// como hora LOCAL del navegador, que es exactamente lo que se pide: la
// propia hora local de quien propone el reto.
export function datetimeLocalAIso(valor: string): string {
  return new Date(valor).toISOString();
}

export function formatearHoraCet(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    timeZone: ZONA_CET,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

// Sin "timeZone" explícito: Intl usa el huso horario del navegador de
// quien está mirando la pantalla en ese momento.
export function formatearHoraLocal(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

// Fase 2 (migración 022): la ventana de check-in se abre 15 minutos
// antes de la hora del reto. Se calcula acá, comparando con la hora
// actual -- no depende de ningún proceso en segundo plano, y
// confirmar_alineacion() en la base hace exactamente esta misma
// cuenta antes de aceptar una confirmación.
const VENTANA_CHECK_IN_MS = 15 * 60 * 1000;

export function dentroDeVentanaCheckIn(fechaHoraCetIso: string, ahoraMs: number = Date.now()): boolean {
  return ahoraMs >= new Date(fechaHoraCetIso).getTime() - VENTANA_CHECK_IN_MS;
}
