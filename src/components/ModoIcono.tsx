import type { TorneoModo } from "../types/tournaments";

// Un ícono lineal (SVG, sin imágenes externas) por cada modo de
// juego, para el selector de "Modo de juego" en /tournaments/create --
// reemplaza la lista de radios sin nada visual que la acompañara.
export default function ModoIcono({ modo }: { modo: TorneoModo }) {
  const comunes = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (modo) {
    case "eliminacion_simple":
      return (
        <svg {...comunes}>
          <path d="M4 6h6M4 18h6M10 6v12M10 12h6M18 12h2" />
        </svg>
      );
    case "eliminacion_doble":
      return (
        <svg {...comunes}>
          <path d="M4 3h5M4 8h5M9 3v5M9 5.5h5" />
          <path d="M4 14h5M4 20h5M9 14v6M9 17h5" />
          <path d="M14 5.5v11.5" strokeDasharray="1.5 2.5" />
        </svg>
      );
    case "todos_contra_todos":
      return (
        <svg {...comunes}>
          <path d="M6 6L18 6M6 6L18 18M6 6L6 18M18 6L6 18M18 6L18 18M6 18L18 18" />
          <circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18" cy="18" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "rey_de_la_colina":
      return (
        <svg {...comunes}>
          <path d="M4 19h16" />
          <path d="M6 19l0-7 3 3 3-6 3 6 3-3 0 7" />
        </svg>
      );
    case "suizo":
      return (
        <svg {...comunes}>
          <path d="M4 7c6 0 10 10 16 10" />
          <path d="M4 17c6 0 10-10 16-10" />
          <path d="M17 4l3 3-3 3" />
          <path d="M17 20l3-3-3-3" />
        </svg>
      );
    case "tabla_posiciones":
      return (
        <svg {...comunes}>
          <path d="M5 6h14M5 12h10M5 18h6" />
        </svg>
      );
    default:
      return null;
  }
}
