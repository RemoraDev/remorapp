// Espejo de calcular_nivel() en la base (migración 020): nivel 1 =
// 1000 MMR, nivel 100 = 4961 MMR o más, interpolación lineal.
//
// OJO: esa escala se calibró para MMR de JUGADOR (mmr_1v1/liga_1v1,
// que arrancan en 1000). Para un equipo (que arranca en 1441, Bronce
// 1) no existe un "nivel de clan" real todavía -- se descartó a
// propósito en la migración 020 ("el de equipos lo definimos en otra
// fase"). La Sala de la Fama pide un nivel 1-100 también para
// equipos, así que esta misma fórmula se reusa como aproximación
// visual nada más -- no es un sistema de nivel de clan de verdad.
export function calcularNivelLineal(mmr: number): number {
  return Math.max(1, Math.min(100, Math.round(1 + ((mmr - 1000) / (4961 - 1000)) * 99)));
}
