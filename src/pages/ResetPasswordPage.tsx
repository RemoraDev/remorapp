import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  // El link del correo de recuperación arma una sesión temporal al
  // cargar la página (Supabase la detecta sola desde la URL) -- si
  // user existe acá, el link es válido; si no, o venció, o alguien
  // entró a esta página directo, sin pasar por el correo.
  const { user, loading: authLoading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actualizada, setActualizada] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contraseña tiene que tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmarPassword) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setActualizada(true);
  };

  if (actualizada) {
    return (
      <section className="auth-page">
        <h1 className="auth-title">¡Contraseña actualizada!</h1>
        <p className="auth-sub">Ya puedes seguir navegando, o volver a iniciar sesión si quieres.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/")}>
          Ir a RemorApp
        </button>
      </section>
    );
  }

  if (!authLoading && !user) {
    return (
      <section className="auth-page">
        <h1 className="auth-title">Este link no es válido</h1>
        <p className="auth-sub">
          El link de recuperación venció o ya se usó. Pide uno nuevo para poder cambiar tu
          contraseña.
        </p>
        <p className="auth-switch">
          <Link to="/forgot-password">Pedir un nuevo link</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <h1 className="auth-title">Elige tu nueva contraseña</h1>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="reset-password">
            Contraseña nueva
          </label>
          <input
            id="reset-password"
            className="form-input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="reset-password-confirmar">
            Repite la contraseña nueva
          </label>
          <input
            id="reset-password-confirmar"
            className="form-input"
            type="password"
            required
            minLength={6}
            value={confirmarPassword}
            onChange={(e) => setConfirmarPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Guardando..." : "Guardar contraseña"}
        </button>
      </form>
    </section>
  );
}
