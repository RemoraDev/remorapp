import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { validarNick } from "../lib/nickValidation";

const AVISO_SESION_ACTIVA =
  "Ya tienes una sesión iniciada. Cierra sesión primero si quieres crear o entrar con otra cuenta.";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [nombre, setNombre] = useState("");
  const [nick, setNick] = useState("");
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

    // Migración 107: el nick se pide acá directo (mismas reglas que ya
    // existían en "Mi perfil" -- 3 a 13 caracteres, sin espacios,
    // filtro de lenguaje) para no obligar a pasar por una pantalla
    // aparte después solo para desbloquear crear un torneo o un
    // equipo.
    const errorNick = validarNick(nick);
    if (errorNick) {
      setError(errorNick);
      return;
    }

    setLoading(true);
    setError(null);

    // Migración 062: lista negra de correos -- se revisa ANTES de
    // intentar el registro, para mostrar el mensaje genérico sin
    // depender del error que devolvería Supabase Auth. La barrera
    // real (a nivel de base) vive en el trigger handle_new_user(), que
    // rechaza el alta igual aunque este chequeo del cliente se salte
    // de alguna forma.
    const { data: bloqueado } = await supabase.rpc("correo_esta_bloqueado", { p_correo: email });
    if (bloqueado) {
      setLoading(false);
      setError("Este correo no puede registrarse.");
      return;
    }

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        // perfil_tipo no se manda -- nadie lo elige a mano (migración
        // 011): arranca en 'jugador' solo, por el default de la
        // columna en la base. nick viaja acá igual que nombre --
        // handle_new_user() (migración 107) lo lee de
        // raw_user_meta_data y lo guarda directo en profiles.nick.
        data: { nombre, nick },
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
          <label className="form-label" htmlFor="register-nick">
            Nick
          </label>
          <input
            id="register-nick"
            className="form-input"
            type="text"
            required
            value={nick}
            onChange={(e) => setNick(e.target.value)}
          />
          <p className="form-hint">
            3 a 13 caracteres, sin espacios. Es tu identidad dentro de RemorApp (aparece como
            Nick#1234) -- se puede cambiar después desde Mi perfil.
          </p>
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
