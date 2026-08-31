import { Link } from "react-router-dom";
import Logo from "./Logo";
import { useAuth } from "../context/AuthContext";

export default function Header() {
  const { user, signOut } = useAuth();

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/">
          <Logo withWordmark />
        </Link>
        <div className="header-actions">
          {user ? (
            <>
              <span className="header-user">{user.email}</span>
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
