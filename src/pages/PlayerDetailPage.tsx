import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import AvatarSkin from "../components/AvatarSkin";
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
  const { user, profile } = useAuth();

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [skinAvatarClave, setSkinAvatarClave] = useState<SkinAvatarClave | null>(null);
  const [bordeBasicoColorHex, setBordeBasicoColorHex] = useState<string | null>(null);
  const [tituloTexto, setTituloTexto] = useState<string | null>(null);
  const [equipoActual, setEquipoActual] = useState<EquipoActual | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);

  useEffect(() => {
    const cargarPerfilPublico = async () => {
      if (!nick || !uniqueId) return;
      setLoading(true);
      setNotFound(false);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, nick, unique_id, avatar_url, banner_url, bio, country, es_caster, horario_stream, links_transmision, liga_1v1, mmr_1v1, nivel_1v1, banca_rota, skin_avatar_activa, borde_basico_activo, borde_grosor"
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

  return (
    <section className="section section-page">
      <div className="player-detail-banner-wrap">
        {perfil.bannerUrl ? (
          <img src={perfil.bannerUrl} alt="" className="player-detail-banner" />
        ) : (
          <div className="player-detail-banner player-detail-banner-placeholder" />
        )}
        <div className={`player-detail-avatar-overlap ${claseForma}`}>
          <AvatarSkin
            clave={skinAvatarClave}
            bordeColor={bordeBasicoColorHex}
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

          {/* Tarjeta de clan (mismo componente .team-card que la grilla
              de /equipos): nombre completo + logo, sin tag y sin el
              banner del equipo, que ya se sacó antes de acá por verse
              mal en este espacio chico. */}
          {equipoActual && (
            <Link to={`/equipos/${equipoActual.tag}`} className="team-card">
              {equipoActual.logoUrl ? (
                <img src={equipoActual.logoUrl} alt="" className="team-card-logo" />
              ) : (
                <div className="team-card-logo team-card-logo-placeholder">{equipoActual.tag.charAt(0)}</div>
              )}
              <div className="team-card-info">
                <p className="team-card-meta">Equipo actual</p>
                <p className="team-card-name">{equipoActual.name}</p>
              </div>
            </Link>
          )}

          {perfil.esCaster && (
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
              {perfil.horarioStream && (
                <p className="tournament-card-meta">Horario habitual: {perfil.horarioStream}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Panel de control: solo cuando el usuario ve su propio perfil,
          nunca en el de otra persona. Mismo patrón visual que el de
          /equipos/:tag, pero acá cada opción es un acceso directo a
          una sección de ProfilePage.tsx (esta página se mantiene de
          solo lectura, sin ningún formulario propio). */}
      {user?.id === perfil.id && (
        <div className="team-control-panel-wrap">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setPanelAbierto((a) => !a)}>
            {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
          </button>

          {panelAbierto && (
            <div className="team-leader-panel">
              {/* Reorganización: 4 accesos, en línea con el Panel de
                  control de ProfilePage.tsx (esta página se mantiene de
                  solo lectura, acá solo se navega con ?tab=). "Editar
                  datos" y "Editar datos de juego" ya no son accesos
                  sueltos -- viven dentro de Configuración. */}
              <div className="team-panel-menu">
                <Link to="/perfil?tab=estadisticas" className="team-panel-menu-item">
                  <span className="team-panel-menu-item-title">Estadísticas</span>
                  <span className="team-panel-menu-item-desc">
                    Valentía del jugador y Responsabilidad en Torneos y Clan War
                  </span>
                </Link>
                <Link to="/perfil?tab=logros" className="team-panel-menu-item">
                  <span className="team-panel-menu-item-title">Logros</span>
                  <span className="team-panel-menu-item-desc">
                    Títulos por nivel y el gestor de títulos Padre/Hijo
                  </span>
                </Link>
                <Link to="/perfil?tab=historial" className="team-panel-menu-item">
                  <span className="team-panel-menu-item-title">Historial de eventos</span>
                  <span className="team-panel-menu-item-desc">Clan Wars y torneos en los que jugaste</span>
                </Link>
                <Link to="/perfil?tab=configuracion" className="team-panel-menu-item">
                  <span className="team-panel-menu-item-title">Configuración</span>
                  <span className="team-panel-menu-item-desc">
                    Editar datos, transmisión, apariencia, juegos e idioma
                  </span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Panel de Administración: acceso completamente separado del
          Panel de control -- uno es la gestión personal como jugador,
          el otro es el poder del dueño de la plataforma sobre TODA
          ella, así que no vive anidado dentro del otro. Solo visible
          para es_admin, mirando el propio perfil. */}
      {user?.id === perfil.id && profile?.es_admin && (
        <div className="team-control-panel-wrap">
          <Link to="/admin" className="btn btn-primary btn-block">
            Panel de Administración
          </Link>
        </div>
      )}
    </section>
  );
}
