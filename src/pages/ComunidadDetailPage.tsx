import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Users, Calendar, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { comprimirImagen } from "../lib/imageCompression";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { formatFecha } from "../lib/formatters";
import { obtenerEventosDeComunidad } from "../lib/comunidades";
import Avatar from "../components/Avatar";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import type { ComunidadRow, EventoComunidad } from "../types/comunidades";
import type { AvatarForma } from "../types/profile";
import { TEMAS_EQUIPO } from "../types/teams";
import type { TemaEquipo } from "../types/teams";

const LOGO_MAX_BYTES = 15 * 1024 * 1024;

interface MiembroConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
}

// Ficha pública de una comunidad (migración 198, a pedido del
// usuario): banner, logo, lista de integrantes y, para quien la
// creó, un Panel de control (editar banner/logo/descripción,
// eliminarla). "Crear evento de comunidad" manda al mismo formulario
// de siempre (CreateTournamentPage) con esta comunidad precargada.
export default function ComunidadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [comunidad, setComunidad] = useState<ComunidadRow | null>(null);
  const [miembros, setMiembros] = useState<MiembroConNombre[]>([]);
  const [eventos, setEventos] = useState<EventoComunidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [uniendose, setUniendose] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  // Migración 200/202, a pedido del usuario: Panel de control ordenado
  // en pestañas hermanas (Apariencia/Descripción/Logo/Banner/
  // Integrantes), mismo lenguaje visual que "Configuración" de Mi Clan
  // (.team-config-media-tabs/.team-config-media-tab). "Apariencia" es
  // el selector de color (como tournaments.tema_equipo) -- la
  // descripción tiene su propia pestaña aparte, antes vivía (mal
  // etiquetada) dentro de "Apariencia".
  const [tabConfig, setTabConfig] = useState<"apariencia" | "descripcion" | "logo" | "banner" | "integrantes">(
    "apariencia"
  );
  const [guardandoTema, setGuardandoTema] = useState(false);

  const [descripcion, setDescripcion] = useState("");
  const [archivoParaRecortarLogo, setArchivoParaRecortarLogo] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [archivoParaRecortarBanner, setArchivoParaRecortarBanner] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<Blob | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  // Integrantes (migración 200, a pedido del usuario): buscar e
  // invitar por Nick#ID, mismo patrón que "buscar e invitar" de Mi
  // Clan (TeamDetailPage.tsx) -- la diferencia es que acá se suma
  // directo (comunidad_miembros_unirse_propio exige user_id =
  // auth.uid(), así que esto usa una política aparte para el creador:
  // ver migration_200). Como unirse es libre, no hace falta pasar por
  // una invitación que alguien deba aceptar.
  const [busquedaNick, setBusquedaNick] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [resultadoBusqueda, setResultadoBusqueda] = useState<MiembroConNombre | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [quitandoUserId, setQuitandoUserId] = useState<string | null>(null);

  const cargarComunidad = async () => {
    if (!id) return;
    setCargando(true);

    const { data, error } = await supabase.from("comunidades").select("*").eq("id", id).maybeSingle();

    if (error || !data) {
      setNotFound(true);
      setCargando(false);
      return;
    }

    setComunidad(data as ComunidadRow);
    setDescripcion((data as ComunidadRow).descripcion ?? "");

    const { data: miembrosData } = await supabase
      .from("comunidad_miembros")
      .select("user_id, profiles(nick, unique_id, avatar_url, avatar_forma)")
      .eq("comunidad_id", id);

    setMiembros(
      (miembrosData ?? []).map((m) => {
        const perfil = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return {
          userId: m.user_id as string,
          nick: perfil?.nick ?? null,
          uniqueId: perfil?.unique_id ?? null,
          avatarUrl: perfil?.avatar_url ?? null,
          avatarForma: perfil?.avatar_forma ?? "redondo",
        };
      })
    );

    setEventos(await obtenerEventosDeComunidad(id));

    setCargando(false);
  };

  useEffect(() => {
    cargarComunidad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (cargando) {
    return <p className="tournament-card-meta">Cargando comunidad...</p>;
  }

  if (notFound || !comunidad) {
    return (
      <section className="page-placeholder">
        <h1>Comunidad no encontrada</h1>
        <p>
          <Link to="/comunidades" className="btn-link">
            Volver a Comunidades
          </Link>
        </p>
      </section>
    );
  }

  const esCreador = user?.id === comunidad.creador_id;
  const esMiembro = !!user && miembros.some((m) => m.userId === user.id);

  const handleUnirse = async () => {
    if (!user) return;
    setUniendose(true);
    const { error } = await supabase.from("comunidad_miembros").insert({ comunidad_id: comunidad.id, user_id: user.id });
    setUniendose(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Te uniste a la comunidad.");
    cargarComunidad();
  };

  const handleSalir = async () => {
    if (!user) return;
    setUniendose(true);
    const { error } = await supabase.rpc("salir_comunidad", { p_comunidad_id: comunidad.id });
    setUniendose(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Saliste de la comunidad.");
    cargarComunidad();
  };

  const handleCambiarTema = async (nuevoTema: TemaEquipo) => {
    if (!user || nuevoTema === comunidad.tema_comunidad) return;
    setGuardandoTema(true);
    const { error } = await supabase.from("comunidades").update({ tema_comunidad: nuevoTema }).eq("id", comunidad.id);
    setGuardandoTema(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    cargarComunidad();
  };

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!archivo) return;
    if (archivo.size > LOGO_MAX_BYTES) {
      toast.error("El logo no puede pesar más de 15MB.");
      return;
    }
    setArchivoParaRecortarLogo(archivo);
  };

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!archivo) return;
    if (archivo.size > LOGO_MAX_BYTES) {
      toast.error("El banner no puede pesar más de 15MB.");
      return;
    }
    setArchivoParaRecortarBanner(archivo);
  };

  const handleGuardarPanel = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (descripcion.trim() && contieneLenguajeInapropiado(descripcion)) {
      toast.error("Esa descripción no está permitida.");
      return;
    }

    setGuardando(true);

    const cambios: { descripcion: string | null; logo_url?: string; banner_url?: string } = {
      descripcion: descripcion.trim() || null,
    };

    try {
      if (logoFile) {
        const logoComprimido = await comprimirImagen(logoFile, "logo");
        const extension = logoComprimido.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-logo.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("comunidad-logos")
          .upload(ruta, logoComprimido, { contentType: logoComprimido.type });
        if (uploadError) {
          toast.error("No se pudo subir el logo: " + uploadError.message);
          setGuardando(false);
          return;
        }
        cambios.logo_url = supabase.storage.from("comunidad-logos").getPublicUrl(ruta).data.publicUrl;
      }

      if (bannerFile) {
        const bannerComprimido = await comprimirImagen(bannerFile, "banner");
        const extension = bannerComprimido.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("comunidad-banners")
          .upload(ruta, bannerComprimido, { contentType: bannerComprimido.type });
        if (uploadError) {
          toast.error("No se pudo subir el banner: " + uploadError.message);
          setGuardando(false);
          return;
        }
        cambios.banner_url = supabase.storage.from("comunidad-banners").getPublicUrl(ruta).data.publicUrl;
      }
    } catch {
      toast.error("No se pudo procesar alguna de las imágenes, prueba con otra.");
      setGuardando(false);
      return;
    }

    const { error: updateError } = await supabase.from("comunidades").update(cambios).eq("id", comunidad.id);
    setGuardando(false);

    if (updateError) {
      toast.error(updateError.message);
      return;
    }

    toast.success("Comunidad actualizada.");
    setLogoFile(null);
    setLogoPreview(null);
    setBannerFile(null);
    setBannerPreview(null);
    cargarComunidad();
  };

  const handleEliminarComunidad = async () => {
    if (!window.confirm("¿Eliminar esta comunidad? No se puede deshacer.")) return;
    setEliminando(true);
    const { error } = await supabase.from("comunidades").delete().eq("id", comunidad.id);
    setEliminando(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Comunidad eliminada.");
    navigate("/comunidades");
  };

  const handleBuscarJugador = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusqueda(null);
    setResultadoBusqueda(null);

    const partes = busquedaNick.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorBusqueda("Escribe el Nick#ID completo, por ejemplo TuNick#BattleTag.");
      return;
    }
    const [nickBuscado, uniqueIdBuscado] = partes;

    setBuscando(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nick, unique_id, avatar_url, avatar_forma")
      .eq("nick", nickBuscado)
      .eq("unique_id", uniqueIdBuscado)
      .eq("es_cuenta_prueba", false)
      .maybeSingle();
    setBuscando(false);

    if (error || !data) {
      setErrorBusqueda("No encontré a nadie con ese Nick#ID.");
      return;
    }

    if (miembros.some((m) => m.userId === data.id)) {
      setErrorBusqueda("Ya es integrante de esta comunidad.");
      return;
    }

    setResultadoBusqueda({
      userId: data.id,
      nick: data.nick,
      uniqueId: data.unique_id,
      avatarUrl: data.avatar_url,
      avatarForma: data.avatar_forma ?? "redondo",
    });
  };

  const handleAgregarIntegrante = async () => {
    if (!resultadoBusqueda) return;
    setAgregando(true);
    const { error } = await supabase
      .from("comunidad_miembros")
      .insert({ comunidad_id: comunidad.id, user_id: resultadoBusqueda.userId });
    setAgregando(false);

    if (error) {
      setErrorBusqueda(error.message);
      return;
    }

    toast.success("Integrante agregado.");
    setResultadoBusqueda(null);
    setBusquedaNick("");
    cargarComunidad();
  };

  const handleQuitarIntegrante = async (userId: string) => {
    setQuitandoUserId(userId);
    const { error } = await supabase
      .from("comunidad_miembros")
      .delete()
      .eq("comunidad_id", comunidad.id)
      .eq("user_id", userId);
    setQuitandoUserId(null);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Integrante quitado.");
    cargarComunidad();
  };

  return (
    <section className="section section-page" data-tema-equipo={comunidad.tema_comunidad}>
      <div className="team-detail-banner-wrap">
        {comunidad.banner_url ? (
          <img src={comunidad.banner_url} alt="" className="team-detail-banner" />
        ) : (
          <div className="team-detail-banner team-detail-banner-placeholder" />
        )}
        <div className="team-detail-logo-overlap">
          {comunidad.logo_url ? (
            <img src={comunidad.logo_url} alt={comunidad.nombre} className="team-detail-logo" />
          ) : (
            <div className="team-detail-logo team-card-logo-placeholder">
              <Users size={28} aria-hidden="true" />
            </div>
          )}
        </div>
      </div>

      <div className="team-detail-header">
        <div>
          <h1 className="section-title">{comunidad.nombre}</h1>
          <p className="tournament-card-meta">
            {miembros.length} {miembros.length === 1 ? "integrante" : "integrantes"}
          </p>
          {comunidad.descripcion && <p className="tournament-card-meta">{comunidad.descripcion}</p>}
        </div>

        <div className="team-panel-toggle-header">
          {user && !esCreador && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={esMiembro ? handleSalir : handleUnirse}
              disabled={uniendose}
            >
              {uniendose ? "..." : esMiembro ? "Salir de la comunidad" : "Unirse"}
            </button>
          )}
          {user && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(`/tournaments/create?comunidad=${comunidad.id}`)}
            >
              Crear evento de comunidad
            </button>
          )}
          {esCreador && (
            <button type="button" className="btn btn-primary" onClick={() => setPanelAbierto((abierto) => !abierto)}>
              {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
            </button>
          )}
        </div>
      </div>

      {panelAbierto && esCreador && (
        <div className="modal-backdrop" onClick={() => setPanelAbierto(false)}>
          <div className="comunidad-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setPanelAbierto(false)}
              aria-label="Cerrar panel de control"
            >
              <X size={18} />
            </button>
            <h3 className="detail-subtitle" style={{ marginTop: 0 }}>
              Configuración
            </h3>

            <div className="team-config-media-tabs comunidad-panel-tabs">
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "apariencia" ? "is-active" : ""}`}
                onClick={() => setTabConfig("apariencia")}
              >
                Apariencia
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "descripcion" ? "is-active" : ""}`}
                onClick={() => setTabConfig("descripcion")}
              >
                Descripción
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "logo" ? "is-active" : ""}`}
                onClick={() => setTabConfig("logo")}
              >
                Logo
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "banner" ? "is-active" : ""}`}
                onClick={() => setTabConfig("banner")}
              >
                Banner
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "integrantes" ? "is-active" : ""}`}
                onClick={() => setTabConfig("integrantes")}
              >
                Integrantes
              </button>
            </div>

            <div className="comunidad-panel-body">
              {tabConfig === "apariencia" && (
                <div className="form-group">
                  <span className="form-label">Color de acento de la página</span>
                  <div className="team-tema-options">
                    {TEMAS_EQUIPO.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={`team-tema-option ${comunidad.tema_comunidad === t.value ? "selected" : ""}`}
                        disabled={guardandoTema}
                        onClick={() => handleCambiarTema(t.value)}
                      >
                        <span className="team-tema-swatch" style={{ background: t.color }} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(tabConfig === "descripcion" || tabConfig === "logo" || tabConfig === "banner") && (
            <form className="auth-form" onSubmit={handleGuardarPanel}>
              {tabConfig === "descripcion" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="comunidad-descripcion-panel">
                    Descripción
                  </label>
                  <textarea
                    id="comunidad-descripcion-panel"
                    className="form-textarea"
                    maxLength={280}
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                  />
                </div>
              )}

              {tabConfig === "logo" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="comunidad-logo-panel">
                    Logo (opcional, máx. 15MB, se recorta a 1:1)
                  </label>
                  <input
                    id="comunidad-logo-panel"
                    className="form-input"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                  />
                  {archivoParaRecortarLogo && (
                    <RecortadorImagenModal
                      archivo={archivoParaRecortarLogo}
                      aspecto={1}
                      titulo="Ajustar logo de la comunidad"
                      onConfirmar={(recorte) => {
                        setLogoFile(recorte);
                        setLogoPreview(URL.createObjectURL(recorte));
                        setArchivoParaRecortarLogo(null);
                      }}
                      onCancelar={() => setArchivoParaRecortarLogo(null)}
                    />
                  )}
                  {(logoPreview ?? comunidad.logo_url) && (
                    <img
                      src={logoPreview ?? comunidad.logo_url ?? ""}
                      alt="Vista previa del logo"
                      className="team-logo-preview"
                    />
                  )}
                </div>
              )}

              {tabConfig === "banner" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="comunidad-banner-panel">
                    Banner (opcional, máx. 15MB, se recorta a 4:1)
                  </label>
                  <input
                    id="comunidad-banner-panel"
                    className="form-input"
                    type="file"
                    accept="image/*"
                    onChange={handleBannerChange}
                  />
                  {archivoParaRecortarBanner && (
                    <RecortadorImagenModal
                      archivo={archivoParaRecortarBanner}
                      aspecto={4}
                      titulo="Ajustar banner de la comunidad"
                      onConfirmar={(recorte) => {
                        setBannerFile(recorte);
                        setBannerPreview(URL.createObjectURL(recorte));
                        setArchivoParaRecortarBanner(null);
                      }}
                      onCancelar={() => setArchivoParaRecortarBanner(null)}
                    />
                  )}
                  {(bannerPreview ?? comunidad.banner_url) && (
                    <img
                      src={bannerPreview ?? comunidad.banner_url ?? ""}
                      alt="Vista previa del banner"
                      className="team-detail-banner"
                    />
                  )}
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar cambios"}
              </button>
            </form>
          )}

          {tabConfig === "integrantes" && (
            <>
              <form className="auth-form" onSubmit={handleBuscarJugador}>
                <div className="form-group">
                  <label className="form-label" htmlFor="comunidad-buscar-nick">
                    Agregar integrante (Nick#ID)
                  </label>
                  <input
                    id="comunidad-buscar-nick"
                    className="form-input"
                    type="text"
                    placeholder="TuNick#BattleTag"
                    value={busquedaNick}
                    onChange={(e) => setBusquedaNick(e.target.value)}
                  />
                </div>
                {errorBusqueda && <div className="form-error">{errorBusqueda}</div>}
                <button type="submit" className="btn btn-ghost" disabled={buscando}>
                  {buscando ? "Buscando..." : "Buscar"}
                </button>
              </form>

              {resultadoBusqueda && (
                <div className="detail-participant-item">
                  <Avatar
                    url={resultadoBusqueda.avatarUrl}
                    nombre={resultadoBusqueda.nick}
                    className="detail-participant-avatar"
                    forma={resultadoBusqueda.avatarForma}
                  />
                  {resultadoBusqueda.nick ?? "Jugador de RemorApp"}
                  {resultadoBusqueda.uniqueId && <span className="profile-nick-id">#{resultadoBusqueda.uniqueId}</span>}
                  <button type="button" className="btn btn-primary" onClick={handleAgregarIntegrante} disabled={agregando}>
                    {agregando ? "Agregando..." : "Agregar"}
                  </button>
                </div>
              )}

              <h3 className="detail-subtitle">Integrantes actuales</h3>
              <div className="comunidad-panel-integrantes-lista detail-participant-list">
                {miembros.map((m) => (
                  <div key={m.userId} className="detail-participant-item">
                    <Avatar url={m.avatarUrl} nombre={m.nick} className="detail-participant-avatar" forma={m.avatarForma} />
                    {m.nick ?? "Jugador de RemorApp"}
                    {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
                    {m.userId === comunidad.creador_id ? (
                      <span className="team-owner-badge">Creador</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleQuitarIntegrante(m.userId)}
                        disabled={quitandoUserId === m.userId}
                      >
                        {quitandoUserId === m.userId ? "Quitando..." : "Quitar"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

              <div className="team-panel-danger-zone">
                <h3 className="detail-subtitle">Zona de peligro</h3>
                <p className="tournament-card-meta">
                  Eliminar la comunidad es una acción irreversible: todos los integrantes quedan libres (ya
                  no va a figurar en su perfil) y deja de poder vincularse a eventos nuevos.
                </p>
                <button
                  type="button"
                  className="btn btn-danger btn-block"
                  onClick={handleEliminarComunidad}
                  disabled={eliminando}
                >
                  {eliminando ? "Eliminando..." : "Eliminar comunidad"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <h3 className="detail-subtitle">Integrantes</h3>
      <div className="detail-participant-list">
        {miembros.map((m) => (
          <div key={m.userId} className="detail-participant-item">
            <Avatar url={m.avatarUrl} nombre={m.nick} className="detail-participant-avatar" forma={m.avatarForma} />
            {m.nick ?? "Jugador de RemorApp"}
            {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
            {m.userId === comunidad.creador_id && <span className="team-owner-badge">Creador</span>}
          </div>
        ))}
      </div>

      <h3 className="detail-subtitle">
        <Calendar size={16} className="icon-inline" aria-hidden="true" />
        Eventos de la comunidad
      </h3>
      <div className="detail-card player-tab-standalone-card">
        {eventos.length === 0 ? (
          <p className="detail-empty">Todavía no hay eventos creados para esta comunidad.</p>
        ) : (
          <div className="detail-participant-list">
            {eventos.map((evento) => (
              <Link
                key={`${evento.tipo}-${evento.id}`}
                to={evento.href}
                className="detail-participant-item detail-participant-item-evento"
              >
                {evento.titulo}
                <span className="tournament-card-meta">{formatFecha(evento.fecha)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
