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

// Plazo de edición del lineup (migración 066): distinto de la ventana
// de check-in de arriba -- este es el plazo para seguir agregando o
// quitando jugadores del propio lineup (armar_lineup_cw), por default
// 30 minutos antes de la hora del reto, o hasta la fecha extendida si
// el rival (o el dueño) aprobó una extensión. plazo_edicion_lineup_cw()
// en la base hace exactamente esta misma cuenta antes de aceptar un
// cambio de lineup.
//
// Migración 089: la cantidad de minutos ya no es fija -- si la Clan
// War salió del fixture de un torneo, sale de
// tournaments.ventana_revelacion_minutos (torneo.ventanaRevelacionMinutos
// en el frontend); si no hay torneo detrás (reto propuesto a mano),
// se sigue usando este mismo default de 30.
export const VENTANA_REVELACION_MINUTOS_DEFAULT = 30;

// Migración 093: catálogo de "Bo" (mejor de N mapas) para cada set del
// lineup -- reemplaza el viejo selector de formato (1v1/2v2/3v3/4v4 vs
// WTL) de Clan War Amistosa y "Retar a otro clan": ahora cualquier
// reto directo usa siempre el mismo sistema de lineup (jugadores_por_set
// titulares por lado, cada uno jugando su propio set 1v1 contra la
// posición equivalente del rival), y este catálogo define cuántos
// mapas como máximo tiene cada uno de esos sets. reportar_mapa_wtl()
// en la base cierra el set apenas alguien alcanza la mayoría real de
// este número (Bo2 es la única excepción: al no haber mayoría posible
// antes de agotar los 2 mapas, puede terminar empatado 1-1).
export const BO_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Bo1 -- un solo mapa" },
  { value: 2, label: "Bo2 -- hasta 2 mapas, puede terminar empatado 1-1" },
  { value: 3, label: "Bo3 -- hasta 3 mapas, se cierra apenas alguien gana 2" },
  { value: 5, label: "Bo5 -- hasta 5 mapas, se cierra apenas alguien gana 3" },
];

export function plazoEdicionLineup(
  fechaHoraCetIso: string,
  plazoExtendidoHastaIso: string | null,
  ventanaRevelacionMinutos: number = VENTANA_REVELACION_MINUTOS_DEFAULT
): Date {
  if (plazoExtendidoHastaIso) return new Date(plazoExtendidoHastaIso);
  return new Date(new Date(fechaHoraCetIso).getTime() - ventanaRevelacionMinutos * 60 * 1000);
}

export function vencioPlazoEdicionLineup(
  fechaHoraCetIso: string,
  plazoExtendidoHastaIso: string | null,
  ahoraMs: number = Date.now(),
  ventanaRevelacionMinutos: number = VENTANA_REVELACION_MINUTOS_DEFAULT
): boolean {
  return ahoraMs >= plazoEdicionLineup(fechaHoraCetIso, plazoExtendidoHastaIso, ventanaRevelacionMinutos).getTime();
}
