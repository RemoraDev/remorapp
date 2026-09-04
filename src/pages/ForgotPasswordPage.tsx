import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    // redirectTo apunta a /reset-password: ahí es donde Supabase manda
    // de vuelta al usuario después de que hace clic en el link del
    // correo, con la sesión de recuperación ya armada en la URL.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    // Supabase no distingue "el correo existe" de "no existe" en la
    // respuesta (para no filtrar qué correos están registrados) -- se
    // muestra el mismo mensaje de éxito en los dos casos.
    setEnviado(true);
  };

  if (enviado) {
    return (
      <section className="auth-page">
        <h1 className="auth-title">Revisa tu correo</h1>
        <p className="auth-sub">
          Si <strong>{email}</strong> corresponde a una cuenta de RemorApp, te enviamos un enlace
          para restablecer tu contraseña.
        </p>
        <p className="auth-switch">
          <Link to="/login">Volver a iniciar sesión</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <h1 className="auth-title">¿Olvidaste tu contraseña?</h1>
      <p className="auth-sub">Escribe tu correo y te mandamos un link para restablecerla.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="forgot-email">
            Correo
          </label>
          <input
            id="forgot-email"
            className="form-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Enviando..." : "Enviar link de recuperación"}
        </button>
      </form>

      <p className="auth-switch">
        <Link to="/login">Volver a iniciar sesión</Link>
      </p>
    </section>
  );
}
