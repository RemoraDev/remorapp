interface LigaBadgeProps {
  liga: string;
  mmr: number;
  bancaRota?: boolean;
  className?: string;
}

// Insignia de liga + MMR, reusada en el header, listas de
// participantes/miembros, y el nombre del clan en /equipos/:tag. El
// nivel (1-100) que mostraba antes se sacó de la interfaz por
// completo -- MMR y liga siguen calculándose exactamente igual, solo
// se dejó de mostrar esa insignia puntual.
export default function LigaBadge({ liga, mmr, bancaRota, className = "" }: LigaBadgeProps) {
  return (
    <span className={`nivel-badge ${bancaRota ? "nivel-badge-banca-rota" : ""} ${className}`}>
      {liga} · {mmr} MMR
    </span>
  );
}
