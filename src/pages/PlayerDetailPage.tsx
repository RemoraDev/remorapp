import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Avatar from "../components/Avatar";
import MmrProgressBar from "../components/MmrProgressBar";
import PercentBar from "../components/PercentBar";
import type { AvatarForma, LinkTransmision } from "../types/profile";
import type { TituloActivoTodos } from "../types/titulos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";

interface PerfilPublico {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
  bannerUrl: string | null;
  bio: string | null;
  esCaster: boolean;
  carisma: number;
  horarioStream: string | null;
  linksTransmision: LinkTransmision[];
  liga: string;
  mmr: number;
  nivel: number;
  bancaRota: boolean;
  valentiaJugador: number;
  responsabilidadCw: number;
  responsabilidadTorneos: number;
  razaPrincipal: RazaSc2 | null;
  razaSecundaria: RazaSc2 | null;
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

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [tituloTexto, setTituloTexto] = useState<string | null>(null);
  const [equipoActual, setEquipoActual] = useState<EquipoActual | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const cargarPerfilPublico = async () => {
      if (!nick || !uniqueId) return;
      setLoading(true);
      setNotFound(false);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, nick, unique_id, avatar_url, avatar_forma, banner_url, bio, es_caster, carisma, horario_stream, links_transmision, liga_1v1, mmr_1v1, nivel_1v1, banca_rota, valentia_jugador, responsabilidad_cw, responsabilidad_torneos"
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
        avatarForma: data.avatar_forma,
        bannerUrl: data.banner_url,
        bio: data.bio,
        esCaster: data.es_caster,
        carisma: data.carisma,
        horarioStream: data.horario_stream,
        linksTransmision: (data.links_transmision as LinkTransmision[] | null) ?? [],
        liga: data.liga_1v1,
        mmr: data.mmr_1v1,
        nivel: data.nivel_1v1,
        bancaRota: data.banca_rota,
        valentiaJugador: data.valentia_jugador,
        responsabilidadCw: data.responsabilidad_cw,
        responsabilidadTorneos: data.responsabilidad_torneos,
        razaPrincipal: null,
        razaSecundaria: null,
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
      const equipoTipado = equipo as
        | { name: string; tag: string; logo_url: string | null; disuelto: boolean }
        | null;
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

  const claseForma = perfil.avatarForma === "cuadrado" ? "avatar-shape-cuadrado" : "avatar-shape-redondo";

  return (
    <section className="section section-page">
      <div className="player-detail-banner-wrap">
        {perfil.bannerUrl ? (
          <img src={perfil.bannerUrl} alt="" className="player-detail-banner" />
        ) : (
          <div className="player-detail-banner player-detail-banner-placeholder" />
        )}
        <div className={`player-detail-avatar-overlap ${claseForma}`}>
          <Avatar
            url={perfil.avatarUrl}
            nombre={perfil.nick}
            className="player-detail-avatar"
            forma={perfil.avatarForma}
          />
          <span className="nivel-badge nivel-badge-corner">Nv. {perfil.nivel}</span>
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

      <h2 className="detail-subtitle">Estadísticas</h2>
      <MmrProgressBar mmr={perfil.mmr} liga={perfil.liga} bancaRota={perfil.bancaRota} />

      {/* Tarjeta agrupada con fondo propio para las barras verticales
          (siempre Valentía y Responsabilidad en Torneos; Responsabilidad
          en Clan War solo con equipo actual; Carisma solo si es
          caster), con la sección de transmisión AL COSTADO -- no
          debajo -- cuando es caster. */}
      <div className="player-detail-stats-row">
        <div className="player-detail-stats-column stats-card-group">
          <PercentBar label="Valentía del jugador" value={perfil.valentiaJugador} vertical />
          <PercentBar label="Responsabilidad en Torneos" value={perfil.responsabilidadTorneos} vertical />
          {equipoActual && (
            <PercentBar label="Responsabilidad en Clan War" value={perfil.responsabilidadCw} vertical />
          )}
          {perfil.esCaster && <PercentBar label="Carisma" value={perfil.carisma} vertical />}
        </div>

        {perfil.esCaster && (
          <div className="player-detail-stream-column">
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
          </div>
        )}
      </div>

      {equipoActual && (
        <>
          <h2 className="detail-subtitle">Equipo actual</h2>
          <Link to={`/equipos/${equipoActual.tag}`} className="team-card">
            {equipoActual.logoUrl ? (
              <img src={equipoActual.logoUrl} alt={equipoActual.name} className="team-card-logo" />
            ) : (
              <div className="team-card-logo team-card-logo-placeholder">{equipoActual.tag.charAt(0)}</div>
            )}
            <div className="team-card-info">
              <p className="team-card-name">{equipoActual.name}</p>
              <p className="team-card-tag">[{equipoActual.tag}]</p>
            </div>
          </Link>
        </>
      )}

      {/* La bio va al final de todo el perfil, a propósito. */}
      {perfil.bio && <p className="team-detail-description">{perfil.bio}</p>}
    </section>
  );
}
