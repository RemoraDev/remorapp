import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Users, Calendar } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { comprimirImagen } from "../lib/imageCompression";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { formatFecha } from "../lib/formatters";
import Avatar from "../components/Avatar";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import type { ComunidadRow } from "../types/comunidades";
import type { AvatarForma } from "../types/profile";

const LOGO_MAX_BYTES = 15 * 1024 * 1024;

interface MiembroConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
}

interface EventoComunidad {
  tipo: "torneo" | "race_war" | "clan_war_amistosa";
  id: string;
  titulo: string;
  fecha: string;
  href: string;
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

  const [descripcion, setDescripcion] = useState("");
  const [archivoParaRecortarLogo, setArchivoParaRecortarLogo] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [archivoParaRecortarBanner, setArchivoParaRecortarBanner] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<Blob | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

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

    const { data: torneosData } = await supabase
      .from("tournaments")
      .select("id, nombre, fecha_inicio")
      .eq("comunidad_id", id)
      .order("fecha_inicio", { ascending: false });

    const torneoIds = (torneosData ?? []).map((t) => t.id as string);
    let raceWarIdPorTorneo: Record<string, string> = {};

    if (torneoIds.length > 0) {
      const { data: raceWarsData } = await supabase
        .from("guerra_razas")
        .select("id, tournament_id")
        .in("tournament_id", torneoIds);

      raceWarIdPorTorneo = (raceWarsData ?? []).reduce<Record<string, string>>((acc, g) => {
        acc[g.tournament_id as string] = g.id as string;
        return acc;
      }, {});
    }

    const eventosTorneos: EventoComunidad[] = (torneosData ?? []).map((t) => {
      const raceWarId = raceWarIdPorTorneo[t.id as string];
      return raceWarId
        ? { tipo: "race_war", id: raceWarId, titulo: t.nombre as string, fecha: t.fecha_inicio as string, href: `/guerra-razas/${raceWarId}` }
        : { tipo: "torneo", id: t.id as string, titulo: t.nombre as string, fecha: t.fecha_inicio as string, href: `/tournaments/${t.id}` };
    });

    const { data: clanWarsData } = await supabase
      .from("clan_wars")
      .select("id, fecha_hora_cet, titulo, challenger:teams!challenger_team_id(tag), challenged:teams!challenged_team_id(tag)")
      .eq("comunidad_id", id)
      .order("fecha_hora_cet", { ascending: false });

    const eventosClanWars: EventoComunidad[] = (clanWarsData ?? []).map((cw) => {
      const challenger = Array.isArray(cw.challenger) ? cw.challenger[0] : cw.challenger;
      const challenged = Array.isArray(cw.challenged) ? cw.challenged[0] : cw.challenged;
      return {
        tipo: "clan_war_amistosa",
        id: cw.id as string,
        titulo: (cw.titulo as string | null) ?? `${challenger?.tag ?? "?"} vs ${challenged?.tag ?? "?"}`,
        fecha: cw.fecha_hora_cet as string,
        href: `/clan-war/${cw.id}`,
      };
    });

    setEventos(
      [...eventosTorneos, ...eventosClanWars].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      )
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

  return (
    <section className="section section-page">
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
        <div className="detail-card organizer-panel-card-peligro">
          <h3 className="detail-subtitle">Panel de control</h3>
          <form className="auth-form" onSubmit={handleGuardarPanel}>
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
              {logoPreview && <img src={logoPreview} alt="Vista previa del logo" className="team-logo-preview" />}
            </div>

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
              {bannerPreview && <img src={bannerPreview} alt="Vista previa del banner" className="team-detail-banner" />}
            </div>

            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>

          <button
            type="button"
            className="btn organizer-panel-tab-peligro"
            onClick={handleEliminarComunidad}
            disabled={eliminando}
          >
            {eliminando ? "Eliminando..." : "Eliminar comunidad"}
          </button>
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
