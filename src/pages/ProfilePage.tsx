import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { validarNick } from "../lib/nickValidation";
import { recortarImagenCuadrada } from "../lib/teams";
import { COUNTRY_OPTIONS, LIGA_OPTIONS, SC2_REGION_OPTIONS, perfilEstaCompleto } from "../types/profile";
import type { AvatarForma, Country, Liga, Sc2Region, Profile } from "../types/profile";
import { RAZA_SC2_OPTIONS } from "../types/juegos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";
import Avatar from "../components/Avatar";
import MmrProgressBar from "../components/MmrProgressBar";
import PercentBar from "../components/PercentBar";
import TitulosActivosList from "../components/TitulosActivosList";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface InvitacionConEquipo {
  id: string;
  equipoNombre: string;
  equipoTag: string;
  equipoLogoUrl: string | null;
  invitadoPorNick: string | null;
}

interface JugadorEncontrado {
  id: string;
  nick: string;
  uniqueId: string;
}

interface TituloJugadorConNombre {
  id: string;
  retadorId: string;
  retadorNombre: string;
  retadoId: string;
  retadoNombre: string;
  duracionDias: number;
  aceptado: boolean;
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

type PestanaConfiguracion = "datos" | "apariencia";

export default function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const { tema, setTema } = useTheme();
  const location = useLocation();
  // El menú del avatar en el header manda acá con ?tab=apariencia para
  // "Configuración" -- sin el parámetro (o con cualquier otro valor),
  // arranca en "Editar mis datos" como siempre.
  const [searchParams] = useSearchParams();
  const [pestanaActiva, setPestanaActiva] = useState<PestanaConfiguracion>(
    searchParams.get("tab") === "apariencia" ? "apariencia" : "datos"
  );
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

  // --- Perfil de juego de StarCraft II (migración 034): razas, en
  // perfiles_juego -- opcional, no bloquea cuenta_validada. juegoIdSc2
  // se resuelve una vez y queda guardado para el guardar/cargar. ---
  const [juegoIdSc2, setJuegoIdSc2] = useState<string | null>(null);
  const [razaPrincipal, setRazaPrincipal] = useState<RazaSc2 | "">("");
  const [razaSecundaria, setRazaSecundaria] = useState<RazaSc2 | "">("");
  const [guardandoRaza, setGuardandoRaza] = useState(false);
  const [errorRaza, setErrorRaza] = useState<string | null>(null);
  const [razaGuardada, setRazaGuardada] = useState(false);

  // --- "Soy caster": switch independiente de perfil_tipo, se guarda
  // solo al tocarlo (no hace falta un botón "Guardar" aparte). ---
  const [esCaster, setEsCaster] = useState(false);
  const [guardandoCaster, setGuardandoCaster] = useState(false);
  const [errorCaster, setErrorCaster] = useState<string | null>(null);

  // --- Forma de avatar (pestaña Apariencia, migración 031): igual que
  // "Soy caster", se guarda solo al elegir una opción. ---
  const [guardandoForma, setGuardandoForma] = useState(false);
  const [errorForma, setErrorForma] = useState<string | null>(null);

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

  // --- Títulos Padre/Hijo entre jugadores (migración 026) ---
  const [titulosPendientesResponder, setTitulosPendientesResponder] = useState<TituloJugadorConNombre[]>([]);
  const [titulosPropuestosPorMi, setTitulosPropuestosPorMi] = useState<TituloJugadorConNombre[]>([]);
  const [respondiendoTitulo, setRespondiendoTitulo] = useState<string | null>(null);
  const [erroresResponderTitulo, setErroresResponderTitulo] = useState<Record<string, string>>({});

  const [busquedaNickTitulo, setBusquedaNickTitulo] = useState("");
  const [buscandoTitulo, setBuscandoTitulo] = useState(false);
  const [errorBusquedaTitulo, setErrorBusquedaTitulo] = useState<string | null>(null);
  const [rivalTitulo, setRivalTitulo] = useState<JugadorEncontrado | null>(null);
  const [duracionTitulo, setDuracionTitulo] = useState("30");
  const [casterNombreTitulo, setCasterNombreTitulo] = useState("");
  const [casterLinkTitulo, setCasterLinkTitulo] = useState("");
  const [proponiendoTitulo, setProponiendoTitulo] = useState(false);
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const [tituloEnviado, setTituloEnviado] = useState(false);

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

