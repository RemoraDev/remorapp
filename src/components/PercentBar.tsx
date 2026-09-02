interface PercentBarProps {
  label: string;
  value: number;
  className?: string;
}

// Barra simple de 0 a 100 (valentía, responsabilidad -- migración
// 024), reusando el mismo estilo visual que MmrProgressBar.
export default function PercentBar({ label, value, className = "" }: PercentBarProps) {
  return (
    <div className={`mmr-progress ${className}`}>
      <div className="mmr-progress-track">
        <div className="mmr-progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <p className="mmr-progress-texto">
        {label}: {value}%
      </p>
    </div>
  );
}
