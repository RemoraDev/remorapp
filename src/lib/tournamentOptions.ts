import type { TorneoFormato, TorneoModo } from "../types/tournaments";

// Compartido entre el formulario de creación y las páginas de
// listado/detalle, para no repetir las mismas etiquetas dos veces.
export const MODOS: { value: TorneoModo; label: string; descripcion: string }[] = [
  {
    value: "eliminacion_simple",
    label: "Eliminación simple",
    descripcion: "Quien pierde una partida queda eliminado del torneo.",
  },
  {
    value: "eliminacion_doble",
    label: "Eliminación doble",
    descripcion:
      "Cada participante puede perder una vez sin quedar eliminado: pasa a la llave de perdedores antes de quedar fuera. El campeón de ganadores (invicto) y el de perdedores juegan la gran final; si gana el de perdedores, hay una revancha para desempatar. Necesita exactamente 4, 8, 16 o 32 confirmados -- no admite bye.",
  },
  {
    value: "todos_contra_todos",
    label: "Todos contra todos",
    descripcion: "Cada participante juega contra todos los demás una vez; gana quien sume más puntos.",
  },
  {
    value: "rey_de_la_colina",
    label: "Rey de la Colina",
    descripcion:
      "Un jugador defiende el trono partida a partida contra retadores; se acumulan puntos por cada victoria. Todavía no tiene motor propio -- por ahora no vas a poder iniciar un torneo en este modo.",
  },
  {
    value: "suizo",
    label: "Suizo",
    descripcion:
      "Sin eliminación: cada ronda empareja a quienes llevan puntaje parecido, sin repetir un cruce ya jugado. Gana quien termine primero en la tabla.",
  },
  {
    value: "tabla_posiciones",
    label: "Tabla de posiciones",
    descripcion:
      "Sin cuadro ni emparejamientos automáticos: el organizador carga el puntaje de cada inscrito con el criterio que prefiera, y se ordenan solos.",
  },
];

export function getModoLabel(modo: TorneoModo): string {
  return MODOS.find((m) => m.value === modo)?.label ?? modo;
}

export function getModoDescripcion(modo: TorneoModo): string {
  return MODOS.find((m) => m.value === modo)?.descripcion ?? "";
}

// Migración 090: "wtl" no es autoexplicativo como el resto de los
// formatos (1v1/2v2/3v3/4v4, que se muestran tal cual) -- este mapeo
// se usa en cualquier lugar donde se renderiza torneo.formato como
// badge o etiqueta visible.
const FORMATO_LABELS: Record<TorneoFormato, string> = {
  "1v1": "1v1",
  "2v2": "2v2",
  "3v3": "3v3",
  "4v4": "4v4",
  wtl: "Clan vs Clan (WTL)",
};

export function getFormatoLabel(formato: TorneoFormato): string {
  return FORMATO_LABELS[formato] ?? formato;
}

// 1v1 inscribe a un jugador individual; el resto de los formatos
// inscribe a un equipo completo (ver migración 009).
export function esFormatoPorEquipo(formato: TorneoFormato): boolean {
  return formato !== "1v1";
}

// Miembros mínimos que necesita un equipo para poder inscribirse a un
// torneo de este formato -- coincide con el mínimo que valida
// inscribir_equipo() en la base. En formato "wtl" el mínimo lo define
// jugadores_por_set del torneo (migración 090), no un número fijo.
export function getMinimoMiembrosEquipo(formato: TorneoFormato, jugadoresPorSet?: number): number {
  switch (formato) {
    case "2v2":
      return 2;
    case "3v3":
      return 3;
    case "4v4":
      return 4;
    case "wtl":
      return jugadoresPorSet ?? 3;
    default:
      return 1;
  }
}
