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
      "Cada participante puede perder una vez sin quedar eliminado: pasa a la llave de perdedores antes de quedar fuera.",
  },
  {
    value: "todos_contra_todos",
    label: "Todos contra todos",
    descripcion: "Cada participante juega contra todos los demás; gana quien sume más victorias.",
  },
  {
    value: "rey_de_la_colina",
    label: "Rey de la Colina",
    descripcion:
      "Un jugador defiende el trono partida a partida contra retadores; se acumulan puntos por cada victoria.",
  },
];

export function getModoLabel(modo: TorneoModo): string {
  return MODOS.find((m) => m.value === modo)?.label ?? modo;
}

export function getModoDescripcion(modo: TorneoModo): string {
  return MODOS.find((m) => m.value === modo)?.descripcion ?? "";
}

// 1v1 inscribe a un jugador individual; el resto de los formatos
// inscribe a un equipo completo (ver migración 009).
export function esFormatoPorEquipo(formato: TorneoFormato): boolean {
  return formato !== "1v1";
}

// Miembros mínimos que necesita un equipo para poder inscribirse a un
// torneo de este formato -- coincide con el mínimo que valida
// inscribir_equipo() en la base.
export function getMinimoMiembrosEquipo(formato: TorneoFormato): number {
  switch (formato) {
    case "2v2":
      return 2;
    case "3v3":
      return 3;
    case "4v4":
      return 4;
    default:
      return 1;
  }
}
