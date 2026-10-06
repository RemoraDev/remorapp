import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { Award, Settings, Shield, Pencil, User, Radio, ChevronRight, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { comprimirImagen } from "../lib/imageCompression";
import { useAuth } from "../context/AuthContext";
import { useOverlayPanel } from "../hooks/useOverlayPanel";
import Avatar from "../components/Avatar";
import AvatarSkin from "../components/AvatarSkin";
import Carrusel from "../components/Carrusel";
import FondoParticulas from "../components/FondoParticulas";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import { TwitchIcon, DiscordIcon, YoutubeIcon } from "../components/IconosRedes";
import LogrosTorneosJugadorList from "../components/LogrosTorneosJugadorList";
import { COUNTRY_OPTIONS } from "../types/profile";
import type { Country, LinkTransmision } from "../types/profile";
import type { SkinAvatarClave } from "../types/skins";
import type { TituloActivoTodos } from "../types/titulos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";
import { COLOR_PLATAFORMA_STREAM, extraerNombreCanal, normalizarUrlStream } from "../lib/streamLinks";
import { getModoLabel, getFormatoLabel } from "../lib/tournamentOptions";
import { formatFecha } from "../lib/formatters";
import type { TournamentRow, TorneoEstado } from "../types/tournaments";

const ESTADO_EVENTO_LABEL: Record<TorneoEstado, string> = {
  abierto: "Inscripciones abiertas",
  en_curso: "En curso",
  finalizado: "Finalizado",
};

// PostgREST embebe tournaments como objeto o como array de 1 según la
// versión, sin tipos generados -- mismo patrón que MyTournamentsPage.tsx.
function extraerTorneo(torneos: unknown): TournamentRow | null {
  const t = Array.isArray(torneos) ? torneos[0] : torneos;
  return (t as TournamentRow | undefined) ?? null;
}

interface PerfilPublico {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  // Migración 128: foto propia de la tarjeta de presentación de
  // escritorio -- distinta del avatar (avatarUrl), que sigue siendo el
  // de siempre (header, menús, todo el resto de la app). Null hasta
  // que el usuario suba una; mientras tanto la tarjeta muestra el
  // avatar normal como respaldo (ver fotoPresentacionMostrada).
  fotoPresentacionUrl: string | null;
  bio: string | null;
  country: Country | null;
  esCaster: boolean;
  horarioStream: string | null;
  linksTransmision: LinkTransmision[];
  liga: string;
  mmr: number;
  nivel: number;
  bancaRota: boolean;
  razaPrincipal: RazaSc2 | null;
  razaSecundaria: RazaSc2 | null;
  // Skin de avatar activa (migración 052): id de catalogo_skins_avatar,
  // null si no tiene. Solo se puede resolver a "clave" (y por lo tanto
  // mostrarse) cuando quien mira esta página es, a su vez, el dueño de
  // la plataforma -- el catálogo sigue siendo privado (RLS), así que
  // para cualquier otro visitante el efecto simplemente no aparece
  // todavía, aunque el perfil que mira sea el del dueño.
  skinAvatarActiva: string | null;
  // Borde básico (migración 055): público para cualquier cuenta, a
  // diferencia de skinAvatarActiva -- se resuelve siempre, sin
  // importar quién esté mirando.
  bordeBasicoActivo: string | null;
  bordeGrosor: number;
  // Migración 092: true si avatarUrl quedó con transparencia real --
  // apaga el borde básico/skin de efectos mientras tanto (ver
  // AvatarSkin.tsx y su mismo uso en ProfilePage.tsx/Header.tsx).
  avatarTransparente: boolean;
}

interface EquipoActual {
  name: string;
  tag: string;
  logoUrl: string | null;
  // Migración 154: para el botón "Usar la foto de mi clan" del lápiz
  // de la foto de presentación propia.
  fotoPresentacionUrl: string | null;
}

type TabPerfil = "perfil" | "stream" | "logros";

// El título más "importante" cuando hay varios activos a la vez: el
// de mayor duracion_dias -- mismo criterio y mismo formato de texto
// que en la Sala de la Fama (Muro de Jugadores).
function tituloMasRelevante(
  id: string,
  titulos: TituloActivoTodos[]
): { otroId: string; soyPadre: boolean } | null {
  const propios = titulos.filter((t) => t.retador_id === id || t.retado_id === id);
  if (propios.length === 0) return null;
  const elegido = [...propios].sort((a, b) => b.duracion_dias - a.duracion_dias)[0];
  return {
    otroId: elegido.retador_id === id ? elegido.retado_id : elegido.retador_id,
    soyPadre: elegido.ganador_id === id,
  };
}

// Perfil Público de Jugador -- página de vitrina, de solo lectura.
// Ningún campo se edita acá: todo lo editable (avatar, banner,
// descripción, identidad, links de transmisión) vive detrás de
// "Editar mis datos" en el menú del avatar (ver ProfilePage.tsx).
export default function PlayerDetailPage() {
  const { nick, uniqueId } = useParams<{ nick: string; uniqueId: string }>();
  const { user, profile } = useAuth();

  // Migración 149/151: mismo tratamiento que el "Configuración" del
  // Header -- se abre como ventana superpuesta sobre esta vitrina (o
  // sobre lo que sea que haya de fondo, si esta vitrina YA se está
  // mostrando como overlay) en vez de navegar de lleno a /perfil.
  const { abrirOverlay } = useOverlayPanel();
  // Corrección: el Panel de control propio de esta página (el que abre
  // y cierra panelAbierto, por createPortal a document.body) se quedaba
  // montado ARRIBA del nuevo overlay al abrir otro desde adentro (ej.
  // Configuración) -- dos portales separados, el que ya estaba abierto
  // ganaba el empate de z-index por orden de montaje en el DOM. Hay que
  // cerrar este ANTES de abrir el otro.
  const irA = (path: string) => {
    setPanelAbierto(false);
    abrirOverlay(path);
  };
  const handleAbrirConfiguracion = (tab: string = "configuracion") => {
    irA(`/perfil?tab=${tab}`);
  };

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [skinAvatarClave, setSkinAvatarClave] = useState<SkinAvatarClave | null>(null);
  const [bordeBasicoColorHex, setBordeBasicoColorHex] = useState<string | null>(null);
  const [tituloTexto, setTituloTexto] = useState<string | null>(null);
  const [equipoActual, setEquipoActual] = useState<EquipoActual | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  // Pestañas de la vista de escritorio (Perfil/Stream/Logros) -- la
  // vista móvil de arriba no las usa, se mantiene como una sola página
  // apilada de siempre.
  const [tabEscritorio, setTabEscritorio] = useState<TabPerfil>("perfil");

  // Edición rápida de la foto de presentación desde la tarjeta de
  // escritorio (migraciones 124 y 128): sin texto ni botón de
  // "Guardar" -- elegís el archivo, ajustás el recorte, y se sube
  // sola. Va a su propia columna (foto_presentacion_url), separada del
  // avatar de siempre -- este botón nunca toca avatar_url.
  // Migración 145: el límite subió de 2MB a 15MB -- comprimirImagen()
  // baja el peso antes de subir, así que acá solo hace falta cubrir
  // una foto de celular pesada sin comprimir.
  const FOTO_PRESENTACION_MAX_BYTES = 15 * 1024 * 1024;
  const fotoPresentacionInputRef = useRef<HTMLInputElement | null>(null);
  const [archivoParaRecortarFotoPresentacion, setArchivoParaRecortarFotoPresentacion] = useState<File | null>(null);
  const [subiendoFotoPresentacion, setSubiendoFotoPresentacion] = useState(false);
  const [errorFotoPresentacion, setErrorFotoPresentacion] = useState<string | null>(null);

  const handleFotoPresentacionFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorFotoPresentacion(null);
    event.target.value = "";
    if (!archivo) return;
    if (archivo.size > FOTO_PRESENTACION_MAX_BYTES) {
      setErrorFotoPresentacion("La foto no puede pesar más de 15MB.");
      return;
    }
    setArchivoParaRecortarFotoPresentacion(archivo);
  };

  // Edición rápida de "Sobre mí" desde la tarjeta de escritorio -- mismo
  // criterio que la foto de presentación de arriba (excepción puntual a
  // "acá no se edita nada", con el lápiz de siempre): un textarea +
  // Guardar, sin ir hasta Configuración solo para cambiar una frase.
  const [editandoBio, setEditandoBio] = useState(false);
  const [bioEditada, setBioEditada] = useState("");
  const [guardandoBio, setGuardandoBio] = useState(false);
  const [errorBio, setErrorBio] = useState<string | null>(null);

  const handleAbrirEdicionBio = () => {
    setBioEditada(perfil?.bio ?? "");
    setErrorBio(null);
    setEditandoBio(true);
  };

  const handleGuardarBio = async () => {
    if (!user) return;
    setGuardandoBio(true);
    setErrorBio(null);
    const nuevaBio = bioEditada.trim() || null;
    const { error } = await supabase.from("profiles").update({ bio: nuevaBio }).eq("id", user.id);
    setGuardandoBio(false);
    if (error) {
      setErrorBio(error.message);
      return;
    }
    setPerfil((prev) => (prev ? { ...prev, bio: nuevaBio } : prev));
    setEditandoBio(false);
  };

  // Migración 158: tarjeta rápida de Stream (Twitch/Discord/YouTube),
  // debajo de la tarjeta "Clan" -- mismo criterio de edición rápida que
  // "Sobre mí" (textarea/inputs + Guardar, sin pasar por Configuración).
  // Guarda sobre la MISMA columna links_transmision que ya usa el
  // editor grande (tipo "personal", sin días/horario) -- actualiza
  // solo las 3 plataformas fijas, conserva cualquier otro link que ya
  // hubiera ahí (ej. links de transmisión "de verdad", con horario).
  const PLATAFORMAS_STREAM_RAPIDO = ["Twitch", "Discord", "YouTube"] as const;
  const [editandoLinksRapidos, setEditandoLinksRapidos] = useState(false);
  const [linksRapidosEditados, setLinksRapidosEditados] = useState<Record<string, string>>({});
  const [guardandoLinksRapidos, setGuardandoLinksRapidos] = useState(false);
  const [errorLinksRapidos, setErrorLinksRapidos] = useState<string | null>(null);

  const handleAbrirEdicionLinksRapidos = () => {
    const valores: Record<string, string> = {};
    for (const plataforma of PLATAFORMAS_STREAM_RAPIDO) {
      const existente = perfil?.linksTransmision.find(
        (l) => l.plataforma.toLowerCase() === plataforma.toLowerCase()
      );
      valores[plataforma] = existente?.url ?? "";
    }
    setLinksRapidosEditados(valores);
    setErrorLinksRapidos(null);
    setEditandoLinksRapidos(true);
  };

  const handleGuardarLinksRapidos = async () => {
    if (!user || !perfil) return;
    setGuardandoLinksRapidos(true);
    setErrorLinksRapidos(null);

    const otrosLinks = perfil.linksTransmision.filter(
      (l) => !PLATAFORMAS_STREAM_RAPIDO.some((p) => p.toLowerCase() === l.plataforma.toLowerCase())
    );
    const nuevosLinks: LinkTransmision[] = PLATAFORMAS_STREAM_RAPIDO.filter(
      (p) => linksRapidosEditados[p]?.trim()
    ).map((p) => ({ plataforma: p, url: linksRapidosEditados[p].trim(), tipo: "personal" }));
    const linksTransmision = [...otrosLinks, ...nuevosLinks];

    const { error } = await supabase.from("profiles").update({ links_transmision: linksTransmision }).eq("id", user.id);

    setGuardandoLinksRapidos(false);

    if (error) {
      setErrorLinksRapidos(error.message);
      return;
    }

    setPerfil((prev) => (prev ? { ...prev, linksTransmision } : prev));
    setEditandoLinksRapidos(false);
  };

  const handleConfirmarRecorteFotoPresentacion = async (recorte: Blob) => {
    setArchivoParaRecortarFotoPresentacion(null);
    if (!user) return;

    setSubiendoFotoPresentacion(true);
    setErrorFotoPresentacion(null);

    try {
      const recorteComprimido = await comprimirImagen(recorte, "presentacion");
      const extension = recorteComprimido.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/${Date.now()}-presentacion.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(ruta, recorteComprimido, { contentType: recorteComprimido.type });

      if (uploadError) {
        setErrorFotoPresentacion("No se pudo subir la foto: " + uploadError.message);
        return;
      }

      const fotoPresentacionUrl = supabase.storage.from("avatars").getPublicUrl(ruta).data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ foto_presentacion_url: fotoPresentacionUrl })
        .eq("id", user.id);

      if (updateError) {
        setErrorFotoPresentacion(updateError.message);
        return;
      }

      setPerfil((prev) => (prev ? { ...prev, fotoPresentacionUrl } : prev));
    } catch {
      setErrorFotoPresentacion("No se pudo procesar la foto, prueba con otra imagen.");
    } finally {
      setSubiendoFotoPresentacion(false);
    }
  };

  // Migración 154: "Usar la foto de mi clan" -- copia directa de la
  // URL ya subida del equipo a mi propia foto de presentación (no se
  // vuelve a subir nada). Es una copia puntual, no una sincronización
  // en vivo: si el equipo cambia su foto después, la mía no cambia
  // sola -- se puede volver a tocar este botón cuando se quiera.
  const handleUsarFotoDelClan = async () => {
    if (!user || !equipoActual?.fotoPresentacionUrl) return;
    const fotoPresentacionUrl = equipoActual.fotoPresentacionUrl;

    setSubiendoFotoPresentacion(true);
    setErrorFotoPresentacion(null);

    const { error } = await supabase
      .from("profiles")
      .update({ foto_presentacion_url: fotoPresentacionUrl })
      .eq("id", user.id);

    setSubiendoFotoPresentacion(false);

    if (error) {
      setErrorFotoPresentacion(error.message);
      return;
    }

    setPerfil((prev) => (prev ? { ...prev, fotoPresentacionUrl } : prev));
  };

  useEffect(() => {
    const cargarPerfilPublico = async () => {
      if (!nick || !uniqueId) return;
      setLoading(true);
      setNotFound(false);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, nick, unique_id, avatar_url, banner_url, foto_presentacion_url, bio, country, es_caster, horario_stream, links_transmision, liga_1v1, mmr_1v1, nivel_1v1, banca_rota, skin_avatar_activa, borde_basico_activo, borde_grosor, avatar_transparente"
        )
        .eq("nick", nick)
        .eq("unique_id", uniqueId)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const perfilCargado: PerfilPublico = {
        id: data.id,
        nick: data.nick ?? nick,
        uniqueId: data.unique_id,
        avatarUrl: data.avatar_url,
        bannerUrl: data.banner_url,
        fotoPresentacionUrl: data.foto_presentacion_url,
        bio: data.bio,
        country: data.country,
        esCaster: data.es_caster,
        horarioStream: data.horario_stream,
        linksTransmision: (data.links_transmision as LinkTransmision[] | null) ?? [],
        liga: data.liga_1v1,
        mmr: data.mmr_1v1,
        nivel: data.nivel_1v1,
        bancaRota: data.banca_rota,
        razaPrincipal: null,
        razaSecundaria: null,
        skinAvatarActiva: data.skin_avatar_activa,
        bordeBasicoActivo: data.borde_basico_activo,
        bordeGrosor: data.borde_grosor,
        avatarTransparente: data.avatar_transparente,
      };

      // Perfil de juego de StarCraft II (migración 034): opcional, así
      // que puede no existir todavía -- se resuelve el juego_id una
      // vez y se busca la fila puntual de este jugador.
      const idSc2 = await obtenerJuegoIdSc2();
      if (idSc2) {
        const { data: perfilJuegoData } = await supabase
          .from("perfiles_juego")
          .select("datos")
          .eq("user_id", perfilCargado.id)
          .eq("juego_id", idSc2)
          .maybeSingle();
        const datos = perfilJuegoData?.datos as DatosSc2 | undefined;
        perfilCargado.razaPrincipal = datos?.raza_principal ?? null;
        perfilCargado.razaSecundaria = datos?.raza_secundaria ?? null;
      }

      setPerfil(perfilCargado);

      if (perfilCargado.skinAvatarActiva) {
        const { data: skinData } = await supabase
          .from("catalogo_skins_avatar")
          .select("clave")
          .eq("id", perfilCargado.skinAvatarActiva)
          .maybeSingle();
        setSkinAvatarClave((skinData?.clave as SkinAvatarClave | undefined) ?? null);
      } else {
        setSkinAvatarClave(null);
      }

      if (perfilCargado.bordeBasicoActivo) {
        const { data: bordeData } = await supabase
          .from("catalogo_bordes_basicos")
          .select("color_hex")
          .eq("id", perfilCargado.bordeBasicoActivo)
          .maybeSingle();
        setBordeBasicoColorHex(bordeData?.color_hex ?? null);
      } else {
        setBordeBasicoColorHex(null);
      }

      // Título Padre/Hijo activo (si tiene) -- mismo RPC público que
      // usa la Sala de la Fama para el Muro de Jugadores.
      const { data: titulosData } = await supabase.rpc("titulos_activos_todos", { p_tipo: "jugador" });
      const titulos = (titulosData ?? []) as TituloActivoTodos[];
      const relevante = tituloMasRelevante(perfilCargado.id, titulos);
      if (relevante) {
        const { data: otroPerfil } = await supabase
          .from("profiles")
          .select("nick, unique_id")
          .eq("id", relevante.otroId)
          .maybeSingle();
        const nombreOtro = otroPerfil?.nick ? `${otroPerfil.nick}#${otroPerfil.unique_id}` : "alguien";
        setTituloTexto(`${relevante.soyPadre ? "Padre" : "Hijo"} de ${nombreOtro}`);
      } else {
        setTituloTexto(null);
      }

      // Equipo actual (si tiene) -- team_members.user_id -> teams.id.
      const { data: miembroData } = await supabase
        .from("team_members")
        .select("teams(name, tag, logo_url, foto_presentacion_url, disuelto)")
        .eq("user_id", perfilCargado.id)
        .maybeSingle();
      const equipo = miembroData
        ? Array.isArray(miembroData.teams)
          ? miembroData.teams[0]
          : miembroData.teams
        : null;
      const equipoTipado = equipo as
        | { name: string; tag: string; logo_url: string | null; foto_presentacion_url: string | null; disuelto: boolean }
        | null;
      setEquipoActual(
        equipoTipado && !equipoTipado.disuelto
          ? {
              name: equipoTipado.name,
              tag: equipoTipado.tag,
              logoUrl: equipoTipado.logo_url,
              fotoPresentacionUrl: equipoTipado.foto_presentacion_url,
            }
          : null
      );

      setLoading(false);
    };

    cargarPerfilPublico();
  }, [nick, uniqueId]);

  // Pestaña "Actividades" (migración 163): torneos en los que este
  // jugador está inscrito (propia participación, tournament_participants.
  // user_id), con estado real -- abierto/en_curso/finalizado, sin
  // filtrar como el Historial de Mi perfil (ese sí descarta los no
  // finalizados). Mismo patrón que MyTournamentsPage.tsx.
  const [eventosInscritos, setEventosInscritos] = useState<TournamentRow[]>([]);
  const [cargandoEventos, setCargandoEventos] = useState(true);

  useEffect(() => {
    if (!perfil) return;
    setCargandoEventos(true);
    supabase
      .from("tournament_participants")
      .select("tournament_id, tournaments!tournament_id(*)")
      .eq("user_id", perfil.id)
      .then(({ data }) => {
        const lista = (data ?? [])
          .map((fila) => extraerTorneo(fila.tournaments))
          .filter((t): t is TournamentRow => t !== null)
          .sort((a, b) => new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime());
        setEventosInscritos(lista);
        setCargandoEventos(false);
      });
  }, [perfil?.id]);

  if (loading) {
    return <p className="tournament-card-meta">Cargando perfil...</p>;
  }

  if (notFound || !perfil) {
    return (
      <section className="page-placeholder">
        <h1>Jugador no encontrado</h1>
        <p>
          <Link to="/" className="btn-link">
            Volver a inicio
          </Link>
        </p>
      </section>
    );
  }

  // La forma ya no es elegible por el usuario: el avatar de la
  // vitrina pública es SIEMPRE cuadrado (el del header es siempre
  // redondo, ver Header.tsx) -- avatar_forma queda en la base sin
  // usarse acá.
  const claseForma = "avatar-shape-cuadrado";

  // Migración 110: la vitrina pública pasa a ser un carrusel de 2
  // páginas -- "Perfil" (banner, identidad, bio, info) y "Panel", esta
  // última solo cuando quien mira es el dueño de este perfil (no tiene
  // sentido mostrar accesos de gestión a un visitante cualquiera).
  const esMiPropioPerfil = user?.id === perfil.id;

  // Sin foto de presentación propia todavía: la tarjeta muestra el
  // avatar normal como respaldo, nunca queda vacía.
  const fotoPresentacionMostrada = perfil.fotoPresentacionUrl ?? perfil.avatarUrl;

  const inputArchivoFotoPresentacion = esMiPropioPerfil && (
    <input
      ref={fotoPresentacionInputRef}
      type="file"
      accept="image/*"
      className="visually-hidden"
      onChange={handleFotoPresentacionFileChange}
    />
  );

  const recortadorFotoPresentacion = archivoParaRecortarFotoPresentacion && (
    <RecortadorImagenModal
      archivo={archivoParaRecortarFotoPresentacion}
      aspecto={9 / 16}
      titulo="Ajustar foto de presentación"
      onConfirmar={handleConfirmarRecorteFotoPresentacion}
      onCancelar={() => setArchivoParaRecortarFotoPresentacion(null)}
    />
  );

  const bloqueTransmision = perfil.esCaster && (
    <>
      <h3 className="detail-subtitle">
        <Radio size={16} className="icon-inline" aria-hidden="true" />
        Transmisión
      </h3>
      {perfil.linksTransmision.length === 0 ? (
        <p className="detail-empty">Todavía no agregó links de transmisión.</p>
      ) : (
        <div className="detail-map-list">
          {perfil.linksTransmision.map((link, indice) => (
            <a
              key={`${link.plataforma}-${indice}`}
              href={normalizarUrlStream(link.plataforma, link.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="badge badge-format"
            >
              {link.plataforma}
            </a>
          ))}
        </div>
      )}
      {perfil.horarioStream && <p className="tournament-card-meta">Horario habitual: {perfil.horarioStream}</p>}
    </>
  );

  const bloqueEquipo = equipoActual && (
    <Link to={`/equipos/${equipoActual.tag}`} className="ranking-clan-link">
      {equipoActual.logoUrl ? (
        <img src={equipoActual.logoUrl} alt="" className="player-detail-equipo-actual-logo" />
      ) : (
        <span className="player-detail-equipo-actual-logo player-detail-equipo-actual-logo-placeholder">
          {equipoActual.tag.charAt(0)}
        </span>
      )}
      {equipoActual.name}
    </Link>
  );

  // Migración 152: "Estadísticas", "Logros" e "Historial de eventos"
  // se sacaron de este menú -- a pedido del usuario, ya están (o
  // alcanza con lo que ya hay) en esta misma vitrina. "Logros" en
  // particular todavía responde retos de título Padre/Hijo que la
  // pestaña Logros de acá arriba no tiene, pero sigue siendo
  // alcanzable con /perfil?tab=logros aunque no haya acceso visible.
  const contenidoPanelMenu = (
    <div className="team-panel-menu">
      <button type="button" className="team-panel-menu-item" onClick={() => handleAbrirConfiguracion()}>
        <span className="team-panel-menu-item-title">
          <Settings className="icon-inline" />
          Configuración
        </span>
        <span className="team-panel-menu-item-desc">Editar datos, apariencia, juegos e idioma</span>
      </button>
      {/* Corrección: "Panel de Administración" vivía como un botón
          grande aparte, debajo del Panel de control -- pasa a ser un
          acceso más dentro del mismo menú, solo visible para es_admin
          mirando el propio perfil. */}
      {profile?.es_admin && (
        <button type="button" className="team-panel-menu-item" onClick={() => irA("/admin")}>
          <span className="team-panel-menu-item-title">
            <Shield className="icon-inline" />
            Panel de Administración
          </span>
          <span className="team-panel-menu-item-desc">Gestión de la plataforma</span>
        </button>
      )}
    </div>
  );

  const paginaPerfil = (
    <>
      {/* Vista normal (web/celular): banner ancho con el avatar
          superpuesto, sin editar nada desde acá -- eso sigue viviendo
          en Configuración. Se oculta por completo en escritorio (ver
          la vista propia más abajo). */}
      <div className="player-detail-vista-movil">
        <div className="player-detail-banner-wrap">
          {perfil.bannerUrl ? (
            <img src={perfil.bannerUrl} alt="" className="player-detail-banner" />
          ) : (
            <div className="player-detail-banner player-detail-banner-placeholder" />
          )}
          <div className={`player-detail-avatar-overlap ${claseForma}`}>
            <AvatarSkin
              clave={perfil.avatarTransparente ? null : skinAvatarClave}
              bordeColor={perfil.avatarTransparente ? null : bordeBasicoColorHex}
              bordeGrosor={perfil.bordeGrosor}
              forma="cuadrado"
            >
              <Avatar
                url={perfil.avatarUrl}
                nombre={perfil.nick}
                className="player-detail-avatar"
                forma="cuadrado"
              />
            </AvatarSkin>
          </div>
        </div>

        <div className="player-detail-header">
          <div>
            <h1 className="section-title">
              {perfil.nick}
              <span className="profile-nick-id">#{perfil.uniqueId}</span>
            </h1>
            {tituloTexto && <span className="liga-badge">{tituloTexto}</span>}
            {perfil.razaPrincipal && (
              <span className="liga-badge">
                Raza: {perfil.razaPrincipal}
                {perfil.razaSecundaria && ` / ${perfil.razaSecundaria}`}
              </span>
            )}
          </div>

          {/* Mismo criterio que /equipos/:tag: el botón vivía pegado
              abajo de todo -- pasa a la altura del nombre, a la
              derecha. El contenido desplegable sigue más abajo. */}
          {esMiPropioPerfil && (
            <div className="team-panel-toggle-header">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPanelAbierto((a) => !a);
                }}
              >
                {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
              </button>
            </div>
          )}
        </div>

        {/* La bio va acá, inmediatamente debajo del Nick#ID y antes de
            Estadísticas -- no al final de la página. */}
        {perfil.bio && <p className="team-detail-description">{perfil.bio}</p>}

        {/* Dos columnas: a la izquierda, país + Equipo actual (+
            Transmisión si es caster); a la derecha, la tarjeta agrupada
            de barras verticales. En pantallas angostas se apilan, la
            izquierda arriba. */}
        <div className="player-detail-stats-row">
          <div className="player-detail-info-column">
            {perfil.country && (
              <p className="tournament-card-meta">
                País: {COUNTRY_OPTIONS.find((o) => o.value === perfil.country)?.label ?? perfil.country}
              </p>
            )}
            {bloqueEquipo}
            {bloqueTransmision}
          </div>
        </div>
      </div>

      {/* Vista de escritorio (rediseño): banner ancho completo, con el
          avatar superpuesto en su esquina y el botón de Panel de
          control flotando encima, a la derecha. Debajo, la identidad
          (nombre, título, raza, país, equipo) y las pestañas
          Perfil/Stream/Logros -- "Perfil" muestra una grilla de 3
          columnas (foto de presentación / descripción / vistas previas
          de Stream y Logros), las otras dos pestañas muestran ese
          mismo contenido expandido. Reemplaza al modelo de la vista
          móvil de arriba -- nunca se muestran los dos a la vez. */}
      <div className="player-detail-vista-escritorio">
        <FondoParticulas />
        <div className="player-hero-banner-wrap">
          {perfil.bannerUrl ? (
            <img src={perfil.bannerUrl} alt="" className="player-detail-banner player-hero-banner" />
          ) : (
            <div className="player-detail-banner player-detail-banner-placeholder player-hero-banner" />
          )}
          <div className={`player-detail-avatar-overlap ${claseForma}`}>
            <AvatarSkin
              clave={perfil.avatarTransparente ? null : skinAvatarClave}
              bordeColor={perfil.avatarTransparente ? null : bordeBasicoColorHex}
              bordeGrosor={perfil.bordeGrosor}
              forma="cuadrado"
            >
              <Avatar
                url={perfil.avatarUrl}
                nombre={perfil.nick}
                className="player-detail-avatar"
                forma="cuadrado"
              />
            </AvatarSkin>
          </div>
          {esMiPropioPerfil && (
            <div className="player-hero-panel-btn">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPanelAbierto((a) => !a);
                }}
              >
                {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
              </button>

              {/* Ventana centrada con borde iluminado, a pedido del
                  usuario -- mismo tratamiento que el Panel de control de
                  Mi Clan (.team-leader-panel-propio en TeamDetailPage.tsx),
                  en vez del desplegable anclado al botón que tenía antes.
                  Mismo contenido que la versión en línea de mobile/PWA
                  (contenidoPanelMenu). */}
              {panelAbierto &&
                createPortal(
                  <div className="modal-backdrop" onClick={() => setPanelAbierto(false)}>
                    <div className="team-leader-panel team-leader-panel-propio" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="modal-close"
                        onClick={() => setPanelAbierto(false)}
                        aria-label="Cerrar panel de control"
                      >
                        <X size={18} />
                      </button>
                      {contenidoPanelMenu}
                    </div>
                  </div>,
                  document.body
                )}
            </div>
          )}
        </div>

        {/* Corrección: las pestañas ocupaban su propia fila completa,
            abajo del nombre -- a pedido del usuario, pasan a vivir al
            lado del nombre (mismo renglón), para liberar alto vertical
            y darle más lugar a las 3 cajas de "Perfil" para acomodarse. */}
        <div className="player-hero-identity-row">
        <div className="player-hero-identity">
          <h1 className="section-title">
            {perfil.nick}
            <span className="profile-nick-id">#{perfil.uniqueId}</span>
          </h1>
          {tituloTexto && (
            <div className="player-hero-badges">
              <span className="liga-badge">{tituloTexto}</span>
            </div>
          )}
        </div>

        {/* Migración 153: mismo diseño de pestañas que Mi Clan
            (.team-info-tabs/.team-info-tab, antes .player-tabs/
            .player-tab-btn propios) -- a pedido del usuario, para que
            las dos páginas se vean consistentes. */}
        <div className="team-info-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tabEscritorio === "perfil"}
            className={`team-info-tab ${tabEscritorio === "perfil" ? "is-active" : ""}`}
            onClick={() => setTabEscritorio("perfil")}
          >
            <User size={16} className="icon-inline" aria-hidden="true" />
            Perfil
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabEscritorio === "stream"}
            className={`team-info-tab ${tabEscritorio === "stream" ? "is-active" : ""}`}
            onClick={() => setTabEscritorio("stream")}
          >
            <Radio size={16} className="icon-inline" aria-hidden="true" />
            Actividades
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabEscritorio === "logros"}
            className={`team-info-tab ${tabEscritorio === "logros" ? "is-active" : ""}`}
            onClick={() => setTabEscritorio("logros")}
          >
            <Award size={16} className="icon-inline" aria-hidden="true" />
            Logros
          </button>
        </div>
        </div>

        {tabEscritorio === "perfil" && (
          <div className="player-tab-grid">
            <div className="player-tab-col-foto">
              <div className="player-tab-foto-wrap">
                {/* Marco decorativo tipo "corner bracket" (a pedido del
                    usuario, adaptado de una referencia con estética Art
                    Decó dorada -- acá recoloreado al acento cian de
                    siempre en vez de adoptar esa paleta/tipografías,
                    para que se sienta parte de RemorApp). Puramente
                    visual, aria-hidden. */}
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />
                {fotoPresentacionMostrada ? (
                  <Avatar
                    url={fotoPresentacionMostrada}
                    nombre={perfil.nick}
                    className="player-tab-foto"
                    forma="cuadrado"
                  />
                ) : (
                  <div className="player-tab-foto player-tab-foto-vacia">
                    <span>Tu foto aquí</span>
                    <span className="player-tab-foto-vacia-proporcion">(9:16)</span>
                  </div>
                )}
                {esMiPropioPerfil && (
                  <button
                    type="button"
                    className="player-detail-foto-presentacion-edit-btn"
                    onClick={() => fotoPresentacionInputRef.current?.click()}
                    disabled={subiendoFotoPresentacion}
                    aria-label="Subir una foto propia"
                    title="Subir una foto propia"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {/* Migración 154: solo aparece si pertenezco a un clan
                    y ese clan ya tiene su propia foto de presentación
                    subida -- copia esa URL a la mía, un click, sin
                    pasar por el recortador de nuevo. */}
                {esMiPropioPerfil && equipoActual?.fotoPresentacionUrl && (
                  <button
                    type="button"
                    className="player-detail-foto-presentacion-clan-btn"
                    onClick={handleUsarFotoDelClan}
                    disabled={subiendoFotoPresentacion}
                    aria-label="Usar la foto de mi clan"
                    title="Usar la foto de mi clan"
                  >
                    <Shield size={14} />
                  </button>
                )}
              </div>
              {errorFotoPresentacion && <div className="form-error">{errorFotoPresentacion}</div>}
            </div>

            {/* Corrección: "Sobre mí" y "Clan"/"Stream" se estiraban
                para igualar la fila entera del grid (dictada por la
                foto, 9:16, la más alta de las 3) -- "Sobre mí" quedaba
                una caja enorme casi vacía. Envueltas juntas acá, se
                miden SOLO entre sí (align-items:stretch de
                .player-tab-contenido más abajo), sin la foto de por
                medio -- así la foto puede seguir siendo alta sin
                arrastrar a las otras dos. */}
            <div className="player-tab-contenido">
            <div className="player-tab-col-main">
              {/* A pedido del usuario: el título vive arriba de la caja
                  (como en "Información del clan" de Mi Clan), no
                  adentro. */}
              <h3 className="detail-subtitle">Sobre mí</h3>
              <div className="detail-card player-tab-bio-card player-tab-standalone-card">
                {/* Mismo marco "corner bracket" que la foto de
                    presentación y la tarjeta del clan -- a pedido del
                    usuario, para que las tres cajas de "Perfil" se vean
                    consistentes entre sí. */}
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />

                {editandoBio ? (
                  <>
                    <textarea
                      className="form-textarea player-tab-bio-textarea"
                      value={bioEditada}
                      onChange={(e) => setBioEditada(e.target.value)}
                      maxLength={500}
                      disabled={guardandoBio}
                      autoFocus
                    />
                    {errorBio && <div className="form-error">{errorBio}</div>}
                    <div className="player-tab-bio-acciones">
                      <button type="button" className="btn btn-primary" disabled={guardandoBio} onClick={handleGuardarBio}>
                        {guardandoBio ? "Guardando..." : "Guardar"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={guardandoBio}
                        onClick={() => setEditandoBio(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {perfil.bio ? (
                      <p className="team-detail-description">{perfil.bio}</p>
                    ) : (
                      <p className="detail-empty">Todavía no escribió una descripción personal.</p>
                    )}
                    {esMiPropioPerfil && (
                      <button
                        type="button"
                        className="player-tab-bio-edit-btn"
                        onClick={handleAbrirEdicionBio}
                        aria-label="Editar Sobre mí"
                        title="Editar Sobre mí"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="player-tab-col-side">
              {equipoActual && (
                <>
                  <h3 className="detail-subtitle">Clan</h3>
                  <Link to={`/equipos/${equipoActual.tag}`} className="player-tab-preview-card">
                    {/* Mismo marco decorativo "corner bracket" de la foto de
                        presentación (a pedido del usuario), acá también. */}
                    <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
                    <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
                    <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
                    <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />
                    {equipoActual.logoUrl ? (
                      <img src={equipoActual.logoUrl} alt="" className="clan-name-logo" />
                    ) : (
                      <span className="clan-name-logo clan-name-logo-placeholder">
                        {equipoActual.tag.charAt(0)}
                      </span>
                    )}
                    <span className="player-tab-preview-card-info">
                      <span className="player-tab-preview-card-desc">{equipoActual.name}</span>
                    </span>
                    <ChevronRight size={16} className="player-tab-preview-card-chevron" aria-hidden="true" />
                  </Link>
                </>
              )}

              {/* Migración 158: tarjeta rápida de Stream, debajo de
                  "Clan" -- Twitch/Discord/YouTube con ícono propio
                  (ver IconosRedes.tsx), edición rápida con el mismo
                  lápiz de siempre. Título AFUERA de la caja (migración
                  163), igual que "Sobre mí"/"Clan" acá al lado. */}
              <h3 className="detail-subtitle">
                <Radio size={16} className="icon-inline" aria-hidden="true" />
                Stream
              </h3>
              <div className="detail-card player-tab-stream-card">
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
                <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />
                {editandoLinksRapidos ? (
                  <>
                    {errorLinksRapidos && <div className="form-error">{errorLinksRapidos}</div>}
                    {PLATAFORMAS_STREAM_RAPIDO.map((plataforma) => (
                      <div className="form-group" key={plataforma}>
                        <label className="form-label" htmlFor={`stream-rapido-${plataforma}`}>
                          {plataforma}
                        </label>
                        <input
                          id={`stream-rapido-${plataforma}`}
                          className="form-input"
                          type="text"
                          placeholder={`Link de ${plataforma}`}
                          value={linksRapidosEditados[plataforma] ?? ""}
                          onChange={(e) =>
                            setLinksRapidosEditados((prev) => ({ ...prev, [plataforma]: e.target.value }))
                          }
                          disabled={guardandoLinksRapidos}
                        />
                      </div>
                    ))}
                    <div className="player-tab-bio-acciones">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={guardandoLinksRapidos}
                        onClick={handleGuardarLinksRapidos}
                      >
                        {guardandoLinksRapidos ? "Guardando..." : "Guardar"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={guardandoLinksRapidos}
                        onClick={() => setEditandoLinksRapidos(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="player-tab-stream-links">
                      {PLATAFORMAS_STREAM_RAPIDO.map((plataforma) => {
                        const link = perfil.linksTransmision.find(
                          (l) => l.plataforma.toLowerCase() === plataforma.toLowerCase()
                        );
                        const Icono =
                          plataforma === "Twitch" ? TwitchIcon : plataforma === "Discord" ? DiscordIcon : YoutubeIcon;
                        return link ? (
                          <a
                            key={plataforma}
                            href={normalizarUrlStream(plataforma, link.url)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="player-tab-stream-link"
                          >
                            <Icono size={18} style={{ color: COLOR_PLATAFORMA_STREAM[plataforma] }} />
                            {extraerNombreCanal(link.url)}
                          </a>
                        ) : (
                          <span key={plataforma} className="player-tab-stream-link player-tab-stream-link-vacio">
                            <Icono size={18} style={{ color: COLOR_PLATAFORMA_STREAM[plataforma] }} />
                            {plataforma}
                          </span>
                        );
                      })}
                    </div>
                    {esMiPropioPerfil && (
                      <button
                        type="button"
                        className="player-tab-bio-edit-btn"
                        onClick={handleAbrirEdicionLinksRapidos}
                        aria-label="Editar links de Stream"
                        title="Editar links de Stream"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            </div>
          </div>
        )}

        {tabEscritorio === "stream" && (
          <>
            {/* Migración 163: lista real de eventos -- antes "Actividades"
                solo repetía la Transmisión de la pestaña "Perfil".
                Corrección (migración 166): a pedido del usuario, se saca
                del todo esa Transmisión duplicada de acá -- Actividades
                es solo para ver en qué estás inscrito, Transmisión ya
                vive en "Perfil". Torneos en los que este jugador está
                inscrito, con su estado real (abierto/en curso/
                finalizado) -- clic manda al torneo. */}
            <h3 className="detail-subtitle">Eventos inscritos</h3>
            <div className="detail-card player-tab-standalone-card">
              <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />
              {cargandoEventos ? (
                <p className="tournament-card-meta">Cargando...</p>
              ) : eventosInscritos.length === 0 ? (
                <p className="detail-empty">Todavía no se inscribió a ningún torneo.</p>
              ) : (
                <div className="tournament-grid">
                  {eventosInscritos.map((torneo) => (
                    <Link key={torneo.id} to={`/tournaments/${torneo.id}`} className="tournament-card">
                      <div>
                        <div className="tournament-card-head">
                          <span className="badge badge-format">{getFormatoLabel(torneo.formato)}</span>
                          <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
                          <span className="badge badge-format">{ESTADO_EVENTO_LABEL[torneo.estado]}</span>
                        </div>
                        <h3 className="tournament-card-title">{torneo.nombre}</h3>
                        <p className="tournament-card-meta">Comienza el {formatFecha(torneo.fecha_inicio)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tabEscritorio === "logros" && (
          <>
            {/* Migración 167, a pedido del usuario: Logros es solo lo
                que GANÓ (torneos por ligas por ahora) -- Títulos
                Padre/Hijo se saca de acá, ese sistema pasa a ser
                privado entre quienes lo juegan, no una vidriera
                pública de logros. */}
            <h3 className="detail-subtitle">
              <Award size={16} className="icon-inline" aria-hidden="true" />
              Torneos
            </h3>
            <LogrosTorneosJugadorList userId={perfil.id} className="detail-participant-list" />
          </>
        )}
      </div>

      {inputArchivoFotoPresentacion}
      {recortadorFotoPresentacion}
    </>
  );

  // Panel de control: solo cuando el usuario ve su propio perfil,
  // nunca en el de otra persona. Mismo patrón visual que el de
  // /equipos/:tag, pero acá cada opción es un acceso directo a una
  // sección de ProfilePage.tsx (esta página se mantiene de solo
  // lectura, sin ningún formulario propio). Versión EN LÍNEA, para
  // mobile/PWA -- en escritorio queda oculta (ver
  // .player-detail-panel-inline en halcon.css): ahí el mismo
  // contenido se abre como desplegable anclado al botón, para no
  // empujar el resto de la ficha hacia abajo (a pedido del usuario,
  // no le gustaba tener que hacer scroll para verlo).
  const paginaPanel = (
    <>
      {user?.id === perfil.id && panelAbierto && (
        <div className="team-control-panel-wrap player-detail-panel-inline">
          <div className="team-leader-panel">{contenidoPanelMenu}</div>
        </div>
      )}
    </>
  );

  // El Panel de control y el Panel de Administración van en la MISMA
  // página que el resto del perfil -- antes vivían en una segunda
  // página del carrusel, pero había espacio de sobra para sumarlos
  // acá abajo, y así se evita el scroll lateral en el perfil propio
  // (paginaPanel ya no renderiza nada cuando no es el perfil propio).
  const pagina = (
    <>
      {paginaPerfil}
      {paginaPanel}
    </>
  );

  return (
    <div className="perfil-carrusel-page">
      <Carrusel paginas={[{ key: "perfil", contenido: pagina }]} />
    </div>
  );
}
