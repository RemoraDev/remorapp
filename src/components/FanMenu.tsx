import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SuggestionModal from "./SuggestionModal";
import { calcularPosiciones, calcularRadioSeguro } from "../lib/fanMenuLayout";

interface FanMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FanItem {
  key: string;
  label: string;
  requiresAuth: boolean;
}

// "Mi perfil" se movió fuera del abanico: ahora el nombre en el header
// lleva directo a /perfil. En su lugar queda "Foro". Sugerencias sigue
// exactamente igual (sin requiresAuth, con su propio flujo aparte).
const FAN_ITEMS: FanItem[] = [
  { key: "torneos-inscritos", label: "Torneos inscritos", requiresAuth: true },
  { key: "mi-equipo", label: "Mi equipo", requiresAuth: true },
  { key: "foro", label: "Foro", requiresAuth: false },
  { key: "sugerencias", label: "Sugerencias", requiresAuth: false },
];

export default function FanMenu({ isOpen, onClose }: FanMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Radio del arco calculado según el ancho real de la ventana, para que
  // los 4 hexágonos siempre queden completos en pantalla (nunca un radio
  // fijo en CSS). Se recalcula si la ventana cambia de tamaño.
  const [radio, setRadio] = useState(() =>
    typeof window === "undefined" ? 150 : calcularRadioSeguro(window.innerWidth)
  );

  useEffect(() => {
    const actualizarRadio = () => setRadio(calcularRadioSeguro(window.innerWidth));
    actualizarRadio();
    window.addEventListener("resize", actualizarRadio);
    return () => window.removeEventListener("resize", actualizarRadio);
  }, []);

  // El overlay atenúa todo por igual, pero un color muy saturado (los
  // botones cian) sigue leyéndose "vivo" incluso ya oscurecido. Esta
  // clase le da a esos botones un empujón extra de atenuación mientras
  // el abanico está abierto (ver .btn-primary bajo body.abanico-abierto
  // en halcon.css), además del overlay que ya los cubre a todos.
  useEffect(() => {
    document.body.classList.toggle("abanico-abierto", isOpen);
    return () => document.body.classList.remove("abanico-abierto");
  }, [isOpen]);

  const posiciones = calcularPosiciones(radio);

  const handleItemClick = (item: FanItem) => {
    if (item.requiresAuth && !user) {
      setNotice("Inicia sesión para ver esto");
      return;
    }

    setNotice(null);

    if (item.key === "sugerencias") {
      setShowSuggestions(true);
      return;
    }

    if (item.key === "foro") {
      navigate("/foro");
      onClose();
      return;
    }

    console.log(`Fan menu: "${item.label}" (usuario autenticado, función próximamente)`);
    onClose();
  };

  return (
    <>
      {/* Portal a document.body a propósito: .bottom-nav tiene
          backdrop-filter (para el blur de la barra), y eso convierte a
          .bottom-nav en el "containing block" de cualquier descendiente
          position:fixed — el overlay quedaba con top y bottom
          coincidiendo en el mismo punto (alto 0), pegado a la barra en
          vez de cubrir la pantalla. Sacándolo del árbol de .bottom-nav
          via portal, vuelve a medirse contra la ventana real.
          Igual que .fan-menu-item: siempre montado, se anima por clase,
          no por mount/unmount (si no, no habría transición de opacidad
          real en la entrada). Cerrado, pointer-events:none lo saca de
          encima para no bloquear el resto de la página. */}
      {createPortal(
        <div
          className={`fan-menu-backdrop ${isOpen ? "is-open" : ""}`}
          aria-hidden={!isOpen}
          onClick={onClose}
        />,
        document.body
      )}
      {/* Se mantiene siempre montado (no se desmonta al cerrar): así el
          cambio cerrado -> abierto es un cambio de clase real sobre un
          elemento que ya existe, que el navegador sí puede animar. Si se
          recreara desde cero cada vez, nacería directo en su estado
          final y no se vería ninguna transición de entrada. Cuando está
          cerrado, aria-hidden lo saca del árbol de accesibilidad y
          tabIndex=-1 lo saca del tabulado (además de opacity:0 y
          pointer-events:none que ya vienen del CSS). */}
      <div className={`fan-menu ${isOpen ? "is-open" : ""}`} aria-hidden={!isOpen}>
        {FAN_ITEMS.map((item, indice) => {
          const disabled = item.requiresAuth && !user;
          const posicion = posiciones[indice];
          // Posición y demora calculadas en JS (según el radio seguro
          // para este ancho de pantalla), no fijas en CSS.
          const estilo = {
            "--fan-x": `${posicion.x}px`,
            "--fan-y": `${posicion.y}px`,
            transitionDelay: `${indice * 40}ms`,
            animationDelay: `${indice * 40}ms`,
          } as CSSProperties;
          return (
            <button
              key={item.key}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              style={estilo}
              className={`fan-menu-item ${disabled ? "disabled" : ""} ${
                item.key === "sugerencias" ? "suggestion" : ""
              }`}
              onClick={() => handleItemClick(item)}
            >
              {/* Doble capa para el hexágono: este botón es el "borde"
                  (fondo de color, recortado al hexágono completo) y
                  fan-menu-item-fill es el "relleno" (recortado al mismo
                  hexágono, un poco más chico y centrado encima). Evita
                  el defecto de un border directo sobre clip-path, que
                  no calza limpio en los vértices agudos. */}
              <span className="fan-menu-item-fill">{item.label}</span>
            </button>
          );
        })}
        <div className={`fan-menu-notice ${notice ? "visible" : ""}`} aria-live="polite">
          {notice}
        </div>
      </div>
      {showSuggestions && (
        <SuggestionModal
          onClose={() => {
            setShowSuggestions(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
