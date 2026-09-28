import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRight, Download, Monitor, Smartphone } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import { formatearCuentaRegresiva, formatoHora, LogoEquipo, useAhora, yaComenzo } from "./ProximasClanWars";
import type { NoticiaPreview } from "./NewsSection";
import type { ClanWarProxima } from "../types/clanWars";

interface Props {
  noticiasDestacadas: NoticiaPreview[];
  onVerProximosEventos: () => void;
}

// Mismo link estable de GitHub Releases que antes usaba
// InstalarRemorApp.tsx (retirado -- ver el comentario más abajo).
const URL_INSTALADOR_WINDOWS = "https://github.com/RemoraDev/remorapp/releases/latest/download/RemorApp-Setup.exe";

// Evento destacado: el que empieza antes entre los "en vivo" (esos
// primero, sin importar hora) y el resto ordenado por fecha_hora_cet.
// Mismo criterio de agrupado que ProximasClanWars.tsx, pero acá solo
// interesa UNO -- el más inminente -- no la lista completa.
function elegirDestacado(clanWars: ClanWarProxima[], ahora: Date): ClanWarProxima | null {
  if (clanWars.length === 0) return null;
  const ordenados = [...clanWars].sort((a, b) => {
    const aEnVivo = yaComenzo(a, ahora);
    const bEnVivo = yaComenzo(b, ahora);
    if (aEnVivo !== bEnVivo) return aEnVivo ? -1 : 1;
    return new Date(a.fecha_hora_cet).getTime() - new Date(b.fecha_hora_cet).getTime();
  });
  return ordenados[0];
}

function EventoDestacado({ cw, ahora }: { cw: ClanWarProxima; ahora: Date }) {
  const categoria = cw.division_nombre ? `${cw.liga_nombre} · ${cw.division_nombre}` : cw.liga_nombre;
  const enVivo = yaComenzo(cw, ahora);

  const contenido = (
    <div className={`home-evento-destacado ${cw.lineup_revelado ? "es-clickeable" : ""}`}>
      <div className="home-evento-destacado-glow" aria-hidden="true" />
      <span className="home-evento-destacado-etiqueta">
        {enVivo ? "En vivo ahora" : "Próximo evento"}
      </span>
      <div className="home-evento-destacado-cuerpo">
        <div className="home-evento-destacado-equipo">
          <LogoEquipo nombre={cw.challenger_nombre} tag={cw.challenger_tag} logoUrl={cw.challenger_logo_url} />
          <span className="home-evento-destacado-tag">{cw.challenger_tag}</span>
        </div>
        <div className="home-evento-destacado-centro">
          <span className="home-evento-destacado-vs">VS</span>
          <span className="home-evento-destacado-categoria">{categoria ?? "Clan War amistosa"}</span>
        </div>
        <div className="home-evento-destacado-equipo">
          <LogoEquipo nombre={cw.challenged_nombre} tag={cw.challenged_tag} logoUrl={cw.challenged_logo_url} />
          <span className="home-evento-destacado-tag">{cw.challenged_tag}</span>
        </div>
      </div>
      <div className="home-evento-destacado-footer">
        <span>{formatoHora.format(new Date(cw.fecha_hora_cet))}</span>
        {enVivo ? (
          <span className="clan-war-card-en-vivo">EN VIVO</span>
        ) : (
          <span className="clan-war-card-cuenta-regresiva">
            {formatearCuentaRegresiva(new Date(cw.fecha_hora_cet), ahora)}
          </span>
        )}
      </div>
    </div>
  );

  return cw.lineup_revelado ? (
    <Link to={`/clan-war/${cw.id}`} className="home-evento-destacado-link">
      {contenido}
    </Link>
  ) : (
    contenido
  );
}

