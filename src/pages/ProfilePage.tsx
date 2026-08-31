import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { validarNick } from "../lib/nickValidation";
import { COUNTRY_OPTIONS, PERFIL_TIPO_OPTIONS, SC2_REGION_OPTIONS, perfilEstaCompleto } from "../types/profile";
import type { Country, PerfilTipo, Sc2Region } from "../types/profile";

export default function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const location = useLocation();
  // Llega desde LoginPage/RegisterPage cuando alguien con sesión activa
  // intentó entrar o registrarse de nuevo (ver Navigate en esas páginas).
  const avisoRedireccion = (location.state as { aviso?: string } | null)?.aviso ?? null;

  // --- Identidad de jugador: nick, país, servidor SC2, id SC2 ---
  // (los 4 campos que exige el gate de perfil completo).
  const [nick, setNick] = useState("");
  const [country, setCountry] = useState<Country | "">("");
  const [sc2Region, setSc2Region] = useState<Sc2Region | "">("");
  const [sc2Id, setSc2Id] = useState("");
  const [guardandoIdentidad, setGuardandoIdentidad] = useState(false);
  const [errorIdentidad, setErrorIdentidad] = useState<string | null>(null);
  const [identidadGuardada, setIdentidadGuardada] = useState(false);

  // --- Tipo de perfil (jugador/caster/líder de clan), independiente
  // del gate: no es uno de los 4 campos obligatorios. ---
  const [seleccionRol, setSeleccionRol] = useState<PerfilTipo>("jugador");
  const [guardandoRol, setGuardandoRol] = useState(false);
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [rolGuardado, setRolGuardado] = useState(false);

  // El perfil llega después del primer render (consulta async): cuando
  // aparece (o cambia tras guardar), sincroniza los campos del form.
  useEffect(() => {
    if (!profile) return;
    setNick(profile.nick ?? "");
    setCountry(profile.country ?? "");
    setSc2Region(profile.sc2_region ?? "");
    setSc2Id(profile.sc2_id ?? "");
    setSeleccionRol(profile.perfil_tipo ?? "jugador");
  }, [profile]);

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

  const handleGuardarIdentidad = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const errorNick = validarNick(nick);
    if (errorNick) {
      setErrorIdentidad(errorNick);
      return;
    }
    if (!country || !sc2Region || !sc2Id.trim()) {
      setErrorIdentidad("Te falta completar algún campo wn.");
      return;
    }

    setGuardandoIdentidad(true);
    setErrorIdentidad(null);
    setIdentidadGuardada(false);

    // cuenta_validada no se manda: se recalcula sola en la base
    // (trigger actualizar_cuenta_validada) a partir de estos 4 campos.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ nick, country, sc2_region: sc2Region, sc2_id: sc2Id.trim() })
      .eq("id", user.id);

    setGuardandoIdentidad(false);

    if (updateError) {
      setErrorIdentidad(updateError.message);
      return;
    }

    await refreshProfile();
    setIdentidadGuardada(true);
  };

  const handleGuardarRol = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardandoRol(true);
    setErrorRol(null);
    setRolGuardado(false);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ perfil_tipo: seleccionRol })
      .eq("id", user.id);

    setGuardandoRol(false);

    if (updateError) {
      setErrorRol(updateError.message);
      return;
    }

    await refreshProfile();
    setRolGuardado(true);
  };

  const completo = perfilEstaCompleto(profile);

  return (
    <section className="auth-page">
      <h1 className="auth-title">Mi perfil</h1>

      {avisoRedireccion && <div className="form-hint profile-gate-banner">{avisoRedireccion}</div>}

      {profile?.nick ? (
        <p className="profile-nick-display">
          {profile.nick}
          <span className="profile-nick-id">#{profile.unique_id}</span>
        </p>
      ) : (
        <p className="auth-sub">{profile?.nombre ?? "Jugador de RemorApp"}</p>
      )}

      {!completo && (
        <div className="form-hint profile-gate-banner">
          Completa tu perfil para acceder a más funciones
        </div>
      )}

      <h2 className="detail-subtitle">Identidad de jugador</h2>
      <form className="auth-form" onSubmit={handleGuardarIdentidad}>
        {errorIdentidad && <div className="form-error">{errorIdentidad}</div>}
        {identidadGuardada && <div className="form-success">Tu perfil se guardó correctamente.</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="perfil-nick">
            Nick
          </label>
          <input
            id="perfil-nick"
            className="form-input"
            type="text"
            required
            value={nick}
            onChange={(e) => setNick(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="perfil-country">
            País (de dónde eres)
          </label>
          <select
            id="perfil-country"
            className="form-select"
            required
            value={country}
            onChange={(e) => setCountry(e.target.value as Country)}
          >
            <option value="" disabled>
              Elige tu país
            </option>
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="perfil-sc2-region">
            Servidor de StarCraft II (al que te conectas)
          </label>
          <select
            id="perfil-sc2-region"
            className="form-select"
            required
            value={sc2Region}
            onChange={(e) => setSc2Region(e.target.value as Sc2Region)}
          >
            <option value="" disabled>
              Elige tu servidor
            </option>
            {SC2_REGION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="perfil-sc2-id">
            ID de StarCraft II
          </label>
          <input
            id="perfil-sc2-id"
            className="form-input"
            type="text"
            required
            value={sc2Id}
            onChange={(e) => setSc2Id(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={guardandoIdentidad}>
          {guardandoIdentidad ? "Guardando..." : "Guardar"}
        </button>
      </form>

      <h2 className="detail-subtitle">Tipo de perfil</h2>
      <form className="auth-form" onSubmit={handleGuardarRol}>
        {!profile?.perfil_tipo && <p className="form-hint">Aún no elegiste tu rol.</p>}
        {errorRol && <div className="form-error">{errorRol}</div>}
        {rolGuardado && <div className="form-success">Tu rol se guardó correctamente.</div>}

        <div className="form-radio-group">
          {PERFIL_TIPO_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`form-radio-option ${seleccionRol === option.value ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="perfilTipo"
                checked={seleccionRol === option.value}
                onChange={() => setSeleccionRol(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <button type="submit" className="btn btn-ghost btn-block" disabled={guardandoRol}>
          {guardandoRol ? "Guardando..." : "Guardar rol"}
        </button>
      </form>
    </section>
  );
}
