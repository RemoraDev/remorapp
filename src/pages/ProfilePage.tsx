import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { validarNick } from "../lib/nickValidation";
import { recortarImagenCuadrada } from "../lib/teams";
import { COUNTRY_OPTIONS, LIGA_OPTIONS, SC2_REGION_OPTIONS, perfilEstaCompleto } from "../types/profile";
import type { Country, Liga, Sc2Region, Profile } from "../types/profile";
import Avatar from "../components/Avatar";
import MmrProgressBar from "../components/MmrProgressBar";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface InvitacionConEquipo {
  id: string;
  equipoNombre: string;
  equipoTag: string;
  equipoLogoUrl: string | null;
  invitadoPorNick: string | null;
}

// PostgREST embebe una relación "to-one" a veces como objeto y a veces
// como array de un elemento -- se contemplan las dos, mismo patrón que
// el resto de la app.
function extraerUno<T>(valor: unknown): T | null {
  if (Array.isArray(valor)) return (valor[0] as T) ?? null;
  return (valor as T) ?? null;
}

// Los 5 datos que hacen que un perfil se sienta "completo" -- los 4 de
// perfilEstaCompleto() más la foto (que no es obligatoria, así que no
// forma parte del gate, pero sí de este indicador amistoso).
function calcularProgresoPerfil(profile: Profile | null) {
  const campos = [
    { ok: !!profile?.nick, falta: "el nick" },
    { ok: !!profile?.country, falta: "tu país" },
    { ok: !!profile?.sc2_region, falta: "tu servidor de SC2" },
    { ok: !!profile?.sc2_id, falta: "tu ID de SC2" },
    { ok: !!profile?.avatar_url, falta: "la foto" },
  ];
  const completos = campos.filter((c) => c.ok).length;
  const faltantes = campos.filter((c) => !c.ok).map((c) => c.falta);

  let mensaje: string;
  if (faltantes.length === 0) {
    mensaje = "¡Tu perfil está completo!";
  } else if (faltantes.length === 1) {
    mensaje = `¡Ya casi! Solo te falta ${faltantes[0]}.`;
  } else {
    mensaje = "Vas bien, de a poco lo vas completando.";
  }

  return { completos, total: campos.length, mensaje };
}

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
  const [liga, setLiga] = useState<Liga | "">("");
  const [guardandoIdentidad, setGuardandoIdentidad] = useState(false);
  const [errorIdentidad, setErrorIdentidad] = useState<string | null>(null);
  const [identidadGuardada, setIdentidadGuardada] = useState(false);

  // --- "Soy caster": switch independiente de perfil_tipo, se guarda
  // solo al tocarlo (no hace falta un botón "Guardar" aparte). ---
  const [esCaster, setEsCaster] = useState(false);
  const [guardandoCaster, setGuardandoCaster] = useState(false);
  const [errorCaster, setErrorCaster] = useState<string | null>(null);

  // --- Foto de perfil ---
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [guardandoAvatar, setGuardandoAvatar] = useState(false);
  const [errorAvatar, setErrorAvatar] = useState<string | null>(null);
  const [avatarGuardado, setAvatarGuardado] = useState(false);

  // --- Invitaciones de equipo pendientes ---
  const [invitaciones, setInvitaciones] = useState<InvitacionConEquipo[]>([]);
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [errorInvitacion, setErrorInvitacion] = useState<string | null>(null);

  // El perfil llega después del primer render (consulta async): cuando
  // aparece (o cambia tras guardar), sincroniza los campos del form.
  useEffect(() => {
    if (!profile) return;
    setNick(profile.nick ?? "");
    setCountry(profile.country ?? "");
    setSc2Region(profile.sc2_region ?? "");
    setSc2Id(profile.sc2_id ?? "");
    setLiga(profile.liga ?? "");
    setEsCaster(profile.es_caster);
  }, [profile]);

  const cargarInvitaciones = async () => {
    if (!user) {
      setInvitaciones([]);
      return;
    }

    // team_invitations tiene DOS relaciones con profiles (invited_user_id
    // e invited_by) -- hay que especificar la columna para que PostgREST
    // no tire PGRST201 por ambigüedad (mismo caso que ya vimos con
    // tournament_participants/tournaments).
    const { data } = await supabase
      .from("team_invitations")
      .select("id, teams(name, tag, logo_url), profiles!invited_by(nick)")
      .eq("invited_user_id", user.id)
      .eq("status", "pendiente")
      .order("created_at", { ascending: false });

    setInvitaciones(
      (data ?? []).map((inv) => {
        const equipo = extraerUno<{ name: string; tag: string; logo_url: string | null }>(inv.teams);
        const invitador = extraerUno<{ nick: string | null }>(inv.profiles);
        return {
          id: inv.id,
          equipoNombre: equipo?.name ?? "Equipo de RemorApp",
          equipoTag: equipo?.tag ?? "",
          equipoLogoUrl: equipo?.logo_url ?? null,
          invitadoPorNick: invitador?.nick ?? null,
        };
      })
    );
  };

  useEffect(() => {
    cargarInvitaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAceptarInvitacion = async (invitationId: string) => {
    setRespondiendo(invitationId);
    setErrorInvitacion(null);

    const { error } = await supabase.rpc("aceptar_invitacion", { p_invitation_id: invitationId });

    setRespondiendo(null);

    if (error) {
      setErrorInvitacion(error.message);
      return;
    }

    setInvitaciones((prev) => prev.filter((inv) => inv.id !== invitationId));
    await refreshProfile();
  };

  const handleRechazarInvitacion = async (invitationId: string) => {
    setRespondiendo(invitationId);
    setErrorInvitacion(null);

    const { error } = await supabase.rpc("rechazar_invitacion", { p_invitation_id: invitationId });

    setRespondiendo(null);

    if (error) {
      setErrorInvitacion(error.message);
      return;
    }

    setInvitaciones((prev) => prev.filter((inv) => inv.id !== invitationId));
    await refreshProfile();
  };

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
      setErrorIdentidad("Debes completar todos los campos.");
      return;
    }

    setGuardandoIdentidad(true);
    setErrorIdentidad(null);
    setIdentidadGuardada(false);

    // cuenta_validada no se manda: se recalcula sola en la base
    // (trigger actualizar_cuenta_validada) a partir de los 4 campos
    // obligatorios. liga es opcional -- puede ir vacía sin problema.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ nick, country, sc2_region: sc2Region, sc2_id: sc2Id.trim(), liga: liga || null })
      .eq("id", user.id);

    setGuardandoIdentidad(false);

    if (updateError) {
      setErrorIdentidad(updateError.message);
      return;
    }

    await refreshProfile();
    setIdentidadGuardada(true);
  };

  const handleToggleCaster = async () => {
    if (!user) return;

    const nuevoValor = !esCaster;
    setEsCaster(nuevoValor);
    setGuardandoCaster(true);
    setErrorCaster(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ es_caster: nuevoValor })
      .eq("id", user.id);

    setGuardandoCaster(false);

    if (updateError) {
      setEsCaster(!nuevoValor); // revierte el cambio optimista si falló
      setErrorCaster(updateError.message);
      return;
    }

    await refreshProfile();
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorAvatar(null);
    setAvatarGuardado(false);

    if (!archivo) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }

    if (archivo.size > AVATAR_MAX_BYTES) {
      setErrorAvatar("La foto no puede pesar más de 2MB.");
      event.target.value = "";
      return;
    }

    setAvatarFile(archivo);
    setAvatarPreview(URL.createObjectURL(archivo));
  };

  const handleGuardarAvatar = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !avatarFile) return;

    setGuardandoAvatar(true);
    setErrorAvatar(null);
    setAvatarGuardado(false);

    try {
      const recorte = await recortarImagenCuadrada(avatarFile);
      const extension = avatarFile.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/${Date.now()}-avatar.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(ruta, recorte, { contentType: recorte.type });

      if (uploadError) {
        setErrorAvatar("No se pudo subir la foto: " + uploadError.message);
        setGuardandoAvatar(false);
        return;
      }

      const avatarUrl = supabase.storage.from("avatars").getPublicUrl(ruta).data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id);

      if (updateError) {
        setErrorAvatar(updateError.message);
        setGuardandoAvatar(false);
        return;
      }

      await refreshProfile();
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarGuardado(true);
    } catch {
      setErrorAvatar("No se pudo procesar la foto, prueba con otra imagen.");
    } finally {
      setGuardandoAvatar(false);
    }
  };

  const completo = perfilEstaCompleto(profile);
  const progreso = calcularProgresoPerfil(profile);

  return (
    <section className="auth-page">
      <h1 className="auth-title">Mi perfil</h1>

      {avisoRedireccion && <div className="form-hint profile-gate-banner">{avisoRedireccion}</div>}

      {invitaciones.length > 0 && (
        <>
          <h2 className="detail-subtitle">Invitaciones de equipo</h2>
          {errorInvitacion && <div className="form-error">{errorInvitacion}</div>}
          <div className="invitation-list">
            {invitaciones.map((inv) => (
              <div key={inv.id} className="invitation-card">
                <Avatar url={inv.equipoLogoUrl} nombre={inv.equipoNombre} className="detail-participant-avatar" />
                <div className="invitation-info">
                  <p className="invitation-team">
                    {inv.equipoNombre} <span className="profile-nick-id">[{inv.equipoTag}]</span>
                  </p>
                  {inv.invitadoPorNick && (
                    <p className="tournament-card-meta">Invitado por {inv.invitadoPorNick}</p>
                  )}
                </div>
                <div className="invitation-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={respondiendo === inv.id}
                    onClick={() => handleAceptarInvitacion(inv.id)}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={respondiendo === inv.id}
                    onClick={() => handleRechazarInvitacion(inv.id)}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="profile-avatar-section">
        <Avatar
          url={avatarPreview ?? profile?.avatar_url}
          nombre={profile?.nick ?? profile?.nombre}
          className="profile-avatar"
        />
        {!avatarPreview && !profile?.avatar_url && (
          <p className="profile-avatar-hint">Sube tu foto para que te reconozcan en tu clan.</p>
        )}
        <form className="profile-avatar-form" onSubmit={handleGuardarAvatar}>
          {errorAvatar && <div className="form-error">{errorAvatar}</div>}
          {avatarGuardado && <div className="form-success">¡Foto actualizada!</div>}
          <input
            id="perfil-avatar"
            className="form-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleAvatarChange}
          />
          {avatarFile && (
            <button type="submit" className="btn btn-ghost btn-block" disabled={guardandoAvatar}>
              {guardandoAvatar ? "Subiendo..." : "Guardar foto"}
            </button>
          )}
        </form>
      </div>

      {profile?.nick ? (
        <p className="profile-nick-display">
          {profile.nick}
          <span className="profile-nick-id">#{profile.unique_id}</span>
        </p>
      ) : (
        <p className="auth-sub">{profile?.nombre ?? "Jugador de RemorApp"}</p>
      )}

      <div className="profile-progress">
        <div className="profile-progress-bar">
          <div
            className="profile-progress-fill"
            style={{ width: `${(progreso.completos / progreso.total) * 100}%` }}
          />
        </div>
        <p className="profile-progress-text">
          {progreso.completos} de {progreso.total} datos completos — {progreso.mensaje}
        </p>
      </div>

      {!completo && (
        <div className="form-hint profile-gate-banner">
          Completa tu perfil para acceder a más funciones
        </div>
      )}

      <h2 className="detail-subtitle">Identidad de jugador</h2>
      {profile && (
        <MmrProgressBar mmr={profile.mmr_1v1} liga={profile.liga_1v1} bancaRota={profile.banca_rota} />
      )}
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

        <div className="form-group">
          <label className="form-label" htmlFor="perfil-liga">
            Liga (opcional)
          </label>
          <select
            id="perfil-liga"
            className="form-select"
            value={liga}
            onChange={(e) => setLiga(e.target.value as Liga)}
          >
            <option value="">Prefiero no decirlo</option>
            {LIGA_OPTIONS.map((opcion) => (
              <option key={opcion} value={opcion}>
                {opcion}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={guardandoIdentidad}>
          {guardandoIdentidad ? "Guardando..." : "Guardar"}
        </button>
      </form>

      <h2 className="detail-subtitle">Caster</h2>
      <div className="auth-form">
        {errorCaster && <div className="form-error">{errorCaster}</div>}
        <label className="profile-caster-toggle">
          <input
            type="checkbox"
            checked={esCaster}
            onChange={handleToggleCaster}
            disabled={guardandoCaster}
          />
          Soy caster
        </label>
        <p className="form-hint">
          Independiente de tu rol de jugador o líder de clan -- podés ser las dos cosas a la vez.
        </p>
      </div>
    </section>
  );
}
