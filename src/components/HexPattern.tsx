interface HexPatternProps {
  id: string;
  className?: string;
}

// Textura decorativa de hexágonos en trazo (sin relleno), pensada para
// reutilizarse en cualquier sección que necesite este mismo fondo tipo
// "panal" (por ahora solo la barra de navegación inferior). Cada
// instancia necesita un id propio porque los <pattern> de SVG se
// referencian por id a nivel de documento, no por componente.
export default function HexPattern({ id, className }: HexPatternProps) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="34.64" height="60" patternUnits="userSpaceOnUse">
          <polygon points="17.32,0 34.64,10 34.64,30 17.32,40 0,30 0,10" />
          <polygon points="34.64,30 51.96,40 51.96,60 34.64,70 17.32,60 17.32,40" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
