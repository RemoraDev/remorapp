import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { recortarImagenConProporcion } from "../lib/teams";
import Avatar from "../components/Avatar";
import MmrProgressBar from "../components/MmrProgressBar";
import PercentBar from "../components/PercentBar";
import type { AvatarForma } from "../types/profile";
import type { TituloActivoTodos } from "../types/titulos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";

const BANNER_MAX_BYTES = 3 * 1024 * 1024;

interface PerfilPublico {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
  bannerUrl: string | null;
  bio: string | null;
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

export default function PlayerDetailPage() {
  const { nick, uniqueId } = useParams<{ nick: string; uniqueId: string }>();
  const { user } = useAuth();

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [tituloTexto, setTituloTexto] = useState<string | null>(null);
  const [equipoActual, setEquipoActual] = useState<EquipoActual | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // --- Edición del propio perfil público: banner y bio ---
  const [bio, setBio] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cargarPerfilPublico = async () => {
    if (!nick || !uniqueId) return;
    setLoading(true);
    setNotFound(false);

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, nick, unique_id, avatar_url, avatar_forma, banner_url, bio, liga_1v1, mmr_1v1, nivel_1v1, banca_rota, valentia_jugador, responsabilidad_cw, responsabilidad_torneos"
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
    // que puede no existir todavía -- se resuelve el juego_id una vez
    // y se busca la fila puntual de este jugador.
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
    setBio(data.bio ?? "");

    // Título Padre/Hijo activo (si tiene) -- mismo RPC público que usa
    // la Sala de la Fama para el Muro de Jugadores.
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

  useEffect(() => {
    cargarPerfilPublico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nick, uniqueId]);

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorGuardar(null);
    setGuardado(false);

    if (!archivo) {
      setBannerFile(null);
      setBannerPreview(null);
      return;
    }

    if (archivo.size > BANNER_MAX_BYTES) {
      setErrorGuardar("El banner no puede pesar más de 3MB.");
      event.target.value = "";
      return;
    }

    setBannerFile(archivo);
    setBannerPreview(URL.createObjectURL(archivo));
  };

  const handleGuardar = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !perfil) return;

    setGuardando(true);
    setErrorGuardar(null);
    setGuardado(false);

    const cambios: { bio: string | null; banner_url?: string } = {
      bio: bio.trim() || null,
    };

    try {
      if (bannerFile) {
        const recorte = await recortarImagenConProporcion(bannerFile, 4);
        const extension = bannerFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("player-banners")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorGuardar("No se pudo subir el banner: " + uploadError.message);
          setGuardando(false);
          return;
        }

        cambios.banner_url = supabase.storage.from("player-banners").getPublicUrl(ruta).data.publicUrl;
      }
    } catch {
      setErrorGuardar("No se pudo procesar el banner, prueba con otra imagen.");
      setGuardando(false);
      return;
    }

    const { error: updateError } = await supabase.from("profiles").update(cambios).eq("id", user.id);

    setGuardando(false);

    if (updateError) {
      setErrorGuardar(updateError.message);
      return;
    }

    setBannerFile(null);
    setBannerPreview(null);
    setGuardado(true);
    await cargarPerfilPublico();
  };

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

  const esPropio = user?.id === perfil.id;
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
        </div>
      </div>

      <div className="player-detail-header">
        <div>
          <h1 className="section-title">
            {perfil.nick}
            <span className="profile-nick-id">#{perfil.uniqueId}</span>
          </h1>
          {tituloTexto && <span className="liga-badge">{tituloTexto}</span>}
        </div>
      </div>

      {perfil.bio && <p className="team-detail-description">{perfil.bio}</p>}

      <h2 className="detail-subtitle">Estadísticas</h2>
      <MmrProgressBar mmr={perfil.mmr} liga={perfil.liga} bancaRota={perfil.bancaRota} />
      <span className="nivel-badge nivel-badge-grande">Nv. {perfil.nivel}</span>
      {perfil.razaPrincipal && (
        <span className="liga-badge">
          Raza: {perfil.razaPrincipal}
          {perfil.razaSecundaria && ` / ${perfil.razaSecundaria}`}
        </span>
      )}
      <PercentBar label="Valentía" value={perfil.valentiaJugador} />
      <PercentBar label="Responsabilidad en Clan Wars" value={perfil.responsabilidadCw} />
      <PercentBar label="Responsabilidad en torneos" value={perfil.responsabilidadTorneos} />

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

      {esPropio && (
        <>
          <h2 className="detail-subtitle">Editar mi perfil público</h2>
          <form className="auth-form" onSubmit={handleGuardar}>
            {errorGuardar && <div className="form-error">{errorGuardar}</div>}
            {guardado && <div className="form-success">Tu perfil público se guardó correctamente.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="player-edit-bio">
                Descripción
              </label>
              <textarea
                id="player-edit-bio"
                className="form-textarea"
                maxLength={280}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="player-edit-banner">
                Banner (opcional, máx. 3MB, se recorta a 4:1)
              </label>
              <input
                id="player-edit-banner"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerChange}
              />
              {(bannerPreview ?? perfil.bannerUrl) && (
                <img
                  src={bannerPreview ?? perfil.bannerUrl ?? ""}
                  alt="Vista previa del banner"
                  className="team-banner-preview"
                />
              )}
            </div>

            <p className="form-hint">
              El resto de tus datos (nick, país, servidor, ID de SC2, liga, foto y forma de avatar) se
              editan desde el menú de tu avatar → Editar mis datos.
            </p>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
