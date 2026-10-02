import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRight, Smartphone } from "lucide-react";
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

// Cuántas partículas de fondo -- a mano, no por Math.random() en cada
// render (se recalcularía solo, el fondo "saltaría" en cada
// re-render). Cada una entra con un retraso/duración/posición propios,
// para que no se vean todas sincronizadas en fila.
const PARTICULAS = Array.from({ length: 18 }, (_, i) => ({
  izquierda: (i * 37 + 5) % 100,
  retraso: (i % 9) * 1.1,
  duracion: 9 + (i % 5) * 1.8,
  tamano: 3 + (i % 3),
  zigzag: i % 2 === 0 ? 1 : -1,
}));

// Cuántos eventos próximos entran en la fila -- mismo criterio que
// "Noticias destacadas" (hasta 3), ver elegirProximos() más abajo.
const EVENTOS_DESTACADOS = 3;

// Evento(s) destacado(s): los "en vivo" primero (sin importar hora),
// el resto ordenado por fecha_hora_cet -- mismo criterio de agrupado
// que ProximasClanWars.tsx, acá recortado a los primeros `cantidad`.
function elegirProximos(clanWars: ClanWarProxima[], ahora: Date, cantidad: number): ClanWarProxima[] {
  return [...clanWars]
    .sort((a, b) => {
      const aEnVivo = yaComenzo(a, ahora);
      const bEnVivo = yaComenzo(b, ahora);
      if (aEnVivo !== bEnVivo) return aEnVivo ? -1 : 1;
      return new Date(a.fecha_hora_cet).getTime() - new Date(b.fecha_hora_cet).getTime();
    })
    .slice(0, cantidad);
}

function EventoMini({ cw, ahora }: { cw: ClanWarProxima; ahora: Date }) {
  const enVivo = yaComenzo(cw, ahora);

  const contenido = (
    <div className={`home-evento-mini ${cw.lineup_revelado ? "es-clickeable" : ""}`}>
      <span className={`home-evento-mini-etiqueta ${enVivo ? "home-evento-mini-etiqueta-vivo" : ""}`}>
        {enVivo ? "En vivo" : formatoHora.format(new Date(cw.fecha_hora_cet))}
      </span>
      <div className="home-evento-mini-cuerpo">
        <span className="home-evento-mini-equipo">
          <LogoEquipo nombre={cw.challenger_nombre} tag={cw.challenger_tag} logoUrl={cw.challenger_logo_url} />
          <span className="home-evento-mini-tag">{cw.challenger_tag}</span>
        </span>
        <span className="home-evento-mini-vs">VS</span>
        <span className="home-evento-mini-equipo">
          <LogoEquipo nombre={cw.challenged_nombre} tag={cw.challenged_tag} logoUrl={cw.challenged_logo_url} />
          <span className="home-evento-mini-tag">{cw.challenged_tag}</span>
        </span>
      </div>
      <span className="home-evento-mini-footer">
        {enVivo ? (
          <span className="clan-war-card-en-vivo">EN VIVO</span>
        ) : (
          formatearCuentaRegresiva(new Date(cw.fecha_hora_cet), ahora)
        )}
      </span>
    </div>
  );

  return cw.lineup_revelado ? (
    <Link to={`/clan-war/${cw.id}`} className="home-evento-mini-link">
      {contenido}
    </Link>
  ) : (
    contenido
  );
}

// SVG propio (no un ícono de lucide) para la tarjeta de descarga de
// escritorio -- a pedido del usuario, algo que "combine con la web":
// mismo trazo fino/geométrico que el resto del set de íconos, con el
// signo de bajada adentro de la pantalla en el color de acento.
function IconoDescargaEscritorio() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="32" height="21" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 31h12M20 26v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M20 10v9m0 0 3.5-3.5M20 19l-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Portada de Inicio (primera página del carrusel): título de marca,
// hasta 3 noticias destacadas si hay (fila horizontal), y una segunda
// fila con la descarga de escritorio a la izquierda y hasta 3 eventos
// próximos a la derecha (también horizontal) -- rediseño a pedido del
// usuario, "ultra gaming moderno minimalista", con un fondo de
// partículas subiendo en zigzag (puro CSS, ver .home-particula).
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
        console.error("Error cargando los eventos próximos:", error);
        setClanWars([]);
        return;
      }
      setClanWars((data ?? []) as ClanWarProxima[]);
    });
  }, []);

  const proximos = useMemo(
    () => (clanWars ? elegirProximos(clanWars, ahora, EVENTOS_DESTACADOS) : []),
    [clanWars, ahora]
  );

  return (
    <div className="home-portada">
      <div className="home-particulas" aria-hidden="true">
        {PARTICULAS.map((p, i) => {
          // CSSProperties no tipa variables CSS propias (--zigzag) --
          // se castea, igual que cualquier otro estilo inline calculado.
          const estilo = {
            left: `${p.izquierda}%`,
            width: `${p.tamano}px`,
            height: `${p.tamano}px`,
            animationDelay: `${p.retraso}s`,
            animationDuration: `${p.duracion}s`,
            "--zigzag": p.zigzag,
          } as CSSProperties;

          return <span key={i} className="home-particula" style={estilo} />;
        })}
      </div>
      <div className="home-portada-glow" aria-hidden="true" />
      <div className="home-portada-scanlines" aria-hidden="true" />
      <h1 className="home-portada-titulo">
        Bienvenidos a RemorApp<span className="home-portada-titulo-accent"> Gaming</span>
      </h1>
      <div className="home-portada-franja" />

      {noticiasDestacadas.length > 0 && (
        <section className="home-seccion-ancha">
          <p className="home-seccion-label">Noticias destacadas</p>
          <div className="home-noticias-grid">
            {noticiasDestacadas.map((n) => (
              <Link key={n.id} to="/news" className="home-noticia-card">
                <span className="home-noticia-card-fecha">{formatFecha(n.createdAt)}</span>
                <span className="home-noticia-card-titulo">{n.titulo}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="home-fila-principal">
        <div className="home-descarga-col">
          {/* Se oculta dentro de la propia app de escritorio -- no tiene
              sentido ofrecer bajarla desde adentro (mismo criterio que
              tenía esta sección antes del rediseño). */}
          {!esEscritorio && (
            <a href={URL_INSTALADOR_WINDOWS} className="home-descarga-card">
              <span className="home-descarga-icono">
                <IconoDescargaEscritorio />
              </span>
              <span className="home-descarga-texto">
                <span className="home-descarga-titulo">Llevate RemorApp a tu escritorio</span>
                <span className="home-descarga-desc">Sin barra del navegador, avisa solo de versiones nuevas</span>
              </span>
            </a>
          )}

          <a href="/instalar-celular" target="_blank" rel="noopener noreferrer" className="home-descarga-mobile-link">
            <Smartphone size={15} className="icon-inline" aria-hidden="true" />
            Instalar en celular (Chrome / Brave)
          </a>
        </div>

        <div className="home-eventos-col">
          <div className="home-seccion-label-row">
            <p className="home-seccion-label">Próximos eventos</p>
            <button type="button" className="home-ver-todos-btn" onClick={onVerProximosEventos}>
              Ver todos
              <ArrowRight size={14} className="icon-inline" aria-hidden="true" />
            </button>
          </div>

          {proximos.length > 0 ? (
            <div className="home-eventos-grid">
              {proximos.map((cw) => (
                <EventoMini key={cw.id} cw={cw} ahora={ahora} />
              ))}
            </div>
          ) : (
            <p className="detail-empty">Todavía no hay ningún evento programado.</p>
          )}
        </div>
      </section>
    </div>
  );
}
