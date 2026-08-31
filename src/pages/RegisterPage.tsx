import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

type PerfilTipo = "jugador" | "caster" | "lider_clan";

const PERFIL_OPTIONS: { value: PerfilTipo; label: string }[] = [
  { value: "jugador", label: "Jugador" },
  { value: "caster", label: "Caster" },
  { value: "lider_clan", label: "Líder de clan" },
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perfilTipo, setPerfilTipo] = useState<PerfilTipo>("jugador");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nombre,
          perfil_tipo: perfilTipo,
        },
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

        <div className="form-group">
          <span className="form-label">Tipo de perfil</span>
          <div className="form-radio-group">
            {PERFIL_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`form-radio-option ${perfilTipo === option.value ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="perfilTipo"
                  value={option.value}
                  checked={perfilTipo === option.value}
                  onChange={() => setPerfilTipo(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
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
