import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

const AVISO_SESION_ACTIVA =
  "Ya tienes una sesión iniciada. Cierra sesión primero si quieres crear o entrar con otra cuenta.";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No se puede entrar con otra cuenta mientras hay una sesión activa:
  // hay que cerrar sesión primero, a propósito, no "de pasada" acá.
  if (!authLoading && user) {
    return <Navigate to="/perfil" replace state={{ aviso: AVISO_SESION_ACTIVA }} />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await supabase.auth.signInWithPassword({ email, password });
    console.log("Resultado de inicio de sesión:", result);

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    navigate("/");
  };

  return (
    <section className="auth-page">
      <h1 className="auth-title">Iniciar sesión</h1>
      <p className="auth-sub">Entra a tu cuenta de RemorApp.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="login-email">
            Correo
          </label>
          <input
            id="login-email"
            className="form-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="login-password">
            Contraseña
          </label>
          <input
            id="login-password"
            className="form-input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="auth-switch">
        ¿No tienes cuenta? <Link to="/register">Crear cuenta</Link>
      </p>
    </section>
  );
}
