interface NivelBadgeProps {
  nivel: number;
  className?: string;
}

// Insignia chica de nivel, reusada en el header, listas de
// participantes/miembros, y el nombre del clan en /equipos/:tag.
export default function NivelBadge({ nivel, className = "" }: NivelBadgeProps) {
  return <span className={`nivel-badge ${className}`}>Nv. {nivel}</span>;
}
