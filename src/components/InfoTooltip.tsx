interface InfoTooltipProps {
  texto: string;
}

// Tooltip accesible (hover + foco por teclado) sin librerías externas,
// pensado para explicar en pocas palabras cada modo de torneo.
export default function InfoTooltip({ texto }: InfoTooltipProps) {
  return (
    <span className="info-tooltip">
      <button type="button" className="info-tooltip-trigger" aria-label="Más información">
        ?
      </button>
      <span className="info-tooltip-bubble" role="tooltip">
        {texto}
      </span>
    </span>
  );
}
