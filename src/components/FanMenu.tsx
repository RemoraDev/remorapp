import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import SuggestionModal from "./SuggestionModal";

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
  // Tag del equipo del usuario (si tiene uno), para que "Mi equipo"
  // mande directo a su perfil de equipo en vez de al buscador.
  const [miEquipoTag, setMiEquipoTag] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setMiEquipoTag(null);
      return;
    }
    obtenerEquipoDelUsuario(user.id).then((equipo) => setMiEquipoTag(equipo?.teamTag ?? null));
  }, [user]);

  const handleItemClick = (item: FanItem) => {
    if (item.requiresAuth && !user) {
      setNotice("Inicia sesión para ver esto");
      return;
    }

    setNotice(null);

    if (item.key === "torneos-inscritos") {
      navigate("/tournaments/inscritos");
      onClose();
      return;
    }

    if (item.key === "sugerencias") {
      setShowSuggestions(true);
      return;
    }

    if (item.key === "foro") {
      navigate("/foro");
      onClose();
      return;
    }

    if (item.key === "mi-equipo") {
      navigate(miEquipoTag ? `/equipos/${miEquipoTag}` : "/equipos");
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
          position:fixed. Sin esto, este catcher quedaría mal medido
          (mismo bug que ya encontramos con el overlay que había antes).
          Es solo para detectar el click afuera y cerrar -- transparente
          a propósito, no oscurece nada. */}
      {createPortal(
        <div
          className={`fan-menu-click-catcher ${isOpen ? "is-open" : ""}`}
          aria-hidden={!isOpen}
          onClick={onClose}
        />,
        document.body
      )}
      {/* Panel simple: un rectángulo con esquinas redondeadas, sin
          clip-path ni geometría de arco -- se despliega hacia arriba
          desde el botón central con las 4 opciones en columna. Se
          mantiene siempre montado (no se desmonta al cerrar) para que
          la transición de apertura sea real, no un salto: un elemento
          recién insertado ya en su estado final no tiene "antes" desde
          el que animar. */}
      <div className={`fan-menu ${isOpen ? "is-open" : ""}`} aria-hidden={!isOpen}>
        {FAN_ITEMS.map((item) => {
          const disabled = item.requiresAuth && !user;
          return (
            <button
              key={item.key}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              className={`fan-menu-item ${disabled ? "disabled" : ""} ${
                item.key === "sugerencias" ? "suggestion" : ""
              }`}
              onClick={() => handleItemClick(item)}
            >
              {/* Hexágono en SVG real (polygon con fill/stroke nativos),
                  no clip-path: así el borde no se escapa en las puntas.
                  El texto va aparte, en un <span> HTML posicionado
                  encima, para que siga nítido y accesible. */}
              <svg
                className="fan-menu-item-hex"
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon points="14,2 86,2 100,20 86,38 14,38 0,20" />
              </svg>
              <span className="fan-menu-item-label">{item.label}</span>
            </button>
          );
        })}
        {notice && (
          <div className="fan-menu-notice" aria-live="polite">
            {notice}
          </div>
        )}
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
