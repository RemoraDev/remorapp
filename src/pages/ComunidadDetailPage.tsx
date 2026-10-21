import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Users, X, Clock, Radio, Globe2, Languages, Gamepad2 } from "lucide-react";
// Performance: antes vivía en main.tsx (cargaba para cualquier visita
// a la app) -- acá solo entra en el chunk de esta página, la única
// otra que muestra una bandera real (país del streamer).
import "flag-icons/css/flag-icons.min.css";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { comprimirImagen } from "../lib/imageCompression";
import Avatar from "../components/Avatar";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import type { ComunidadRow } from "../types/comunidades";
import { COUNTRY_OPTIONS, PAIS_ISO } from "../types/profile";
import type { AvatarForma, Country } from "../types/profile";
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
  const [cargando, setCargando] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [uniendose, setUniendose] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  // Migración 205, a pedido del usuario: la lista de integrantes ya no
  // se ve siempre en el lobby público -- queda detrás de este botón.
  const [mostrandoIntegrantes, setMostrandoIntegrantes] = useState(false);
  // Migración 200/202/203/204, a pedido del usuario: Panel de control
  // ordenado en pestañas hermanas (Apariencia/Avatar/Banner/Streamer/
  // Integrantes/Eliminar), mismo lenguaje visual que "Configuración" de
  // Mi Clan (.team-config-media-tabs/.team-config-media-tab).
  // "Eliminar" pasa a ser una pestaña más, no un botón rojo siempre
  // visible en TODAS las pestañas (quedaba "amenazando" todo el
  // tiempo). "Descripción" se saca del todo -- ya no es editable desde
  // acá, solo se define al crear la comunidad.
  const [tabConfig, setTabConfig] = useState<
    "apariencia" | "avatar" | "banner" | "streamer" | "integrantes" | "eliminar"
  >("apariencia");
  const [guardandoTema, setGuardandoTema] = useState(false);

  const [archivoParaRecortarLogo, setArchivoParaRecortarLogo] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [archivoParaRecortarBanner, setArchivoParaRecortarBanner] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<Blob | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  // Migración 203, a pedido del usuario: banner lateral aparte del
  // banner superior, dentro de la misma pestaña "Banner".
  const [archivoParaRecortarBannerLateral, setArchivoParaRecortarBannerLateral] = useState<File | null>(null);
  const [bannerLateralFile, setBannerLateralFile] = useState<Blob | null>(null);
  const [bannerLateralPreview, setBannerLateralPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  // Streamer (migración 204, a pedido del usuario): reemplaza a
  // "Eventos de la comunidad" en la ficha pública -- horario, link,
  // país, idioma, juegos en cast y datos sobre el streamer. Se
  // sincroniza con cargarComunidad() más abajo, mismo patrón que la
  // descripción tenía antes.
  const [streamerHorario, setStreamerHorario] = useState("");
  const [streamerLink, setStreamerLink] = useState("");
  const [streamerPais, setStreamerPais] = useState<Country | "">("");
  const [streamerIdioma, setStreamerIdioma] = useState("");
  const [streamerJuegos, setStreamerJuegos] = useState("");
  const [streamerBio, setStreamerBio] = useState("");
  const [guardandoStreamer, setGuardandoStreamer] = useState(false);

  // Integrantes (migración 200/203, a pedido del usuario): dos
  // subpestañas -- "Lista de integrantes" (solo ver) y "Agregar o
  // quitar integrantes" (buscar por Nick#ID y sumar directo, mismo
  // patrón que "buscar e invitar" de Mi Clan -- acá se suma directo
  // porque unirse ya es libre, no hace falta que nadie acepte nada).
  const [subtabIntegrantes, setSubtabIntegrantes] = useState<"lista" | "gestionar">("lista");
  const [busquedaNick, setBusquedaNick] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [resultadoBusqueda, setResultadoBusqueda] = useState<MiembroConNombre | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [quitandoUserId, setQuitandoUserId] = useState<string | null>(null);
  // Migración 209: integrantes expulsados (comunidad_kicks_log), solo
  // visible/cargado para el creador -- ver handlePermitirReingreso.
  const [expulsados, setExpulsados] = useState<MiembroConNombre[]>([]);
  const [permitiendoUserId, setPermitiendoUserId] = useState<string | null>(null);

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
    setStreamerHorario((data as ComunidadRow).streamer_horario ?? "");
    setStreamerLink((data as ComunidadRow).streamer_link ?? "");
    setStreamerPais(((data as ComunidadRow).streamer_pais as Country | null) ?? "");
    setStreamerIdioma((data as ComunidadRow).streamer_idioma ?? "");
    setStreamerJuegos((data as ComunidadRow).streamer_juegos ?? "");
    setStreamerBio((data as ComunidadRow).streamer_bio ?? "");

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

    // La política de select de comunidad_kicks_log solo deja ver esto
    // al creador -- para cualquier otro usuario esta consulta vuelve
    // vacía, no hace falta chequear esCreador antes de pedirla.
    const { data: expulsadosData } = await supabase
      .from("comunidad_kicks_log")
      .select("user_id, profiles(nick, unique_id, avatar_url, avatar_forma)")
      .eq("comunidad_id", id);

    setExpulsados(
      (expulsadosData ?? []).map((m) => {
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
    const { error } = await supabase.rpc("unirse_comunidad", { p_comunidad_id: comunidad.id });
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

  const handleBannerLateralChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!archivo) return;
    if (archivo.size > LOGO_MAX_BYTES) {
      toast.error("El banner lateral no puede pesar más de 15MB.");
      return;
    }
    setArchivoParaRecortarBannerLateral(archivo);
  };

  const handleGuardarPanel = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardando(true);

    const cambios: { logo_url?: string; banner_url?: string; banner_lateral_url?: string } = {};

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

      if (bannerLateralFile) {
        const bannerLateralComprimido = await comprimirImagen(bannerLateralFile, "banner-lateral");
        const extension = bannerLateralComprimido.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner-lateral.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("comunidad-banners")
          .upload(ruta, bannerLateralComprimido, { contentType: bannerLateralComprimido.type });
        if (uploadError) {
          toast.error("No se pudo subir el banner lateral: " + uploadError.message);
          setGuardando(false);
          return;
        }
        cambios.banner_lateral_url = supabase.storage.from("comunidad-banners").getPublicUrl(ruta).data.publicUrl;
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
    setBannerLateralFile(null);
    setBannerLateralPreview(null);
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

  const handleGuardarStreamer = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardandoStreamer(true);
    const { error } = await supabase
      .from("comunidades")
      .update({
        streamer_horario: streamerHorario.trim() || null,
        streamer_link: streamerLink.trim() || null,
        streamer_pais: streamerPais || null,
        streamer_idioma: streamerIdioma.trim() || null,
        streamer_juegos: streamerJuegos.trim() || null,
        streamer_bio: streamerBio.trim() || null,
      })
      .eq("id", comunidad.id);
    setGuardandoStreamer(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Comunidad actualizada.");
    cargarComunidad();
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
    const { error } = await supabase.rpc("agregar_integrante_comunidad", {
      p_comunidad_id: comunidad.id,
      p_user_id: resultadoBusqueda.userId,
    });
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
    const { error } = await supabase.rpc("quitar_integrante_comunidad", {
      p_comunidad_id: comunidad.id,
      p_user_id: userId,
    });
    setQuitandoUserId(null);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Integrante quitado. No va a poder volver a unirse hasta que se lo permitas.");
    cargarComunidad();
  };

  // Migración 209, corrección QA: antes "Quitar" era cosmético (el
  // expulsado podía volver a unirse al toque) -- ahora queda bloqueado
  // en comunidad_kicks_log hasta que el creador lo permita de nuevo
  // desde acá.
  const handlePermitirReingreso = async (userId: string) => {
    setPermitiendoUserId(userId);
    const { error } = await supabase.rpc("permitir_reingreso_comunidad", {
      p_comunidad_id: comunidad.id,
      p_user_id: userId,
    });
    setPermitiendoUserId(null);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Ahora puede volver a unirse.");
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
                className={`team-config-media-tab ${tabConfig === "avatar" ? "is-active" : ""}`}
                onClick={() => setTabConfig("avatar")}
              >
                Avatar
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
                className={`team-config-media-tab ${tabConfig === "streamer" ? "is-active" : ""}`}
                onClick={() => setTabConfig("streamer")}
              >
                Streamer
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "integrantes" ? "is-active" : ""}`}
                onClick={() => setTabConfig("integrantes")}
              >
                Integrantes
              </button>
              <button
                type="button"
                className={`team-config-media-tab ${tabConfig === "eliminar" ? "is-active" : ""}`}
                onClick={() => setTabConfig("eliminar")}
              >
                Eliminar
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

              {(tabConfig === "avatar" || tabConfig === "banner") && (
                <form className="auth-form" onSubmit={handleGuardarPanel}>
                  {tabConfig === "avatar" && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="comunidad-logo-panel">
                        Avatar (opcional, máx. 15MB, se recorta a 1:1)
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
                          titulo="Ajustar avatar de la comunidad"
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
                          alt="Vista previa del avatar"
                          className="team-logo-preview"
                        />
                      )}
                    </div>
                  )}

                  {tabConfig === "banner" && (
                    <>
                      <div className="form-group">
                        <label className="form-label" htmlFor="comunidad-banner-panel">
                          Banner superior (opcional, máx. 15MB, se recorta a 4:1)
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

                      <div className="form-group">
                        <label className="form-label" htmlFor="comunidad-banner-lateral-panel">
                          Banner lateral (opcional, máx. 15MB)
                        </label>
                        <input
                          id="comunidad-banner-lateral-panel"
                          className="form-input"
                          type="file"
                          accept="image/*"
                          onChange={handleBannerLateralChange}
                        />
                        {archivoParaRecortarBannerLateral && (
                          <RecortadorImagenModal
                            archivo={archivoParaRecortarBannerLateral}
                            aspecto={1 / 5}
                            titulo="Ajustar banner lateral de la comunidad"
                            onConfirmar={(recorte) => {
                              setBannerLateralFile(recorte);
                              setBannerLateralPreview(URL.createObjectURL(recorte));
                              setArchivoParaRecortarBannerLateral(null);
                            }}
                            onCancelar={() => setArchivoParaRecortarBannerLateral(null)}
                          />
                        )}
                        {(bannerLateralPreview ?? comunidad.banner_lateral_url) && (
                          <img
                            src={bannerLateralPreview ?? comunidad.banner_lateral_url ?? ""}
                            alt="Vista previa del banner lateral"
                            className="franja-lateral-preview"
                          />
                        )}
                      </div>
                    </>
                  )}

                  <button type="submit" className="btn btn-primary" disabled={guardando}>
                    {guardando ? "Guardando..." : "Guardar cambios"}
                  </button>
                </form>
              )}

              {tabConfig === "streamer" && (
                <form className="auth-form" onSubmit={handleGuardarStreamer}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-horario">
                      Horario
                    </label>
                    <input
                      id="comunidad-streamer-horario"
                      className="form-input"
                      type="text"
                      placeholder="Lunes a viernes, 20:00-23:00 CET"
                      maxLength={80}
                      value={streamerHorario}
                      onChange={(e) => setStreamerHorario(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-link">
                      Link de stream
                    </label>
                    <input
                      id="comunidad-streamer-link"
                      className="form-input"
                      type="text"
                      placeholder="https://twitch.tv/tucanal"
                      value={streamerLink}
                      onChange={(e) => setStreamerLink(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-pais">
                      País
                    </label>
                    <select
                      id="comunidad-streamer-pais"
                      className="form-select"
                      value={streamerPais}
                      onChange={(e) => setStreamerPais(e.target.value as Country | "")}
                    >
                      <option value="">Sin especificar</option>
                      {COUNTRY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-idioma">
                      Idioma
                    </label>
                    <input
                      id="comunidad-streamer-idioma"
                      className="form-input"
                      type="text"
                      placeholder="Español"
                      maxLength={40}
                      value={streamerIdioma}
                      onChange={(e) => setStreamerIdioma(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-juegos">
                      Juegos en cast
                    </label>
                    <input
                      id="comunidad-streamer-juegos"
                      className="form-input"
                      type="text"
                      placeholder="StarCraft II"
                      maxLength={80}
                      value={streamerJuegos}
                      onChange={(e) => setStreamerJuegos(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="comunidad-streamer-bio">
                      Sobre el streamer
                    </label>
                    <textarea
                      id="comunidad-streamer-bio"
                      className="form-textarea"
                      maxLength={280}
                      value={streamerBio}
                      onChange={(e) => setStreamerBio(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={guardandoStreamer}>
                    {guardandoStreamer ? "Guardando..." : "Guardar cambios"}
                  </button>
                </form>
              )}

              {tabConfig === "integrantes" && (
                <>
                  <div className="team-info-subtabs">
                    <button
                      type="button"
                      className={`team-info-subtab ${subtabIntegrantes === "lista" ? "is-active" : ""}`}
                      onClick={() => setSubtabIntegrantes("lista")}
                    >
                      Lista de integrantes
                    </button>
                    <button
                      type="button"
                      className={`team-info-subtab ${subtabIntegrantes === "gestionar" ? "is-active" : ""}`}
                      onClick={() => setSubtabIntegrantes("gestionar")}
                    >
                      Agregar o quitar integrantes
                    </button>
                  </div>

                  {subtabIntegrantes === "lista" && (
                    <div className="comunidad-panel-integrantes-lista detail-participant-list">
                      {miembros.map((m) => (
                        <div key={m.userId} className="detail-participant-item">
                          <Avatar
                            url={m.avatarUrl}
                            nombre={m.nick}
                            className="detail-participant-avatar"
                            forma={m.avatarForma}
                          />
                          {m.nick ?? "Jugador de RemorApp"}
                          {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
                          {m.userId === comunidad.creador_id && <span className="team-owner-badge">Creador</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {subtabIntegrantes === "gestionar" && (
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
                          {resultadoBusqueda.uniqueId && (
                            <span className="profile-nick-id">#{resultadoBusqueda.uniqueId}</span>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleAgregarIntegrante}
                            disabled={agregando}
                          >
                            {agregando ? "Agregando..." : "Agregar"}
                          </button>
                        </div>
                      )}

                      <h3 className="detail-subtitle">Quitar integrantes</h3>
                      <div className="comunidad-panel-integrantes-lista detail-participant-list">
                        {miembros.map((m) => (
                          <div key={m.userId} className="detail-participant-item">
                            <Avatar
                              url={m.avatarUrl}
                              nombre={m.nick}
                              className="detail-participant-avatar"
                              forma={m.avatarForma}
                            />
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

                      {expulsados.length > 0 && (
                        <>
                          <h3 className="detail-subtitle">Expulsados (no pueden volver a unirse)</h3>
                          <div className="comunidad-panel-integrantes-lista detail-participant-list">
                            {expulsados.map((m) => (
                              <div key={m.userId} className="detail-participant-item">
                                <Avatar
                                  url={m.avatarUrl}
                                  nombre={m.nick}
                                  className="detail-participant-avatar"
                                  forma={m.avatarForma}
                                />
                                {m.nick ?? "Jugador de RemorApp"}
                                {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => handlePermitirReingreso(m.userId)}
                                  disabled={permitiendoUserId === m.userId}
                                >
                                  {permitiendoUserId === m.userId ? "Permitiendo..." : "Permitir de nuevo"}
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {tabConfig === "eliminar" && (
                <div className="team-panel-danger-zone">
                  <h3 className="detail-subtitle" style={{ marginTop: 0 }}>
                    Zona de peligro
                  </h3>
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Migración 205, a pedido del usuario: la lista de integrantes
          ya no se ve siempre en el lobby -- queda detrás de este botón,
          en un modal. */}
      <button type="button" className="btn btn-ghost" onClick={() => setMostrandoIntegrantes(true)}>
        <Users size={16} className="icon-inline" aria-hidden="true" />
        Ver integrantes ({miembros.length})
      </button>

      {mostrandoIntegrantes && (
        <div className="modal-backdrop" onClick={() => setMostrandoIntegrantes(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setMostrandoIntegrantes(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <h2 className="modal-title">Integrantes</h2>
            <div className="detail-participant-list" style={{ marginTop: "1rem" }}>
              {miembros.map((m) => (
                <div key={m.userId} className="detail-participant-item">
                  <Avatar url={m.avatarUrl} nombre={m.nick} className="detail-participant-avatar" forma={m.avatarForma} />
                  {m.nick ?? "Jugador de RemorApp"}
                  {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
                  {m.userId === comunidad.creador_id && <span className="team-owner-badge">Creador</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Migración 204, a pedido del usuario: reemplaza a "Eventos de
          la comunidad" (esos eventos se siguen viendo en Mis Eventos,
          ver BottomNav.tsx) -- ficha del streamer, con los mismos
          datos que ya existen en "Mi perfil"/"Mi Clan" (país/idioma/
          horario/link/juegos/bio) en una sola tarjeta. */}
      {(comunidad.streamer_horario ||
        comunidad.streamer_link ||
        comunidad.streamer_pais ||
        comunidad.streamer_idioma ||
        comunidad.streamer_juegos ||
        comunidad.streamer_bio) && (
        <div className="comunidad-streamer-card">
          <div className="comunidad-streamer-card-header">
            <Radio size={18} aria-hidden="true" />
            <h3>Streamer</h3>
          </div>

          <div className="comunidad-streamer-card-datos">
            {comunidad.streamer_horario && (
              <span className="comunidad-streamer-dato">
                <Clock size={14} aria-hidden="true" />
                {comunidad.streamer_horario}
              </span>
            )}
            {comunidad.streamer_pais && (
              <span className="comunidad-streamer-dato">
                {PAIS_ISO[comunidad.streamer_pais as Country] ? (
                  <span className={`fi fi-${PAIS_ISO[comunidad.streamer_pais as Country]}`} aria-hidden="true" />
                ) : (
                  <Globe2 size={14} aria-hidden="true" />
                )}
                {COUNTRY_OPTIONS.find((o) => o.value === comunidad.streamer_pais)?.label ?? comunidad.streamer_pais}
              </span>
            )}
            {comunidad.streamer_idioma && (
              <span className="comunidad-streamer-dato">
                <Languages size={14} aria-hidden="true" />
                {comunidad.streamer_idioma}
              </span>
            )}
            {comunidad.streamer_juegos && (
              <span className="comunidad-streamer-dato">
                <Gamepad2 size={14} aria-hidden="true" />
                {comunidad.streamer_juegos}
              </span>
            )}
          </div>

          {comunidad.streamer_bio && <p className="comunidad-streamer-card-bio">{comunidad.streamer_bio}</p>}

          {comunidad.streamer_link && (
            <a
              href={comunidad.streamer_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary comunidad-streamer-card-link"
            >
              <Radio size={16} aria-hidden="true" />
              Ver stream
            </a>
          )}
        </div>
      )}
    </section>
  );
}
