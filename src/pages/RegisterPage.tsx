import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";

const AVISO_SESION_ACTIVA =
  "Ya tienes una sesión iniciada. Cierra sesión primero si quieres crear o entrar con otra cuenta.";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  // No se puede crear una cuenta nueva mientras hay una sesión activa:
  // hay que cerrar sesión primero, a propósito, no "de pasada" acá.
  if (!authLoading && user) {
    return <Navigate to="/perfil" replace state={{ aviso: AVISO_SESION_ACTIVA }} />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    // El nombre se muestra públicamente (header, lista de participantes
    // de un torneo), así que pasa por el mismo filtro que el nick.
    if (contieneLenguajeInapropiado(nombre)) {
      setError("Ese nombre no está permitido. Por favor elige otro.");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        // perfil_tipo no se manda -- nadie lo elige a mano (migración
        // 011): arranca en 'jugador' solo, por el default de la
        // columna en la base.
        data: { nombre },
        emailRedirectTo: window.location.origin,
      },
    });
    console.log("Resultado de registro:", result);

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    // Supabase devuelve un usuario con identities vacío (sin error) cuando el
    // correo ya está registrado, para no filtrar qué correos existen.
    if (result.data.user && result.data.user.identities?.length === 0) {
      setError("Ya existe una cuenta con este correo.");
      return;
    }

    if (result.data.session) {
      navigate("/");
      return;
    }

    // Sin sesión: el proyecto tiene confirmación de correo activada.
    setPendingConfirmation(true);
  };

  if (pendingConfirmation) {
    return (
      <section className="auth-page">
        <h1 className="auth-title">Revisa tu correo</h1>
        <p className="auth-sub">
          Te enviamos un enlace de confirmación a <strong>{email}</strong>. Confírmalo para poder
          iniciar sesión.
        </p>
        <p className="auth-switch">
          <Link to="/login">Ir a iniciar sesión</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <h1 className="auth-title">Crear cuenta</h1>
      <p className="auth-sub">Únete a la comunidad de RemorApp.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="register-nombre">
            Nombre
          </label>
          <input
            id="register-nombre"
            className="form-input"
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="register-email">
            Correo
          </label>
          <input
            id="register-email"
            className="form-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="register-password">
            Contraseña
          </label>
          <input
            id="register-password"
            className="form-input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>

      <p className="auth-switch">
        ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
      </p>
    </section>
  );
}
