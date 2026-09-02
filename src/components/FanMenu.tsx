import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
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
// lleva directo a /perfil. En su lugar queda "Ayuda" (antes "Foro",
// reemplazado por completo -- ver AyudaPage.tsx). Sugerencias sigue
// exactamente igual (sin requiresAuth, con su propio flujo aparte).
// "Check-in" es nuevo (migración 037, Lineup de Clan War) -- no existía
// ningún botón de check-in en el abanico antes de esto. "Torneos" se
// sumó acá al reordenar la barra inferior (Torneos salió de ahí, Voice
// ocupó ese lugar) -- mismo destino de siempre, solo cambió de menú.
// "Torneos inscritos" pasó a llamarse "Mis torneos" (mismo destino).
const FAN_ITEMS: FanItem[] = [
  { key: "torneos", label: "Torneos", requiresAuth: false },
  { key: "torneos-inscritos", label: "Mis torneos", requiresAuth: true },
  { key: "mi-equipo", label: "Mi equipo", requiresAuth: true },
  { key: "checkin", label: "Check-in", requiresAuth: true },
  { key: "ayuda", label: "Ayuda", requiresAuth: false },
  { key: "sugerencias", label: "Sugerencias", requiresAuth: false },
];

export default function FanMenu({ isOpen, onClose }: FanMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Equipo del usuario (si tiene uno), para "Mi equipo" y "Check-in" --
  // hace falta el id (para buscar la Clan War) y el tag (para navegar).
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);

  useEffect(() => {
    if (!user) {
      setMiEquipo(null);
      return;
    }
    obtenerEquipoDelUsuario(user.id).then(setMiEquipo);
  }, [user]);

  const handleItemClick = async (item: FanItem) => {
    if (item.requiresAuth && !user) {
      setNotice("Inicia sesión para ver esto");
      return;
    }

    setNotice(null);

    if (item.key === "torneos") {
      navigate("/tournaments");
      onClose();
      return;
    }

    if (item.key === "torneos-inscritos") {
      navigate("/tournaments/inscritos");
      onClose();
      return;
    }

    if (item.key === "sugerencias") {
      setShowSuggestions(true);
      return;
    }

    if (item.key === "ayuda") {
      navigate("/ayuda");
      onClose();
      return;
    }

    if (item.key === "mi-equipo") {
      navigate(miEquipo ? `/equipos/${miEquipo.teamTag}` : "/equipos");
      onClose();
      return;
    }

    if (item.key === "checkin") {
      if (!miEquipo?.teamTag) {
        setNotice("Primero necesitas pertenecer a un equipo.");
        return;
      }

      // La Clan War activa más próxima de mi equipo -- 'aceptada'
      // (armando lineup o esperando la ventana de check-in) o
      // 'en_curso'. Manda directo a Gestor de eventos, ya en la etapa
      // en la que quedó, en vez de hacer buscar manualmente.
      const { data } = await supabase
        .from("clan_wars")
        .select("id")
        .in("status", ["aceptada", "en_curso"])
        .or(`challenger_team_id.eq.${miEquipo.team_id},challenged_team_id.eq.${miEquipo.team_id}`)
        .order("fecha_hora_cet", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!data) {
        setNotice("No tienes ninguna Clan War activa en este momento.");
        return;
      }

      navigate(`/equipos/${miEquipo.teamTag}?panel=eventos`);
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