  useEffect(() => {
    if (!user) return;

    (async () => {
      const idSc2 = await obtenerJuegoIdSc2();
      setJuegoIdSc2(idSc2);
      if (!idSc2) return;

      const { data } = await supabase
        .from("perfiles_juego")
        .select("datos")
        .eq("user_id", user.id)
        .eq("juego_id", idSc2)
        .maybeSingle();

      const datos = data?.datos as DatosSc2 | undefined;
      setRazaPrincipal(datos?.raza_principal ?? "");
      setRazaSecundaria(datos?.raza_secundaria ?? "");
    })();
  }, [user]);

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

  const cargarTitulos = async () => {
    if (!user) {
      setTitulosPendientesResponder([]);
      setTitulosPropuestosPorMi([]);
      return;
    }

    const { data: titulosData } = await supabase
      .from("titulos_padre_hijo")
      .select("*")
      .eq("tipo", "jugador")
      .eq("status", "pendiente")
      .or(`retador_id.eq.${user.id},retado_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    const userIds = [...new Set((titulosData ?? []).flatMap((t) => [t.retador_id, t.retado_id]))];
    let nombrePorUserId: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: perfilesData } = await supabase.from("profiles").select("id, nick, unique_id").in("id", userIds);
      nombrePorUserId = Object.fromEntries(
        (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
      );
    }

    const titulosResueltos: TituloJugadorConNombre[] = (titulosData ?? []).map((t) => ({
      id: t.id,
      retadorId: t.retador_id,
      retadorNombre: nombrePorUserId[t.retador_id] ?? "Jugador de RemorApp",
      retadoId: t.retado_id,
      retadoNombre: nombrePorUserId[t.retado_id] ?? "Jugador de RemorApp",
      duracionDias: t.duracion_dias,
      aceptado: t.aceptado,
    }));

    setTitulosPendientesResponder(titulosResueltos.filter((t) => !t.aceptado && t.retadoId === user.id));
    setTitulosPropuestosPorMi(titulosResueltos.filter((t) => t.retadorId === user.id));
  };

  useEffect(() => {
    cargarTitulos();
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

  const handleBuscarRivalTitulo = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusquedaTitulo(null);
    setRivalTitulo(null);
    setTituloEnviado(false);

    const partes = busquedaNickTitulo.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorBusquedaTitulo("Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.");
      return;
    }
    const [nickBuscado, uniqueIdBuscado] = partes;

    setBuscandoTitulo(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nick, unique_id")
      .eq("nick", nickBuscado)
      .eq("unique_id", uniqueIdBuscado)
      .maybeSingle();
    setBuscandoTitulo(false);

    if (error || !data) {
      setErrorBusquedaTitulo("No encontré a nadie con ese Nick#ID.");
      return;
    }

    setRivalTitulo({ id: data.id, nick: data.nick ?? nickBuscado, uniqueId: data.unique_id });
  };

  const handleProponerTitulo = async () => {
    if (!rivalTitulo) return;

    setErrorTitulo(null);
    const duracion = Number(duracionTitulo);

    if (!duracion || duracion < 7 || duracion > 90) {
      setErrorTitulo("La duración tiene que ser entre 7 y 90 días.");
      return;
    }
    if (!casterNombreTitulo.trim() || !casterLinkTitulo.trim()) {
      setErrorTitulo("El caster y su link son obligatorios para un título entre jugadores.");
      return;
    }

    setProponiendoTitulo(true);

    // proponer_titulo_padre_hijo() (en la base) es la que de verdad
    // valida la duración y exige el caster -- esto de acá es solo el
    // formulario.
    const { error } = await supabase.rpc("proponer_titulo_padre_hijo", {
      p_tipo: "jugador",
      p_retado_id: rivalTitulo.id,
      p_duracion_dias: duracion,
      p_caster_nombre: casterNombreTitulo.trim(),
      p_caster_link: casterLinkTitulo.trim(),
    });

    setProponiendoTitulo(false);

    if (error) {
      setErrorTitulo(error.message);
      return;
    }

    setTituloEnviado(true);
    setRivalTitulo(null);
    setBusquedaNickTitulo("");
    setCasterNombreTitulo("");
    setCasterLinkTitulo("");
    await cargarTitulos();
  };

  const handleResponderTitulo = async (tituloId: string, aceptar: boolean) => {
    setRespondiendoTitulo(tituloId);
    setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: "" }));

    const { error } = await supabase.rpc("responder_titulo_padre_hijo", {
      p_titulo_id: tituloId,
      p_aceptar: aceptar,
    });

    setRespondiendoTitulo(null);

    if (error) {
      setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: error.message }));
      return;
    }

    await cargarTitulos();
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

  const handleGuardarRaza = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !juegoIdSc2) return;

    setGuardandoRaza(true);
    setErrorRaza(null);
    setRazaGuardada(false);

    const datos: DatosSc2 = {
      raza_principal: razaPrincipal || null,
      raza_secundaria: razaSecundaria || null,
    };

    const { error } = await supabase
      .from("perfiles_juego")
      .upsert({ user_id: user.id, juego_id: juegoIdSc2, datos }, { onConflict: "user_id,juego_id" });

    setGuardandoRaza(false);

    if (error) {
      setErrorRaza(error.message);
      return;
    }

    setRazaGuardada(true);
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

  const handleCambiarFormaAvatar = async (nuevaForma: AvatarForma) => {
    if (!user || nuevaForma === profile?.avatar_forma) return;

    setGuardandoForma(true);
    setErrorForma(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_forma: nuevaForma })
      .eq("id", user.id);

    setGuardandoForma(false);

    if (updateError) {
      setErrorForma(updateError.message);
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

      <h2 className="detail-subtitle">Títulos Padre/Hijo</h2>
      <p className="tournament-card-meta">
        Se resuelven solos cuando ganas o pierdes una partida 1v1 real contra el rival, en cualquier
        torneo.
      </p>

      <h3 className="detail-subtitle">Pendientes de responder</h3>
      {titulosPendientesResponder.length === 0 ? (
        <p className="detail-empty">No tienes retos de título pendientes de responder.</p>
      ) : (
        <div className="detail-participant-list">
          {titulosPendientesResponder.map((t) => (
            <div key={t.id} className="reto-item">
              <p className="reto-desc">
                {t.retadorNombre} te reta a un título ({t.duracionDias} días)
              </p>
              {erroresResponderTitulo[t.id] && (
                <div className="form-error">{erroresResponderTitulo[t.id]}</div>
              )}
              <div className="invitation-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={respondiendoTitulo === t.id}
                  onClick={() => handleResponderTitulo(t.id, true)}
                >
                  Aceptar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={respondiendoTitulo === t.id}
                  onClick={() => handleResponderTitulo(t.id, false)}
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Propuestos por mí</h3>
      {titulosPropuestosPorMi.length === 0 ? (
        <p className="detail-empty">No propusiste ningún título.</p>
      ) : (
        <div className="detail-participant-list">
          {titulosPropuestosPorMi.map((t) => (
            <div key={t.id} className="reto-item">
              <p className="reto-desc">
                Título contra {t.retadoNombre} ({t.duracionDias} días)
                <span className="reto-status">
                  {t.aceptado ? "Acordado, esperando la partida" : "Esperando respuesta"}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Proponer un título</h3>
      <form className="auth-form" onSubmit={handleBuscarRivalTitulo}>
        {errorBusquedaTitulo && <div className="form-error">{errorBusquedaTitulo}</div>}
        {tituloEnviado && <div className="form-success">¡Título propuesto!</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="titulo-buscar-nick">
            Nick#ID del rival
          </label>
          <input
            id="titulo-buscar-nick"
            className="form-input"
            type="text"
            placeholder="CarpeDiem#12345"
            value={busquedaNickTitulo}
            onChange={(e) => setBusquedaNickTitulo(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-ghost btn-block" disabled={buscandoTitulo}>
          {buscandoTitulo ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {rivalTitulo && (
        <div className="detail-participant-item">
          {rivalTitulo.nick}
          <span className="profile-nick-id">#{rivalTitulo.uniqueId}</span>
        </div>
      )}

      {rivalTitulo && (
        <div className="auth-form">
          {errorTitulo && <div className="form-error">{errorTitulo}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-duracion-jugador">
              Duración (entre 7 y 90 días)
            </label>
            <input
              id="titulo-duracion-jugador"
              className="form-input"
              type="number"
              min={7}
              max={90}
              value={duracionTitulo}
              onChange={(e) => setDuracionTitulo(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-caster-nombre">
              Nombre del caster
            </label>
            <input
              id="titulo-caster-nombre"
              className="form-input"
              type="text"
              value={casterNombreTitulo}
              onChange={(e) => setCasterNombreTitulo(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-caster-link">
              Link de la transmisión
            </label>
            <input
              id="titulo-caster-link"
              className="form-input"
              type="text"
              value={casterLinkTitulo}
              onChange={(e) => setCasterLinkTitulo(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={proponiendoTitulo}
            onClick={handleProponerTitulo}
          >
            {proponiendoTitulo ? "Proponiendo..." : "Proponer título"}
          </button>
        </div>
      )}

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
        <>
          <MmrProgressBar mmr={profile.mmr_1v1} liga={profile.liga_1v1} bancaRota={profile.banca_rota} />
          {profile.poco_confiable && (
            <span className="nivel-badge nivel-badge-banca-rota">Poco Responsable</span>
          )}
          <PercentBar label="Valentía" value={profile.valentia_jugador} />
          <PercentBar label="Responsabilidad en Clan Wars" value={profile.responsabilidad_cw} />
          <TitulosActivosList tipo="jugador" id={profile.id} className="detail-map-list" />
        </>
      )}

      <h2 className="detail-subtitle">Configuración general</h2>
      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={pestanaActiva === "datos"}
          className={`settings-tab ${pestanaActiva === "datos" ? "active" : ""}`}
          onClick={() => setPestanaActiva("datos")}
        >
          Editar datos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pestanaActiva === "apariencia"}
          className={`settings-tab ${pestanaActiva === "apariencia" ? "active" : ""}`}
          onClick={() => setPestanaActiva("apariencia")}
        >
          Apariencia
        </button>
      </div>

      {pestanaActiva === "datos" && (
        <div className="settings-panel">
          <div className="profile-avatar-section">
            <Avatar
              url={avatarPreview ?? profile?.avatar_url}
              nombre={profile?.nick ?? profile?.nombre}
              className="profile-avatar"
              forma={profile?.avatar_forma}
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

            {/* Agrupa visualmente esto y los dos siguientes (ID de SC2,
                liga) bajo "StarCraft II", igual que la raza más abajo,
                aunque técnicamente sigan viviendo en profiles -- ver el
                pedido del perfil de juego agnóstico. */}
            <h3 className="detail-subtitle">StarCraft II</h3>

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

          {/* Raza principal/secundaria: perfiles_juego, no profiles --
              se guarda aparte, con su propio botón, aunque quede
              agrupada bajo "StarCraft II" con lo de arriba. Opcional,
              no bloquea cuenta_validada. */}
          <form className="auth-form" onSubmit={handleGuardarRaza}>
            {errorRaza && <div className="form-error">{errorRaza}</div>}
            {razaGuardada && <div className="form-success">Tu raza se guardó correctamente.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-raza-principal">
                Raza principal
              </label>
              <select
                id="perfil-raza-principal"
                className="form-select"
                value={razaPrincipal}
                onChange={(e) => setRazaPrincipal(e.target.value as RazaSc2)}
              >
                <option value="">Prefiero no decirlo</option>
                {RAZA_SC2_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-raza-secundaria">
                Raza secundaria (opcional)
              </label>
              <select
                id="perfil-raza-secundaria"
                className="form-select"
                value={razaSecundaria}
                onChange={(e) => setRazaSecundaria(e.target.value as RazaSc2)}
              >
                <option value="">Ninguna</option>
                {RAZA_SC2_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn-ghost btn-block" disabled={guardandoRaza || !juegoIdSc2}>
              {guardandoRaza ? "Guardando..." : "Guardar raza"}
            </button>
          </form>

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
          </div>
        </div>
      )}

      {pestanaActiva === "apariencia" && (
        <div className="settings-panel">
          <p className="tournament-card-meta">
            Elige cómo se ve RemorApp en este dispositivo. La elección se guarda solo en tu navegador.
          </p>
          <div className="pill-radio-group">
            <label className={`pill-radio-option ${tema === "oscuro" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="tema-visual"
                checked={tema === "oscuro"}
                onChange={() => setTema("oscuro")}
              />
              Oscuro
            </label>
            <label className={`pill-radio-option ${tema === "claro" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="tema-visual"
                checked={tema === "claro"}
                onChange={() => setTema("claro")}
              />
              Claro
            </label>
          </div>

          <h3 className="detail-subtitle">Forma del avatar</h3>
          {errorForma && <div className="form-error">{errorForma}</div>}
          <div className="avatar-forma-options">
            <button
              type="button"
              className={`avatar-forma-option ${profile?.avatar_forma === "cuadrado" ? "selected" : ""}`}
              disabled={guardandoForma}
              onClick={() => handleCambiarFormaAvatar("cuadrado")}
            >
              <span className="avatar-forma-preview avatar-shape-cuadrado" />
              Cuadrado
            </button>
            <button
              type="button"
              className={`avatar-forma-option ${profile?.avatar_forma === "redondo" ? "selected" : ""}`}
              disabled={guardandoForma}
              onClick={() => handleCambiarFormaAvatar("redondo")}
            >
              <span className="avatar-forma-preview avatar-shape-redondo" />
              Redondo
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
