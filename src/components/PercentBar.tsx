interface PercentBarProps {
  label: string;
  value: number;
  className?: string;
  // Horizontal (por defecto): barra de carga clásica, crece hacia la
  // derecha -- se sigue usando donde no se pidió lo contrario. Vertical:
  // crece hacia ARRIBA, como una columna de gráfico de barras (ver
  // .percent-bar-vertical-track, que la dibuja con
  // flex-direction: column-reverse y el relleno con height variable,
  // no width) -- usada en la tarjeta agrupada de estadísticas de
  // /jugador/:nick/:uniqueId y /equipos/:tag.
  vertical?: boolean;
}

export default function PercentBar({ label, value, className = "", vertical = false }: PercentBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  if (vertical) {
    return (
      <div className={`percent-bar-vertical ${className}`}>
        <div className="percent-bar-vertical-track">
          <div className="percent-bar-vertical-fill" style={{ height: `${clamped}%` }} />
        </div>
        <p className="percent-bar-vertical-label">{label}</p>
        <p className="percent-bar-vertical-value">{value}%</p>
      </div>
    );
  }

  return (
    <div className={`mmr-progress ${className}`}>
      <div className="mmr-progress-track">
        <div className="mmr-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      <p className="mmr-progress-texto">
        {label}: {value}%
      </p>
    </div>
  );
}
