import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { recortarImagenCuadrada, recortarImagenConProporcion } from "../lib/teams";
import { formatFecha } from "../lib/formatters";
import { SC2_REGION_OPTIONS } from "../types/profile";
import type { TeamRow } from "../types/teams";
import Avatar from "../components/Avatar";
import LigaBadge from "../components/LigaBadge";
import MmrProgressBar from "../components/MmrProgressBar";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BANNER_MAX_BYTES = 3 * 1024 * 1024;

interface MiembroConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  avatarUrl: string | null;
  // Liga autodeclarada por el jugador en /perfil (independiente del
  // MMR calculado, ver types/profile.ts) -- se muestra aparte.
  liga: string | null;
  // MMR/liga de equipos (migración 020): el rating personal de este
  // jugador jugando en formato de equipo, no su MMR de 1v1.
  mmrEquipos: number;
  ligaEquipos: string;
  bancaRota: boolean;
  roles: string[];
}

interface JugadorEncontrado {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
}

interface ExpulsadoConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  kickedAt: string;
}

// team_kicks_log.user_id apunta a profiles.id, igual que
// team_members.user_id -- mismo patrón de extracción.
function extraerPerfilBasico(profiles: unknown): { nick: string | null; unique_id: string | null } {
  const perfil = Array.isArray(profiles) ? profiles[0] : profiles;
  return {
    nick: (perfil as { nick?: string } | undefined)?.nick ?? null,
    unique_id: (perfil as { unique_id?: string } | undefined)?.unique_id ?? null,
  };
}

// team_members.user_id apunta a profiles.id (no a auth.users como
// tournament_participants), así que acá sí hay join automático de
// PostgREST -- no hace falta una segunda consulta aparte.
function extraerPerfil(profiles: unknown): {
  nick: string | null;
  unique_id: string | null;
  avatar_url: string | null;
  liga: string | null;
  mmr_equipos: number;
  liga_equipos: string;
  banca_rota: boolean;
} {
  const perfil = Array.isArray(profiles) ? profiles[0] : profiles;
  return {
    nick: (perfil as { nick?: string } | undefined)?.nick ?? null,
    unique_id: (perfil as { unique_id?: string } | undefined)?.unique_id ?? null,
    avatar_url: (perfil as { avatar_url?: string } | undefined)?.avatar_url ?? null,
    liga: (perfil as { liga?: string } | undefined)?.liga ?? null,
    mmr_equipos: (perfil as { mmr_equipos?: number } | undefined)?.mmr_equipos ?? 1000,
    liga_equipos: (perfil as { liga_equipos?: string } | undefined)?.liga_equipos ?? "Bronce 3",
    banca_rota: (perfil as { banca_rota?: boolean } | undefined)?.banca_rota ?? false,
  };
}

