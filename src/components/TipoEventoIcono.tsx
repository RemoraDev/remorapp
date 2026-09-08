// Íconos lineales (SVG) para el selector de "Tipo de evento" en
// /tournaments/create -- mismo criterio que ModoIcono.tsx.
export default function TipoEventoIcono({ tipo }: { tipo: "privado" | "liga" | "amistosa" }) {
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

  switch (tipo) {
    case "privado":
      return (
        <svg {...comunes}>
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "liga":
      return (
        <svg {...comunes}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
          <path d="M12 14v3M9 20h6M10 17h4" />
        </svg>
      );
    case "amistosa":
      return (
        <svg {...comunes}>
          <path d="M3 11l4-4 3 2 4-4 3 3 4-4" />
          <path d="M3 11v3h4M21 7v3h-4" />
          <path d="M9 15l3 3 3-3" />
        </svg>
      );
    default:
      return null;
  }
}
