interface LigaBadgeProps {
  liga: string;
  mmr: number;
  // Nivel 1-100: solo tiene sentido para MMR de 1v1 por ahora (ver
  // calcular_nivel() en la base) -- se omite para insignias de equipo.
  nivel?: number;
  bancaRota?: boolean;
  className?: string;
}

// Insignia de liga + MMR (+ nivel, cuando aplica), reusada en el
// header, listas de participantes/miembros, y el nombre del clan en
// /equipos/:tag. Reemplaza a la vieja insignia de "Nv. X" del sistema
// de experiencia (migración 013), reemplazado por MMR y ligas
// oficiales de StarCraft II (migración 020).
export default function LigaBadge({ liga, mmr, nivel, bancaRota, className = "" }: LigaBadgeProps) {
  return (
    <span className={`nivel-badge ${bancaRota ? "nivel-badge-banca-rota" : ""} ${className}`}>
      {liga} · {mmr} MMR{nivel !== undefined ? ` · Nv. ${nivel}` : ""}
    </span>
  );
}
