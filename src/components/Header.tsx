import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import Avatar from "./Avatar";
import LigaBadge from "./LigaBadge";
import { useAuth } from "../context/AuthContext";

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
                <Avatar
                  url={profile?.avatar_url}
                  nombre={profile?.nick ?? profile?.nombre}
                  className="header-avatar"
                  forma={profile?.avatar_forma}
                />
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

              <div className={`header-user-menu ${menuAbierto ? "is-open" : ""}`} aria-hidden={!menuAbierto}>
                <Link to="/perfil" className="header-user-menu-identity" onClick={cerrarMenu}>
                  <p className="header-user-menu-nick">
                    {profile?.nick ?? "Jugador de RemorApp"}
                    {profile?.nick && <span className="profile-nick-id">#{profile.unique_id}</span>}
                  </p>
                  {profile && (
                    <LigaBadge
                      liga={profile.liga_1v1}
                      mmr={profile.mmr_1v1}
                      nivel={profile.nivel_1v1}
                      bancaRota={profile.banca_rota}
                    />
                  )}
                </Link>

                <div className="header-user-menu-divider" />

                {profile?.es_admin && (
                  <Link to="/admin" className="header-user-menu-item" onClick={cerrarMenu}>
                    Admin
                  </Link>
                )}

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