export default function TeamDetailPage() {
  const { tag } = useParams<{ tag: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [equipo, setEquipo] = useState<TeamRow | null>(null);
  const [miembros, setMiembros] = useState<MiembroConNombre[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // --- Panel de líder: editar descripción/logo/banner ---
  const [descEquipo, setDescEquipo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardandoEquipo, setGuardandoEquipo] = useState(false);
  const [errorEquipo, setErrorEquipo] = useState<string | null>(null);
  const [equipoGuardado, setEquipoGuardado] = useState(false);

  // --- Panel de control: código de invitación y quitar miembros ---
  const [codigoCopiado, setCodigoCopiado] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null);
  // El panel entero vive colapsado atrás de un botón -- nada de esto
  // se ve desperdigado en la página, solo cuando el dueño lo abre.
  const [panelAbierto, setPanelAbierto] = useState(false);

  // --- Salir del equipo (cualquier miembro que no sea el dueño, o el
  // dueño cuando es el único miembro que queda) ---
  const [saliendo, setSaliendo] = useState(false);
  const [errorSalir, setErrorSalir] = useState<string | null>(null);

  // --- Panel de control: transferir liderazgo ---
  const [nuevoLiderId, setNuevoLiderId] = useState("");
  const [transfiriendo, setTransfiriendo] = useState(false);
  const [errorTransferir, setErrorTransferir] = useState<string | null>(null);

  // --- Panel de control: buscar e invitar por Nick#ID ---
  const [busquedaNick, setBusquedaNick] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [resultadoBusqueda, setResultadoBusqueda] = useState<JugadorEncontrado | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [invitacionEnviada, setInvitacionEnviada] = useState(false);

  // --- Panel de control: jugadores expulsados ---
  const [expulsados, setExpulsados] = useState<ExpulsadoConNombre[]>([]);

  const cargar = async () => {
    if (!tag) return;

    const { data: equipoData, error } = await supabase
      .from("teams")
      .select("*")
      .eq("tag", tag.toUpperCase())
      .maybeSingle();

    if (error || !equipoData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Se evalúa acá, cada vez que se entra a la página del equipo --
    // si este equipo lleva 30 días en banca rota sin actividad, lo
    // restaura a 1000 MMR antes de mostrar sus datos. Mismo patrón
    // que restaurar_banca_rota_perfil() en AuthContext: no hace falta
    // un cron, la función no hace nada si todavía no corresponde.
    // Solo tiene sentido si hay sesión (la función es authenticated).
    if (user) {
      await supabase.rpc("restaurar_banca_rota_equipo", { p_team_id: equipoData.id });
      const { data: equipoActualizado } = await supabase
        .from("teams")
        .select("*")
        .eq("id", equipoData.id)
        .single();
      if (equipoActualizado) Object.assign(equipoData, equipoActualizado);
    }

    setEquipo(equipoData as TeamRow);
    setDescEquipo(equipoData.description ?? "");

    const { data: miembrosData } = await supabase
      .from("team_members")
      .select("user_id, roles, profiles(nick, unique_id, avatar_url, liga, mmr_equipos, liga_equipos, banca_rota)")
      .eq("team_id", equipoData.id)
      .order("joined_at", { ascending: true });

    setMiembros(
      (miembrosData ?? []).map((m) => {
        const perfil = extraerPerfil(m.profiles);
        return {
          userId: m.user_id,
          nick: perfil.nick,
          uniqueId: perfil.unique_id,
          avatarUrl: perfil.avatar_url,
          liga: perfil.liga,
          mmrEquipos: perfil.mmr_equipos,
          ligaEquipos: perfil.liga_equipos,
          bancaRota: perfil.banca_rota,
          roles: m.roles as string[],
        };
      })
    );

    // Solo el dueño ve el historial de expulsados (la RLS de
    // team_kicks_log ya lo exige igual, esto es solo para no pedirlo
    // de más cuando no hace falta).
    if (user && equipoData.owner_id === user.id) {
      const { data: expulsadosData } = await supabase
        .from("team_kicks_log")
        .select("user_id, kicked_at, profiles!user_id(nick, unique_id)")
        .eq("team_id", equipoData.id)
        .order("kicked_at", { ascending: false });

      setExpulsados(
        (expulsadosData ?? []).map((e) => {
          const perfil = extraerPerfilBasico(e.profiles);
          return {
            userId: e.user_id,
            nick: perfil.nick,
            uniqueId: perfil.unique_id,
            kickedAt: e.kicked_at,
          };
        })
      );
    } else {
      setExpulsados([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, user?.id]);

  if (loading) {
    return (
      <section className="section section-page">
        <p className="tournament-card-meta">Cargando equipo...</p>
      </section>
    );
  }

  if (notFound || !equipo) {
    return (
      <section className="page-placeholder">
        <h1>Equipo no encontrado</h1>
        <p>
          <Link to="/equipos" className="btn-link">
            Volver a equipos
          </Link>
        </p>
      </section>
    );
  }

  const esDueño = !!user && equipo.owner_id === user.id;
  const miMembresia = miembros.find((m) => m.userId === user?.id);
  const esMiembroNoOwner = !!miMembresia && !miMembresia.roles.includes("owner");

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorEquipo(null);

    if (!archivo) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }

    if (archivo.size > LOGO_MAX_BYTES) {
      setErrorEquipo("El logo no puede pesar más de 2MB.");
      event.target.value = "";
      return;
    }

    setLogoFile(archivo);
    setLogoPreview(URL.createObjectURL(archivo));
  };

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorEquipo(null);

    if (!archivo) {
      setBannerFile(null);
      setBannerPreview(null);
      return;
    }

    if (archivo.size > BANNER_MAX_BYTES) {
      setErrorEquipo("El banner no puede pesar más de 3MB.");
      event.target.value = "";
      return;
    }

    setBannerFile(archivo);
    setBannerPreview(URL.createObjectURL(archivo));
  };

  const handleGuardarEquipo = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardandoEquipo(true);
    setErrorEquipo(null);
    setEquipoGuardado(false);

    const cambios: { description: string | null; logo_url?: string; banner_url?: string } = {
      description: descEquipo.trim() || null,
    };

    try {
      if (logoFile) {
        const recorte = await recortarImagenCuadrada(logoFile);
        const extension = logoFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-logo.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("team-logos")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorEquipo("No se pudo subir el logo: " + uploadError.message);
          setGuardandoEquipo(false);
          return;
        }

        cambios.logo_url = supabase.storage.from("team-logos").getPublicUrl(ruta).data.publicUrl;
      }

      if (bannerFile) {
        const recorte = await recortarImagenConProporcion(bannerFile, 4);
        const extension = bannerFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("team-banners")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorEquipo("No se pudo subir el banner: " + uploadError.message);
          setGuardandoEquipo(false);
          return;
        }

        cambios.banner_url = supabase.storage.from("team-banners").getPublicUrl(ruta).data.publicUrl;
      }
    } catch {
      setErrorEquipo("No se pudo procesar alguna de las imágenes, prueba con otra.");
      setGuardandoEquipo(false);
      return;
    }

    const { error: updateError } = await supabase.from("teams").update(cambios).eq("id", equipo.id);

    setGuardandoEquipo(false);

    if (updateError) {
      setErrorEquipo(updateError.message);
      return;
    }

    setLogoFile(null);
    setLogoPreview(null);
    setBannerFile(null);
    setBannerPreview(null);
    setEquipoGuardado(true);
    await cargar();
  };

  const handleCopiarCodigo = async () => {
    await navigator.clipboard.writeText(equipo.invite_code);
    setCodigoCopiado(true);
    setTimeout(() => setCodigoCopiado(false), 2000);
  };

  const handleQuitarMiembro = async (userId: string) => {
    if (!window.confirm("¿Seguro que quieres sacar a este jugador del equipo?")) return;

    setQuitando(userId);
    setErrorQuitar(null);

    const { error } = await supabase.rpc("quitar_miembro", {
      p_team_id: equipo.id,
      p_user_id: userId,
    });

    setQuitando(null);

    if (error) {
      setErrorQuitar(error.message);
      return;
    }

    // Recarga en vez de solo filtrar en memoria: quitar_miembro() ahora
    // también deja registro en team_kicks_log, y "Jugadores expulsados"
    // tiene que verlo reflejado al toque.
    await cargar();
  };

  const handleSalirEquipo = async () => {
    const soyUnicoMiembro = miembros.length === 1;
    const mensaje = soyUnicoMiembro
      ? "¿Seguro que quieres salir? Como eres el único miembro, el equipo quedará disuelto y dejará de aparecer en el buscador."
      : "¿Seguro que quieres salir del equipo?";
    if (!window.confirm(mensaje)) return;

    setSaliendo(true);
    setErrorSalir(null);

    // salir_equipo() (en la base) es la que de verdad decide si esto
    // es una salida normal o, si sos el único miembro, una disolución
    // del equipo -- acá solo se manda la orden y se navega afuera.
    const { error } = await supabase.rpc("salir_equipo");

    setSaliendo(false);

    if (error) {
      setErrorSalir(error.message);
      return;
    }

    navigate("/equipos");
  };

  const handleTransferirLiderazgo = async (event: FormEvent) => {
    event.preventDefault();
    if (!nuevoLiderId) return;
    if (!window.confirm("¿Confirmas que quieres transferir el liderazgo de este equipo?")) return;

    setTransfiriendo(true);
    setErrorTransferir(null);

    const { error } = await supabase.rpc("transferir_liderazgo", {
      p_nuevo_owner_id: nuevoLiderId,
    });

    setTransfiriendo(false);

    if (error) {
      setErrorTransferir(error.message);
      return;
    }

    setNuevoLiderId("");
    await cargar();
  };

  const handleBuscarJugador = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusqueda(null);
    setResultadoBusqueda(null);
    setInvitacionEnviada(false);

    const partes = busquedaNick.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorBusqueda("Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.");
      return;
    }
    const [nickBuscado, uniqueIdBuscado] = partes;

    setBuscando(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nick, unique_id, avatar_url")
      .eq("nick", nickBuscado)
      .eq("unique_id", uniqueIdBuscado)
      .maybeSingle();
    setBuscando(false);

    if (error || !data) {
      setErrorBusqueda("No encontré a nadie con ese Nick#ID.");
      return;
    }

    setResultadoBusqueda({
      id: data.id,
      nick: data.nick ?? nickBuscado,
      uniqueId: data.unique_id,
      avatarUrl: data.avatar_url,
    });
  };

  const handleInvitar = async () => {
    if (!resultadoBusqueda) return;

    setInvitando(true);
    setErrorBusqueda(null);

    // invitar_jugador() (en la base) es la que de verdad chequea que
    // seas el dueño, que el jugador no tenga equipo, y que no haya ya
    // una invitación pendiente -- esto de acá es solo el formulario.
    const { error } = await supabase.rpc("invitar_jugador", {
      p_team_id: equipo.id,
      p_invited_user_id: resultadoBusqueda.id,
    });

    setInvitando(false);

    if (error) {
      setErrorBusqueda(error.message);
      return;
    }

    setInvitacionEnviada(true);
    setResultadoBusqueda(null);
    setBusquedaNick("");
  };

  const renderMiembro = (m: MiembroConNombre, conControles: boolean) => (
    <div key={m.userId} className="detail-participant-item">
      <Avatar url={m.avatarUrl} nombre={m.nick} className="detail-participant-avatar" />
      {m.nick ?? "Jugador de RemorApp"}
      {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
      {m.liga && <span className="liga-badge">{m.liga}</span>}
      <LigaBadge liga={m.ligaEquipos} mmr={m.mmrEquipos} bancaRota={m.bancaRota} />
      {m.roles.includes("owner") && <span className="team-owner-badge">Dueño</span>}
      {conControles && !m.roles.includes("owner") && (
        <button
          type="button"
          className="btn btn-ghost team-kick-btn"
          disabled={quitando === m.userId}
          onClick={() => handleQuitarMiembro(m.userId)}
        >
          {quitando === m.userId ? "Quitando..." : "Quitar del equipo"}
        </button>
      )}
    </div>
  );

  return (
    <section className="section section-page">
      <div className="team-detail-banner-wrap">
        {equipo.banner_url ? (
          <img src={equipo.banner_url} alt="" className="team-detail-banner" />
        ) : (
          <div className="team-detail-banner team-detail-banner-placeholder" />
        )}
        <div className="team-detail-logo-overlap">
          {equipo.logo_url ? (
            <img src={equipo.logo_url} alt={equipo.name} className="team-detail-logo" />
          ) : (
            <div className="team-detail-logo team-card-logo-placeholder">{equipo.tag.charAt(0)}</div>
          )}
        </div>
      </div>

      {/* La descripción va inmediatamente debajo del banner, antes de
          cualquier otra cosa -- a propósito, no es un detalle menor
          en la página. */}
      {equipo.description && <p className="team-detail-description">{equipo.description}</p>}

      <MmrProgressBar mmr={equipo.mmr} liga={equipo.liga} bancaRota={equipo.banca_rota} />

      <div className="team-detail-header">
        <div>
          <h1 className="section-title">
            {equipo.name}
            <LigaBadge
              liga={equipo.liga}
              mmr={equipo.mmr}
              bancaRota={equipo.banca_rota}
              className="nivel-badge-grande"
            />
          </h1>
          <p className="tournament-card-meta">
            [{equipo.tag}] · {miembros.length} {miembros.length === 1 ? "miembro" : "miembros"}
          </p>
        </div>
      </div>

      {/* Acceso adicional a /equipos, no un reemplazo: "Mi equipo" en
          el abanico sigue llevando directo acá cuando ya tienes clan,
          así que sin esto no había ninguna forma de volver al
          buscador general una vez que perteneces a un equipo. */}
      <p className="tournament-card-meta">
        <Link to="/equipos" className="btn-link">
          Explorar otros equipos
        </Link>
      </p>

      <div className="detail-map-list">
        {equipo.sc2_regions.map((region) => (
          <span key={region} className="badge badge-format">
            {SC2_REGION_OPTIONS.find((o) => o.value === region)?.label ?? region}
          </span>
        ))}
      </div>

      <h2 className="detail-subtitle">Miembros</h2>
      <div className="detail-participant-list">{miembros.map((m) => renderMiembro(m, false))}</div>

      {esMiembroNoOwner && (
        <div className="detail-register-box">
          {errorSalir && <div className="form-error">{errorSalir}</div>}
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={saliendo}
            onClick={handleSalirEquipo}
          >
            {saliendo ? "Saliendo..." : "Salir del equipo"}
          </button>
        </div>
      )}

      {esDueño && (
        <div className="team-control-panel-wrap">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => setPanelAbierto((abierto) => !abierto)}
          >
            {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
          </button>

          {panelAbierto && (
            <div className="team-leader-panel">
              <div className="team-leader-invite">
                <span className="team-leader-invite-code">{equipo.invite_code}</span>
                <button type="button" className="btn btn-ghost" onClick={handleCopiarCodigo}>
                  {codigoCopiado ? "¡Copiado!" : "Copiar código"}
                </button>
              </div>

              {/* El dueño no puede simplemente "salir": si hay más
                  miembros, primero tiene que transferir el liderazgo.
                  Recién cuando queda como único miembro, salir del
                  equipo disuelve el equipo en vez de dejarlo sin
                  dueño. */}
              {miembros.length > 1 ? (
                <>
                  <h3 className="detail-subtitle">Transferir liderazgo</h3>
                  {errorTransferir && <div className="form-error">{errorTransferir}</div>}
                  <form className="auth-form" onSubmit={handleTransferirLiderazgo}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-nuevo-lider">
                        Nuevo dueño del equipo
                      </label>
                      <select
                        id="team-nuevo-lider"
                        className="form-input"
                        value={nuevoLiderId}
                        onChange={(e) => setNuevoLiderId(e.target.value)}
                      >
                        <option value="">Selecciona un miembro</option>
                        {miembros
                          .filter((m) => !m.roles.includes("owner"))
                          .map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.nick ?? "Jugador de RemorApp"}
                              {m.uniqueId ? `#${m.uniqueId}` : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="btn btn-ghost btn-block"
                      disabled={transfiriendo || !nuevoLiderId}
                    >
                      {transfiriendo ? "Transfiriendo..." : "Transferir liderazgo"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h3 className="detail-subtitle">Salir del equipo</h3>
                  <p className="tournament-card-meta">
                    Eres el único miembro. Si sales, el equipo quedará disuelto y dejará de
                    aparecer en el buscador público.
                  </p>
                  {errorSalir && <div className="form-error">{errorSalir}</div>}
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    disabled={saliendo}
                    onClick={handleSalirEquipo}
                  >
                    {saliendo ? "Saliendo..." : "Salir del equipo"}
                  </button>
                </>
              )}

              <form className="auth-form" onSubmit={handleGuardarEquipo}>
            {errorEquipo && <div className="form-error">{errorEquipo}</div>}
            {equipoGuardado && <div className="form-success">Los cambios del equipo se guardaron.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-descripcion">
                Descripción
              </label>
              <textarea
                id="team-edit-descripcion"
                className="form-textarea"
                maxLength={280}
                value={descEquipo}
                onChange={(e) => setDescEquipo(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-logo">
                Logo (opcional, máx. 2MB, se recorta a 1:1)
              </label>
              <input
                id="team-edit-logo"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoChange}
              />
              {(logoPreview ?? equipo.logo_url) && (
                <img
                  src={logoPreview ?? equipo.logo_url ?? ""}
                  alt="Vista previa del logo"
                  className="team-logo-preview"
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-banner">
                Banner (opcional, máx. 3MB, se recorta a 4:1)
              </label>
              <input
                id="team-edit-banner"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerChange}
              />
              {(bannerPreview ?? equipo.banner_url) && (
                <img
                  src={bannerPreview ?? equipo.banner_url ?? ""}
                  alt="Vista previa del banner"
                  className="team-banner-preview"
                />
              )}
            </div>

            <p className="form-hint">
              El nombre y el tag del equipo no se pueden cambiar por ahora.
            </p>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardandoEquipo}>
              {guardandoEquipo ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>

              <h3 className="detail-subtitle">Invitar jugador</h3>
              <form className="auth-form" onSubmit={handleBuscarJugador}>
                {errorBusqueda && <div className="form-error">{errorBusqueda}</div>}
                {invitacionEnviada && <div className="form-success">¡Invitación enviada!</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="team-invitar-nick">
                    Nick#ID del jugador
                  </label>
                  <input
                    id="team-invitar-nick"
                    className="form-input"
                    type="text"
                    placeholder="CarpeDiem#12345"
                    value={busquedaNick}
                    onChange={(e) => setBusquedaNick(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-ghost btn-block" disabled={buscando}>
                  {buscando ? "Buscando..." : "Buscar"}
                </button>
              </form>

              {resultadoBusqueda && (
                <div className="detail-participant-item">
                  <Avatar
                    url={resultadoBusqueda.avatarUrl}
                    nombre={resultadoBusqueda.nick}
                    className="detail-participant-avatar"
                  />
                  {resultadoBusqueda.nick}
                  <span className="profile-nick-id">#{resultadoBusqueda.uniqueId}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={invitando}
                    onClick={handleInvitar}
                  >
                    {invitando ? "Invitando..." : "Invitar"}
                  </button>
                </div>
              )}

              <h3 className="detail-subtitle">Miembros del equipo</h3>
              {errorQuitar && <div className="form-error">{errorQuitar}</div>}
              <div className="detail-participant-list">{miembros.map((m) => renderMiembro(m, true))}</div>

              <h3 className="detail-subtitle">Jugadores expulsados</h3>
              {expulsados.length === 0 ? (
                <p className="detail-empty">Todavía no expulsaste a nadie.</p>
              ) : (
                <div className="detail-participant-list">
                  {expulsados.map((e) => (
                    <div key={e.userId + e.kickedAt} className="detail-participant-item">
                      {e.nick ?? "Jugador de RemorApp"}
                      {e.uniqueId && <span className="profile-nick-id">#{e.uniqueId}</span>}
                      <span className="tournament-card-meta">{formatFecha(e.kickedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
