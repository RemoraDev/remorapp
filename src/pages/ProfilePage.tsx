import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { PERFIL_TIPO_OPTIONS } from "../types/profile";
import type { PerfilTipo } from "../types/profile";

export default function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();

  // Arranca en el valor actual si ya eligió uno; si no, en "jugador"
  // como default del selector (no se guarda nada hasta confirmar).
  const [seleccion, setSeleccion] = useState<PerfilTipo>(profile?.perfil_tipo ?? "jugador");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  if (!loading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para ver tu perfil</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  const handleGuardar = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardando(true);
    setError(null);
    setGuardado(false);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ perfil_tipo: seleccion })
      .eq("id", user.id);

    setGuardando(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refreshProfile();
    setGuardado(true);
  };

  return (
    <section className="auth-page">
      <h1 className="auth-title">Mi perfil</h1>
      <p className="auth-sub">{profile?.nombre ?? "Jugador de RemorApp"}</p>

      <form className="auth-form" onSubmit={handleGuardar}>
        {!profile?.perfil_tipo && <p className="form-hint">Aún no elegiste tu rol.</p>}
        {error && <div className="form-error">{error}</div>}
        {guardado && <div className="form-success">Tu rol se guardó correctamente.</div>}

        <div className="form-group">
          <span className="form-label">Tipo de perfil</span>
          <div className="form-radio-group">
            {PERFIL_TIPO_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`form-radio-option ${seleccion === option.value ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="perfilTipo"
                  checked={seleccion === option.value}
                  onChange={() => setSeleccion(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar"}
        </button>
      </form>
    </section>
  );
}
