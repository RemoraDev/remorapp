import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
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

const FAN_ITEMS: FanItem[] = [
  { key: "torneos-inscritos", label: "Torneos inscritos", requiresAuth: true },
  { key: "mi-equipo", label: "Mi equipo", requiresAuth: true },
  { key: "mi-perfil", label: "Mi perfil", requiresAuth: true },
  { key: "sugerencias", label: "Sugerencias", requiresAuth: false },
];

export default function FanMenu({ isOpen, onClose }: FanMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

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

    if (item.key === "mi-perfil") {
      navigate("/perfil");
      onClose();
      return;
    }

    console.log(`Fan menu: "${item.label}" (usuario autenticado, función próximamente)`);
    onClose();
  };

  if (!isOpen && !showSuggestions) return null;

  return (
    <>
      {isOpen && <div className="fan-menu-backdrop" onClick={onClose} />}
      <div className={`fan-menu ${isOpen ? "is-open" : ""}`}>
        {FAN_ITEMS.map((item) => {
          const disabled = item.requiresAuth && !user;
          return (
            <button
              key={item.key}
              type="button"
              className={`fan-menu-item ${disabled ? "disabled" : ""} ${
                item.key === "sugerencias" ? "suggestion" : ""
              }`}
              onClick={() => handleItemClick(item)}
            >
              {item.label}
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
