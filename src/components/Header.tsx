import { Link } from "react-router-dom";
import Logo from "./Logo";
import Avatar from "./Avatar";
import LigaBadge from "./LigaBadge";
import { useAuth } from "../context/AuthContext";

export default function Header() {
  const { user, profile, invitacionesPendientes, signOut } = useAuth();

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/">
          <Logo withWordmark />
        </Link>
        <div className="header-actions">
          {user ? (
            <>
              {/* Mientras carga el perfil (o si por algún motivo no tiene
                  nombre) se cae de vuelta al correo, para no dejarlo vacío.
                  Lleva a /perfil: "Mi perfil" ya no vive en el abanico. */}
              <Link to="/perfil" className="header-user">
                <Avatar url={profile?.avatar_url} nombre={profile?.nombre} className="header-avatar" />
                {profile?.nombre ?? user.email}
                {profile && (
                  <LigaBadge
                    liga={profile.liga_1v1}
                    mmr={profile.mmr_1v1}
                    nivel={profile.nivel_1v1}
                    bancaRota={profile.banca_rota}
                  />
                )}
                {/* Invitaciones de equipo pendientes -- se responden en
                    /perfil, este es solo el aviso. */}
                {invitacionesPendientes > 0 && (
                  <span className="header-invite-badge">{invitacionesPendientes}</span>
                )}
              </Link>
              {profile?.es_admin && (
                <Link to="/admin" className="btn btn-ghost">
                  Admin
                </Link>
              )}
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                Cerrar sesión
              </button>
            </>
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
