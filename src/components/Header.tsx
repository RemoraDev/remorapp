import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import Avatar from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { BORDE_HEADER_OPTIONS } from "../types/profile";

export default function Header() {
  const { user, profile, invitacionesPendientes, signOut } = useAuth();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const cerrarMenu = () => setMenuAbierto(false);

  const handleCerrarSesion = async () => {
    cerrarMenu();
    await signOut();
  };

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/">
          <Logo withWordmark />
        </Link>
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
                    redonda, ya no elegible (antes era avatar_forma). */}
                <span
                  className="header-avatar-borde"
                  style={{
                    borderColor: BORDE_HEADER_OPTIONS.find((o) => o.value === (profile?.borde_header ?? "negro"))
                      ?.colorHex,
                  }}
                >
                  <Avatar
                    url={profile?.avatar_url}
                    nombre={profile?.nick ?? profile?.nombre}
                    className="header-avatar"
                    forma="redondo"
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
                <Link to="/perfil?tab=configuracion" className="header-user-menu-item" onClick={cerrarMenu}>
                  Configuración
                </Link>

                {profile?.es_admin && (
                  <Link to="/admin" className="header-user-menu-item" onClick={cerrarMenu}>
                    Administración
                  </Link>
                )}

                <div className="header-user-menu-divider" />

                <button type="button" className="header-user-menu-item" onClick={() => void handleCerrarSesion()}>
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
