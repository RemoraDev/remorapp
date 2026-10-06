import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRight, Smartphone } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import { formatearCuentaRegresiva, formatoHora, LogoEquipo, useAhora, yaComenzo } from "./ProximasClanWars";
import FondoParticulas from "./FondoParticulas";
import { useAuth } from "../context/AuthContext";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import type { NoticiaPreview } from "./NewsSection";
import type { ClanWarProxima } from "../types/clanWars";
import type { MiniEvento } from "../types/ranking";

interface Props {
  noticiasDestacadas: NoticiaPreview[];
  onVerProximosEventos: () => void;
}

// Mismo link estable de GitHub Releases que antes usaba
// InstalarRemorApp.tsx (retirado -- ver el comentario más abajo).
const URL_INSTALADOR_WINDOWS = "https://github.com/RemoraDev/remorapp/releases/latest/download/RemorApp-Setup.exe";

// Cuántos eventos próximos entran en la fila -- hasta 5 (a pedido del
// usuario, antes 3), ver elegirProximos() más abajo.
const EVENTOS_DESTACADOS = 5;

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
// escritorio -- a pedido del usuario, que se note que tiene tanto
// cuidado como el resto de la portada: pantalla con degradado del
// acento, flecha de bajada con glow, y el mismo marco "corner bracket"
// que ya se usa en la foto de presentación/tarjeta del clan del
// perfil, para que se sienta parte del mismo lenguaje visual.
function IconoDescargaEscritorio() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="descarga-pantalla-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.4 }} />
          <stop offset="100%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.05 }} />
        </linearGradient>
      </defs>

      {/* Esquinas decorativas, mismo lenguaje que .foto-presentacion-corner */}
      <path d="M2 10V3h7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M47 3h7v7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 46v7h7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M47 53h7v-7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />

      <rect
        x="9"
        y="12"
        width="38"
        height="25"
        rx="2.5"
        fill="url(#descarga-pantalla-grad)"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M21 44h14M28 37v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M28 18v12m0 0 5-5m-5 5-5-5"
        stroke="var(--color-accent)"
        strokeWidth="2.2"
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
  const { user } = useAuth();
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [clanWars, setClanWars] = useState<ClanWarProxima[] | null>(null);
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);
  const [minieventos, setMinieventos] = useState<MiniEvento[]>([]);
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

  useEffect(() => {
    if (user) obtenerEquipoDelUsuario(user.id).then(setMiEquipo);
  }, [user]);

  const proximos = useMemo(
    () => (clanWars ? elegirProximos(clanWars, ahora, EVENTOS_DESTACADOS) : []),
    [clanWars, ahora]
  );

  // Migración 164: si no hay ningún Clan War próximo, la portada sigue
  // mostrando los mini eventos (Race War/Clan War Amistosa) del propio
  // clan de quien mira, en vez de cortar directo al mensaje de "no hay
  // nada programado" -- a pedido del usuario.
  useEffect(() => {
    if (proximos.length > 0 || !miEquipo) return;
    supabase.rpc("mis_minieventos_clan").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando mini eventos de respaldo:", error);
        return;
      }
      setMinieventos((data ?? []) as MiniEvento[]);
    });
  }, [proximos, miEquipo]);

  return (
    <div className="home-portada">
      <FondoParticulas />
      <div className="home-portada-glow" aria-hidden="true" />
      <div className="home-portada-scanlines" aria-hidden="true" />
      <div className="home-portada-titulo-wrap">
        <h1 className="home-portada-titulo">
          Bienvenidos a RemorApp<span className="home-portada-titulo-accent"> Gaming</span>
        </h1>
        <div className="home-portada-franja" />
      </div>

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
        {/* Instalar en PC/celular: solo tiene sentido en la web -- si
            ya está adentro de la app de escritorio, ya la tiene
            instalada (a pedido del usuario). Toda la columna
            desaparece, no solo la tarjeta de PC -- .home-eventos-col
            ocupa el ancho completo en ese caso. */}
        {!esEscritorio && (
          <div className="home-descarga-col">
            <a href={URL_INSTALADOR_WINDOWS} className="home-descarga-card">
              <div className="home-descarga-card-glow" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-left" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-top foto-presentacion-corner-right" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-left" aria-hidden="true" />
              <div className="foto-presentacion-corner foto-presentacion-corner-bottom foto-presentacion-corner-right" aria-hidden="true" />
              <span className="home-descarga-icono">
                <IconoDescargaEscritorio />
              </span>
              <span className="home-descarga-texto">
                <span className="home-descarga-titulo">Llevate RemorApp a tu escritorio</span>
                <span className="home-descarga-desc">Sin barra del navegador, avisa solo de versiones nuevas</span>
              </span>
            </a>

            <a href="/instalar-celular" target="_blank" rel="noopener noreferrer" className="home-descarga-mobile-link">
              <Smartphone size={15} className="icon-inline" aria-hidden="true" />
              Instalar en celular (Chrome / Brave)
            </a>
          </div>
        )}

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
          ) : minieventos.length > 0 ? (
            <div className="detail-participant-list">
              {minieventos.map((ev) => (
                <Link
                  key={ev.id}
                  to={ev.tipo === "race_war" ? `/guerra-razas/${ev.id}` : `/clan-war/${ev.id}`}
                  className="detail-participant-item"
                >
                  {ev.titulo}
                  <span className="tournament-card-meta">{formatFecha(ev.fecha)}</span>
                </Link>
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
