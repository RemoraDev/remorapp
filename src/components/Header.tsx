import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import Avatar from "./Avatar";
import AvatarSkin from "./AvatarSkin";
import { useAuth } from "../context/AuthContext";

export default function Header() {
  const { user, profile, skinAvatarClave, invitacionesPendientes, signOut } = useAuth();
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
                <AvatarSkin clave={skinAvatarClave} forma={profile?.avatar_forma}>
                  <Avatar
                    url={profile?.avatar_url}
                    nombre={profile?.nick ?? profile?.nombre}
                    className="header-avatar"
                    forma={profile?.avatar_forma}
                  />
                </AvatarSkin>
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

              {/* Solo estas 3 opciones + Cerrar sesión -- el Nick#ID y la
                  insignia de liga/MMR/nivel que antes iban acá ahora
                  viven en "Mi perfil" (el perfil público), no hace
                  falta repetirlos en el menú. */}
              <div className={`header-user-menu ${menuAbierto ? "is-open" : ""}`} aria-hidden={!menuAbierto}>
                <Link to="/perfil" className="header-user-menu-item" onClick={cerrarMenu}>
                  Editar mis datos
                </Link>

                <Link to="/perfil?tab=apariencia" className="header-user-menu-item" onClick={cerrarMenu}>
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
