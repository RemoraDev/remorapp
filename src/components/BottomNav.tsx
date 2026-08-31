import { useState } from "react";
import { NavLink } from "react-router-dom";
import FanMenu from "./FanMenu";
import HexPattern from "./HexPattern";
import { useAuth } from "../context/AuthContext";

const strokeProps = {
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...strokeProps}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

function TournamentsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...strokeProps}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M12 14v4M9 20h6" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...strokeProps}>
      <path d="M5 4h11v14a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M9 8h5M9 12h5M9 16h3" />
      <path d="M16 4h3v2a2 2 0 0 1-2 2h-1V4Z" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...strokeProps}>
      <path d="M4 9h16l-1 10H5L4 9Z" />
      <path d="M8 9V7a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

export default function BottomNav() {
  const { user } = useAuth();
  const [fanOpen, setFanOpen] = useState(false);
  // Dispara la animación "poder" (ver .animar-poder en halcon.css) cada
  // vez que se toca el botón central; se saca sola al terminar, vía
  // onAnimationEnd, no con un temporizador en JS.
  const [presionado, setPresionado] = useState(false);

  const handleCentralClick = () => {
    setFanOpen((open) => !open);
    setPresionado(true);
  };

  return (
    <nav className="bottom-nav">
      {/* Decoración: panal de hexágonos + brillo lento, puramente visual
          (aria-hidden) y detrás del contenido real de la barra. */}
      <div className="bottom-nav-hex" aria-hidden="true">
        <HexPattern id="bottom-nav-hex-pattern" className="hex-pattern bottom-nav-hex-svg" />
        <div className="bottom-nav-hex-glow" />
      </div>

      <div className="bottom-nav-inner">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <HomeIcon />
          <span>Inicio</span>
        </NavLink>

        <NavLink
          to="/tournaments"
          className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}
        >
          <TournamentsIcon />
          <span>Torneos</span>
        </NavLink>

        <div className="bottom-nav-center">
          <button
            type="button"
            className={`logo-nav-btn ${!user ? "is-dimmed" : ""} ${presionado ? "animar-poder" : ""}`}
            aria-label="Menú rápido"
            onClick={handleCentralClick}
            onAnimationEnd={() => setPresionado(false)}
          >
            {/* Logo estilizado como una sola "R", en vez del isotipo de
                rémora: gris apagado (filtro grayscale de .is-dimmed) sin
                sesión, color de acento (--h-accent) con sesión. */}
            <span className="center-nav-r" aria-hidden="true">
              R
            </span>
          </button>
          <FanMenu isOpen={fanOpen} onClose={() => setFanOpen(false)} />
        </div>

        <NavLink to="/news" className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <NewsIcon />
          <span>Noticias</span>
        </NavLink>

        <NavLink to="/store" className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <StoreIcon />
          <span>Tienda</span>
        </NavLink>
      </div>
    </nav>
  );
}
