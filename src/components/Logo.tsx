interface LogoProps {
  className?: string;
  withWordmark?: boolean;
}

/**
 * Isotipo abstracto de rémora: el cuerpo alargado en curva sugiere movimiento
 * junto a algo más grande, y las líneas del "disco adherente" en la cabeza
 * (rasgo distintivo del pez) se estilizan como marcas de velocidad/crecimiento.
 */
export default function Logo({ className = "h-9 w-9", withWordmark = false }: LogoProps) {
  return (
    <div className="logo">
      <svg
        viewBox="0 0 48 48"
        className={`logo-mark ${className}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 26C13 14 22 8 34 8c4 0 8 1.6 8 4.4 0 2.6-3.4 3.6-6.6 4.4C42 18 44 22 44 25.6c0 2.8-4 3.8-8.4 4.6C39 33 41 36.4 41 39c0 0-9-1-15.4-7C18 39 10 40 6 40c4-4.4 6.6-9 6.6-13S9 27.6 6 26Z"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M16 15.5c3-1 6-1 9 0M15 19.5c3.4-1 7-1 10.4 0"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark && (
        <span className="logo-word">
          Remor<span className="logo-word-accent">App</span>
        </span>
      )}
    </div>
  );
}