// Portada de Inicio (primera página del carrusel): título de marca,
// el evento más inminente destacado (Clan War próxima o en vivo),
// hasta 3 noticias destacadas si hay, un llamado a la acción que lleva
// a "Clan Wars próximas" del mismo carrusel, y la sección para llevarse
// RemorApp a cualquier dispositivo -- antes esto último vivía partido
// en dos lugares (esta tarjeta de PC acá, y una página aparte del
// carrusel con las dos tarjetas, InstalarRemorApp.tsx) -- ahora es una
// sola sección acá, con las dos opciones (celular/PC) modernizadas.
export default function HomePortada({ noticiasDestacadas, onVerProximosEventos }: Props) {
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [clanWars, setClanWars] = useState<ClanWarProxima[] | null>(null);
  const ahora = useAhora(60000);

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  useEffect(() => {
    supabase.rpc("clan_wars_proximas").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando el evento destacado:", error);
        setClanWars([]);
        return;
      }
      setClanWars((data ?? []) as ClanWarProxima[]);
    });
  }, []);

  const destacado = clanWars ? elegirDestacado(clanWars, ahora) : null;

  return (
    <div className="home-portada">
      <div className="home-portada-glow" aria-hidden="true" />
      <div className="home-portada-scanlines" aria-hidden="true" />
      <h1 className="home-portada-titulo">
        Bienvenidos a RemorApp<span className="home-portada-titulo-accent"> Gaming</span>
      </h1>
      <div className="home-portada-franja" />

      {destacado && <EventoDestacado cw={destacado} ahora={ahora} />}

      <button type="button" className="btn btn-primary btn-primary-lg home-portada-cta" onClick={onVerProximosEventos}>
        Ver próximos eventos
        <ArrowRight size={18} className="icon-inline" aria-hidden="true" />
      </button>

      {/* Corrección: vivía partido en dos lugares -- esta tarjeta (solo
          PC) más una página aparte del carrusel con estilo viejo
          (InstalarRemorApp.tsx, retirada). Ahora es una sola sección,
          con las dos opciones (celular/PC) del mismo estilo moderno.
          La de PC se sigue ocultando dentro de la propia app de
          escritorio -- no tiene sentido ofrecer bajarla desde adentro.

          Corrección: esta sección iba DESPUÉS de "Noticias destacadas"
          (una lista de largo variable, hasta 3 ítems) -- cuando había
          noticias, el bloque entero quedaba empujado fuera del área
          visible de la página del carrusel, recortado por el scroll
          propio de .carrusel-pagina. El link de descarga entonces
          "no hacía nada" al clickear: ni siquiera llegaba a tocarlo, el
          click caía en el contenedor de atrás. Ahora va ANTES que las
          noticias, así su posición no depende de cuántas haya. */}
      <div className="home-instalar-moderno">
        <a href="/instalar-celular" target="_blank" rel="noopener noreferrer" className="home-instalar-moderno-card">
          <span className="home-instalar-moderno-icono" aria-hidden="true">
            <Smartphone size={26} />
          </span>
          <span className="home-instalar-moderno-texto">
            <span className="home-instalar-moderno-titulo">Instalar en celular</span>
            <span className="home-instalar-moderno-desc">Guía para Chrome y Brave en Android</span>
          </span>
        </a>

        {!esEscritorio && (
          <a href={URL_INSTALADOR_WINDOWS} className="home-instalar-moderno-card home-instalar-moderno-card-destacada">
            <span className="home-instalar-moderno-icono" aria-hidden="true">
              <Monitor size={26} />
            </span>
            <span className="home-instalar-moderno-texto">
              <span className="home-instalar-moderno-titulo">
                Llevate RemorApp a tu escritorio
                <Download size={15} className="icon-inline" aria-hidden="true" />
              </span>
              <span className="home-instalar-moderno-desc">Sin barra del navegador, avisa solo de versiones nuevas</span>
            </span>
          </a>
        )}
      </div>

      {noticiasDestacadas.length > 0 && (
        <div className="home-portada-noticias">
          <p className="home-portada-noticias-titulo">Noticias destacadas</p>
          <ul className="home-portada-noticias-lista">
            {noticiasDestacadas.map((n) => (
              <li key={n.id}>
                <Link to="/news" className="home-portada-noticia-item">
                  <span className="home-portada-noticia-fecha">{formatFecha(n.createdAt)}</span>
                  <span className="home-portada-noticia-titulo-texto">{n.titulo}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/news" className="btn-link home-portada-ver-todas">
            Ver todas las noticias
          </Link>
        </div>
      )}
    </div>
  );
}
