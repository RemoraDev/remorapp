import { Link } from "react-router-dom";
import Logo from "./Logo";
import { useAuth } from "../context/AuthContext";

export default function Header() {
  const { user, profile, signOut } = useAuth();

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
                {profile?.nombre ?? user.email}
              </Link>
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
