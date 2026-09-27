import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart3, Award, History, Settings, Shield, Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import AvatarSkin from "../components/AvatarSkin";
import Carrusel from "../components/Carrusel";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import { COUNTRY_OPTIONS } from "../types/profile";
import type { Country, LinkTransmision } from "../types/profile";
import type { SkinAvatarClave } from "../types/skins";
import type { TituloActivoTodos } from "../types/titulos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";

interface PerfilPublico {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
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
}

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
  const { user, profile, refreshProfile } = useAuth();

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [skinAvatarClave, setSkinAvatarClave] = useState<SkinAvatarClave | null>(null);
  const [bordeBasicoColorHex, setBordeBasicoColorHex] = useState<string | null>(null);
  const [tituloTexto, setTituloTexto] = useState<string | null>(null);
  const [equipoActual, setEquipoActual] = useState<EquipoActual | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);

  // Edición rápida de foto desde la tarjeta de presentación de
  // escritorio (migración 124): sin texto ni botón de "Guardar" --
  // elegís el archivo, ajustás el recorte, y se sube sola. Mismo
  // storage/columna que la edición completa de ProfilePage.tsx
  // (Configuración > Apariencia > Subir avatar), solo que sin esa
  // vuelta -- pensada para el pequeño lápiz sobre el avatar.
  const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [archivoParaRecortarAvatar, setArchivoParaRecortarAvatar] = useState<File | null>(null);
  const [subiendoAvatar, setSubiendoAvatar] = useState(false);
  const [errorAvatar, setErrorAvatar] = useState<string | null>(null);

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorAvatar(null);
    event.target.value = "";
    if (!archivo) return;
    if (archivo.size > AVATAR_MAX_BYTES) {
      setErrorAvatar("La foto no puede pesar más de 2MB.");
      return;
    }
    setArchivoParaRecortarAvatar(archivo);
  };

  const handleConfirmarRecorteAvatar = async (recorte: Blob, tieneTransparencia: boolean) => {
    setArchivoParaRecortarAvatar(null);
    if (!user) return;

    setSubiendoAvatar(true);
    setErrorAvatar(null);

    try {
      const extension = recorte.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/${Date.now()}-avatar.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(ruta, recorte, { contentType: recorte.type });

      if (uploadError) {
        setErrorAvatar("No se pudo subir la foto: " + uploadError.message);
        return;
      }

      const avatarUrl = supabase.storage.from("avatars").getPublicUrl(ruta).data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, avatar_transparente: tieneTransparencia })
        .eq("id", user.id);

      if (updateError) {
        setErrorAvatar(updateError.message);
        return;
      }

      setPerfil((prev) => (prev ? { ...prev, avatarUrl, avatarTransparente: tieneTransparencia } : prev));
      await refreshProfile();
    } catch {
      setErrorAvatar("No se pudo procesar la foto, prueba con otra imagen.");
    } finally {
      setSubiendoAvatar(false);
    }
  };

  useEffect(() => {
    const cargarPerfilPublico = async () => {
      if (!nick || !uniqueId) return;
      setLoading(true);
      setNotFound(false);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, nick, unique_id, avatar_url, banner_url, bio, country, es_caster, horario_stream, links_transmision, liga_1v1, mmr_1v1, nivel_1v1, banca_rota, skin_avatar_activa, borde_basico_activo, borde_grosor, avatar_transparente"
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
        .select("teams(name, tag, logo_url, disuelto)")
        .eq("user_id", perfilCargado.id)
        .maybeSingle();
      const equipo = miembroData
        ? Array.isArray(miembroData.teams)
          ? miembroData.teams[0]
          : miembroData.teams
        : null;
      const equipoTipado = equipo as { name: string; tag: string; logo_url: string | null; disuelto: boolean } | null;
      setEquipoActual(
        equipoTipado && !equipoTipado.disuelto
          ? { name: equipoTipado.name, tag: equipoTipado.tag, logoUrl: equipoTipado.logo_url }
          : null
      );

      setLoading(false);
    };

    cargarPerfilPublico();
  }, [nick, uniqueId]);

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

  const inputArchivoAvatar = esMiPropioPerfil && (
    <input
      ref={avatarInputRef}
      type="file"
      accept="image/*"
      className="visually-hidden"
      onChange={handleAvatarFileChange}
    />
  );

  const recortadorAvatar = archivoParaRecortarAvatar && (
    <RecortadorImagenModal
      archivo={archivoParaRecortarAvatar}
      aspecto={1}
      titulo="Ajustar foto de perfil"
      onConfirmar={handleConfirmarRecorteAvatar}
      onCancelar={() => setArchivoParaRecortarAvatar(null)}
    />
  );

  const bloqueTransmision = perfil.esCaster && (
    <>
      <h3 className="detail-subtitle">Transmisión</h3>
      {perfil.linksTransmision.length === 0 ? (
        <p className="detail-empty">Todavía no agregó links de transmisión.</p>
      ) : (
        <div className="detail-map-list">
          {perfil.linksTransmision.map((link, indice) => (
            <a
              key={`${link.plataforma}-${indice}`}
              href={link.url}
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
              <button type="button" className="btn btn-primary" onClick={() => setPanelAbierto((a) => !a)}>
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

      {/* Vista de escritorio (migración 124): banner a la mitad de
          ancho con el botón de Panel de control al lado (en vez de
          abajo de todo), y una tarjeta de presentación centrada
          (foto -- editable con el lápiz si es tu propio perfil --,
          nombre, país, equipo y transmisión) con la descripción
          personal aparte, a la derecha. Reemplaza al modelo de arriba
          -- nunca se muestran los dos a la vez. */}
      <div className="player-detail-vista-escritorio">
        <div className="player-detail-escritorio-top">
          <div className="player-detail-banner-wrap player-detail-escritorio-banner-wrap">
            {perfil.bannerUrl ? (
              <img src={perfil.bannerUrl} alt="" className="player-detail-banner" />
            ) : (
              <div className="player-detail-banner player-detail-banner-placeholder" />
            )}
          </div>
          {esMiPropioPerfil && (
            <div className="player-detail-escritorio-panel-btn">
              <button type="button" className="btn btn-primary" onClick={() => setPanelAbierto((a) => !a)}>
                {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
              </button>
            </div>
          )}
        </div>

        <div className="player-detail-escritorio-main">
          <div className="player-detail-escritorio-card">
            <div className={`player-detail-escritorio-avatar-wrap ${claseForma}`}>
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
              {esMiPropioPerfil && (
                <button
                  type="button"
                  className="player-detail-avatar-edit-btn"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={subiendoAvatar}
                  aria-label="Cambiar foto de perfil"
                  title="Cambiar foto de perfil"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
            {errorAvatar && <div className="form-error">{errorAvatar}</div>}

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
            {perfil.country && (
              <p className="tournament-card-meta">
                País: {COUNTRY_OPTIONS.find((o) => o.value === perfil.country)?.label ?? perfil.country}
              </p>
            )}
            {bloqueEquipo}
            {bloqueTransmision}
          </div>

          <div className="player-detail-escritorio-bio">
            <h3 className="detail-subtitle">Descripción</h3>
            {perfil.bio ? (
              <p className="team-detail-description">{perfil.bio}</p>
            ) : (
              <p className="detail-empty">Todavía no escribió una descripción personal.</p>
            )}
          </div>
        </div>
      </div>

      {inputArchivoAvatar}
      {recortadorAvatar}
    </>
  );

  const paginaPanel = (
    <>
      {/* Panel de control: solo cuando el usuario ve su propio perfil,
          nunca en el de otra persona. Mismo patrón visual que el de
          /equipos/:tag, pero acá cada opción es un acceso directo a
          una sección de ProfilePage.tsx (esta página se mantiene de
          solo lectura, sin ningún formulario propio). El botón para
          abrirlo/cerrarlo vive a la altura del nombre (ver el header
          más arriba) -- acá solo queda el contenido desplegable. */}
      {user?.id === perfil.id && panelAbierto && (
        <div className="team-control-panel-wrap">
          <div className="team-leader-panel">
            {/* Reorganización: 4 accesos, en línea con el Panel de
                control de ProfilePage.tsx (esta página se mantiene de
                solo lectura, acá solo se navega con ?tab=). "Editar
                datos" y "Editar datos de juego" ya no son accesos
                sueltos -- viven dentro de Configuración. */}
            <div className="team-panel-menu">
              <Link to="/perfil?tab=estadisticas" className="team-panel-menu-item">
                <span className="team-panel-menu-item-title">
                  <BarChart3 className="icon-inline" />
                  Estadísticas
                </span>
                <span className="team-panel-menu-item-desc">
                  Valentía del jugador y Responsabilidad en Torneos y Clan War
                </span>
              </Link>
              <Link to="/perfil?tab=logros" className="team-panel-menu-item">
                <span className="team-panel-menu-item-title">
                  <Award className="icon-inline" />
                  Logros
                </span>
                <span className="team-panel-menu-item-desc">
                  Títulos por nivel y el gestor de títulos Padre/Hijo
                </span>
              </Link>
              <Link to="/perfil?tab=historial" className="team-panel-menu-item">
                <span className="team-panel-menu-item-title">
                  <History className="icon-inline" />
                  Historial de eventos
                </span>
                <span className="team-panel-menu-item-desc">Clan Wars y torneos en los que jugaste</span>
              </Link>
              <Link to="/perfil?tab=configuracion" className="team-panel-menu-item">
                <span className="team-panel-menu-item-title">
                  <Settings className="icon-inline" />
                  Configuración
                </span>
                <span className="team-panel-menu-item-desc">
                  Editar datos, transmisión, apariencia, juegos e idioma
                </span>
              </Link>
              {/* Corrección: "Panel de Administración" vivía como un
                  botón grande aparte, debajo del Panel de control --
                  pasa a ser un acceso más dentro del mismo menú, solo
                  visible para es_admin mirando el propio perfil. */}
              {profile?.es_admin && (
                <Link to="/admin" className="team-panel-menu-item">
                  <span className="team-panel-menu-item-title">
                    <Shield className="icon-inline" />
                    Panel de Administración
                  </span>
                  <span className="team-panel-menu-item-desc">Gestión de la plataforma</span>
                </Link>
              )}
            </div>
          </div>
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
