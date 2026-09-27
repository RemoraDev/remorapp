import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Settings, LogOut, Search } from "lucide-react";
import Logo from "./Logo";
import Avatar from "./Avatar";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useSearch } from "../context/SearchContext";
import { BORDE_HEADER_OPTIONS, ESTADO_PRESENCIA_OPTIONS } from "../types/profile";

export default function Header() {
  const { user, profile, invitacionesPendientes, signOut, refreshProfile } = useAuth();
  const { abrirBuscador } = useSearch();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  const cerrarMenu = () => setMenuAbierto(false);

  const handleCerrarSesion = async () => {
    cerrarMenu();
    await signOut();
  };

  // Estado de presencia (migración 121): solo manual por ahora --
  // "Desconectado" no se elige nunca acá, se infiere solo (sin sesión
  // activa no hay avatar de header que mostrarlo).
  const handleCambiarEstado = async (estado: (typeof ESTADO_PRESENCIA_OPTIONS)[number]["value"]) => {
    if (!user || cambiandoEstado) return;
    setCambiandoEstado(true);
    const { error } = await supabase.from("profiles").update({ estado_presencia: estado }).eq("id", user.id);
    setCambiandoEstado(false);
    if (!error) await refreshProfile();
  };

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/">
          <Logo withWordmark />
        </Link>
        {/* Migración 099: buscador global (Ctrl+K / Cmd+K) -- este botón
            es solo el disparador visible (también funciona el atajo de
            teclado desde cualquier lugar); el modal en sí vive en
            SearchProvider, montado una sola vez en App.tsx. */}
        <button
          type="button"
          className="header-search-btn"
          onClick={abrirBuscador}
          aria-label="Buscar torneos, equipos o jugadores"
        >
          <Search size={15} />
          <span className="header-search-btn-label">Buscar</span>
          <kbd className="header-search-btn-kbd">Ctrl K</kbd>
        </button>
        <div className="header-actions">
          {user ? (
            <div className="header-user-wrap">
              {/* Header colapsado: solo el avatar. Todo lo demás (nick,
                  liga, mmr, nivel, Admin, cerrar sesión) vive en el menú
                  desplegable de abajo, para no ensanchar la barra. */}
              <button
                type="button"
                className="header-user-trigger"
                aria-haspopup="true"
                aria-expanded={menuAbierto}
                onClick={() => setMenuAbierto((abierto) => !abierto)}
              >
                {/* Borde del header (migración 056): sistema propio,
                    independiente de los "Bordes de Avatar" de Mi
                    perfil -- 4 colores lisos fijos, sin grosor
                    editable, sin efectos. La forma acá es SIEMPRE
                    redonda, ya no elegible (antes era avatar_forma).
                    Migración 092: si el avatar activo quedó con
                    transparencia real, este anillo de color se apaga
                    solo (transparent) -- rodear una forma transparente
                    con un borde sólido se ve raro. */}
                <span
                  className="header-avatar-borde"
                  style={{
                    borderColor: profile?.avatar_transparente
                      ? "transparent"
                      : BORDE_HEADER_OPTIONS.find((o) => o.value === (profile?.borde_header ?? "negro"))?.colorHex,
                  }}
                >
                  <Avatar
                    url={profile?.avatar_url}
                    nombre={profile?.nick ?? profile?.nombre}
                    className="header-avatar"
                    forma="redondo"
                  />
                  {/* Estado de presencia (migración 121): punto de color
                      sobre el avatar del header -- disponible/ausente/
                      ocupado, elegido a mano desde el menú de abajo.
                      "Desconectado" no aplica acá: si se ve este avatar
                      es porque hay una sesión activa. */}
                  <span
                    className="header-avatar-estado"
                    style={{
                      backgroundColor: ESTADO_PRESENCIA_OPTIONS.find((o) => o.value === profile?.estado_presencia)
                        ?.colorHex,
                    }}
                    title={
                      ESTADO_PRESENCIA_OPTIONS.find((o) => o.value === profile?.estado_presencia)?.label ??
                      "Disponible"
                    }
                  />
                </span>
                {invitacionesPendientes > 0 && (
                  <span className="header-invite-badge">{invitacionesPendientes}</span>
                )}
              </button>

              {/* Catcher transparente en document.body: detecta el click
                  afuera del menú y lo cierra, sin ocupar espacio real en
                  el documento (ver comentario de la clase en halcon.css). */}
              {createPortal(
                <div
                  className={`header-user-click-catcher ${menuAbierto ? "is-open" : ""}`}
                  aria-hidden={!menuAbierto}
                  onClick={cerrarMenu}
                />,
                document.body
              )}

              {/* Un solo acceso a Mi perfil: la reorganización dejó
                  todo (editar datos, transmisión, apariencia, juegos,
                  idioma) adentro de un único botón "Configuración" --
                  ya no hace falta un segundo link separado acá. */}
              <div className={`header-user-menu ${menuAbierto ? "is-open" : ""}`} aria-hidden={!menuAbierto}>
                <span className="header-user-menu-label">Estado</span>
                <div className="header-estado-presencia-opciones">
                  {ESTADO_PRESENCIA_OPTIONS.map((opcion) => (
                    <button
                      key={opcion.value}
                      type="button"
                      className={`header-estado-presencia-opcion ${
                        profile?.estado_presencia === opcion.value ? "is-activo" : ""
                      }`}
                      disabled={cambiandoEstado}
                      onClick={() => void handleCambiarEstado(opcion.value)}
                    >
                      <span className="header-estado-presencia-punto" style={{ backgroundColor: opcion.colorHex }} />
                      {opcion.label}
                    </button>
                  ))}
                </div>

                <div className="header-user-menu-divider" />

                <Link to="/perfil?tab=configuracion" className="header-user-menu-item" onClick={cerrarMenu}>
                  <Settings className="icon-inline" />
                  Configuración
                </Link>

                <div className="header-user-menu-divider" />

                <button type="button" className="header-user-menu-item" onClick={() => void handleCerrarSesion()}>
                  <LogOut className="icon-inline" />
                  Cerrar sesión
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Iniciar sesión
              </Link>
              <Link to="/register" className="btn btn-primary">
                Crear cuenta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
