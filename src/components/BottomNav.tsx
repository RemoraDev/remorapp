import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { MessageSquare, Shield, BarChart3, User, Home } from "lucide-react";
import FanMenu from "./FanMenu";
import { useAuth } from "../context/AuthContext";
import useChatFijoEscritorio from "../hooks/useChatFijoEscritorio";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";

// Migración 098: los 4 íconos de la barra inferior eran SVG a mano,
// uno por uno -- se reemplazan por lucide-react (mismo trazo de 2px,
// sin relleno, puntas y uniones redondeadas, así que no hace falta
// tocar el CSS de .bottom-nav-item svg, ya apunta a cualquier <svg>
// hijo sea cual sea su origen).

export default function BottomNav() {
  const { user, profile } = useAuth();
  // "Mi perfil" lleva al perfil público propio -- si todavía no tiene
  // nick elegido (perfil incompleto) manda a /perfil a completarlo
  // primero, y sin sesión manda a /login, en vez de a una ruta de
  // jugador que no podría resolver.
  const miPerfilHref = !user ? "/login" : profile?.nick ? `/jugador/${profile.nick}/${profile.unique_id}` : "/perfil";
  // Reorganización: "Mi Clan" (antes "Mi equipo") se cambia de lugar
  // con "Clanes" -- pasa a la barra inferior fija, directo al clan
  // propio (o al buscador general, si todavía no pertenece a
  // ninguno). "Clanes" (el buscador general) entra en su lugar al
  // abanico central (ver FanMenu.tsx).
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);
  useEffect(() => {
    if (!user) {
      setMiEquipo(null);
      return;
    }
    obtenerEquipoDelUsuario(user.id).then(setMiEquipo);
  }, [user]);
  const miClanHref = !user ? "/login" : miEquipo?.teamTag ? `/equipos/${miEquipo.teamTag}` : "/equipos";
  const [fanOpen, setFanOpen] = useState(false);
  // Dispara la animación "poder" (ver .animar-poder en halcon.css) cada
  // vez que se toca el botón central; se saca sola al terminar, vía
  // onAnimationEnd, no con un temporizador en JS.
  const [presionado, setPresionado] = useState(false);
  // En escritorio, para quien ya ve el chat de líderes FIJO en la
  // columna derecha (líder de clan/staff/dueño), el botón "Chat" de
  // acá abajo no cumple ninguna función -- pasa a mostrar "Inicio" en
  // su lugar, ver useChatFijoEscritorio.ts.
  const chatFijoVisible = useChatFijoEscritorio();

  const handleCentralClick = () => {
    setFanOpen((open) => !open);
    setPresionado(true);
  };

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {/* Migración 109: "Chat" pasa de vivir en el abanico a ser un
            ícono fijo acá, en el lugar que tenía "Inicio" -- Inicio ya
            no tiene ícono propio en la barra, queda accesible desde el
            logo "RemorApp" del header (Header.tsx ya lo lleva a "/"),
            para que no se quede sin ningún camino de vuelta. Excepción:
            en escritorio, quien ya ve el chat fijo en la columna
            derecha no necesita este botón para nada -- ahí vuelve a
            ser "Inicio" (chatFijoVisible, ver más arriba). */}
        {chatFijoVisible ? (
          <NavLink to="/" end className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
            <Home />
            <span>Inicio</span>
          </NavLink>
        ) : (
          <NavLink to="/chat-lideres" className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
            <MessageSquare />
            <span>Chat</span>
          </NavLink>
        )}

        <NavLink to={miClanHref} className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <Shield />
          <span>Mi Clan</span>
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

        {/* Ranking (migración 059) ocupa el lugar que dejó Tienda --
            Torneos ya vive en el abanico central, no hace falta
            moverlo de nuevo (ver el comentario en FanMenu.tsx). */}
        <NavLink to="/ranking" className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <BarChart3 />
          <span>Ranking</span>
        </NavLink>

        <NavLink to={miPerfilHref} className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
          <User />
          <span>Mi perfil</span>
        </NavLink>
      </div>
    </nav>
  );
}
