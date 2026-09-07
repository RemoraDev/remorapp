import { useId } from "react";
import type { ReactNode } from "react";
import type { SkinAvatarClave } from "../types/skins";
import type { AvatarForma } from "../types/profile";

interface AvatarSkinProps {
  // null/undefined = sin skin, se muestra el avatar normal sin nada
  // envolviéndolo (mismo elemento que si AvatarSkin no existiera).
  clave: SkinAvatarClave | null | undefined;
  // Borde básico (migración 055), independiente de las skins de
  // efectos -- si clave está seteada, gana la skin de efectos y estos
  // dos props se ignoran del todo (ver el early-return de abajo).
  bordeColor?: string | null;
  bordeGrosor?: number | null;
  forma?: AvatarForma;
  children: ReactNode;
}

interface ConfigElectrico {
  baseFrequency: number;
  dur: string;
  scale: number;
  modoBlend: "color-dodge" | "screen";
  colorBorde: string;
  colorNucleo: string;
  opacidadBase?: number;
  conMatrizHielo?: boolean;
  // Migración 068: marcos de prestigio (Diamante/Master/Gran Master) --
  // una estrella en la esquina inferior, del mismo color que el borde,
  // es lo que los distingue de una skin de efectos común.
  estrella?: boolean;
}

// Catálogo "Electric" (migración 054): las 8 skins comparten
// EXACTAMENTE la misma técnica -- adaptación del efecto "Electric
// Border" (MIT) que dio el usuario como referencia: feTurbulence +
// feOffset animado con <animate> nativo de SVG sobre dx/dy +
// feComposite + feBlend + feDisplacementMap, corriendo en la GPU sin
// JavaScript (ver FiltroElectrico más abajo). Solo cambian estos
// parámetros por skin:
// - baseFrequency: qué tan fina es la turbulencia (más alto = más
//   caótica/nerviosa).
// - dur: qué tan rápido corre la animación nativa de SVG.
// - scale: cuánto desplaza el borde feDisplacementMap -- también fija,
//   en la misma proporción, el rango de dx/dy de cada feOffset (ver
//   dyAmt/dxAmt en FiltroElectrico).
// - modoBlend: el feBlend que cruza las dos turbulencias -- color-dodge
//   por default, screen para Solar (resplandor solar real).
// - colorBorde/colorNucleo: la paleta (borde + halo interior mínimo).
// - opacidadBase: para Niebla, que necesita verse tenue.
// - conMatrizHielo: para Frost, un feColorMatrix extra que aclara y
//   satura el azul para una sensación cristalina.
const CONFIG_ELECTRICO: Record<SkinAvatarClave, ConfigElectrico> = {
  electric: {
    baseFrequency: 0.09,
    dur: "6s",
    scale: 7,
    modoBlend: "color-dodge",
    colorBorde: "#ff9a3d",
    colorNucleo: "rgba(79, 195, 255, 0.9)",
  },
  violet_electric: {
    baseFrequency: 0.09,
    dur: "6s",
    scale: 7,
    modoBlend: "color-dodge",
    colorBorde: "#a855f7",
    colorNucleo: "rgba(255, 255, 255, 0.9)",
  },
  cyan_electric: {
    // Núcleo blanco (no cian) a propósito: el acento por defecto del
    // sitio ya es cian (#22d3ee) -- un anillo cian con núcleo cian se
    // leería como "el borde de siempre", no como una skin.
    baseFrequency: 0.09,
    dur: "6s",
    scale: 7,
    modoBlend: "color-dodge",
    colorBorde: "#00e5ff",
    colorNucleo: "rgba(255, 255, 255, 0.95)",
  },
  fire: {
    baseFrequency: 0.16,
    dur: "3s",
    scale: 9,
    modoBlend: "color-dodge",
    colorBorde: "#ff5722",
    colorNucleo: "rgba(255, 214, 0, 0.9)",
  },
  blue_fire: {
    baseFrequency: 0.16,
    dur: "3s",
    scale: 9,
    modoBlend: "color-dodge",
    colorBorde: "#2979ff",
    colorNucleo: "rgba(255, 255, 255, 0.9)",
  },
  niebla: {
    baseFrequency: 0.025,
    dur: "16s",
    scale: 3,
    modoBlend: "color-dodge",
    colorBorde: "rgba(230, 235, 240, 0.45)",
    colorNucleo: "rgba(200, 205, 215, 0.35)",
    opacidadBase: 0.65,
  },
  frost: {
    baseFrequency: 0.05,
    dur: "9s",
    scale: 5,
    modoBlend: "color-dodge",
    colorBorde: "#bee7ff",
    colorNucleo: "rgba(255, 255, 255, 0.85)",
    conMatrizHielo: true,
  },
  solar: {
    baseFrequency: 0.1,
    dur: "5s",
    scale: 6,
    modoBlend: "screen",
    colorBorde: "#ffd700",
    colorNucleo: "rgba(255, 240, 180, 0.95)",
  },
  // Migración 068: marcos de prestigio -- misma técnica "Electric",
  // colores que evocan la liga real de StarCraft II de cada rango, con
  // la estrella en la esquina como marca distintiva.
  diamante: {
    baseFrequency: 0.07,
    dur: "7s",
    scale: 6,
    modoBlend: "color-dodge",
    colorBorde: "#38bdf8",
    colorNucleo: "rgba(224, 242, 254, 0.95)",
    estrella: true,
  },
  master: {
    baseFrequency: 0.08,
    dur: "6s",
    scale: 7,
    modoBlend: "color-dodge",
    colorBorde: "#c026d3",
    colorNucleo: "rgba(250, 232, 255, 0.95)",
    estrella: true,
  },
  gran_master: {
    baseFrequency: 0.14,
    dur: "4s",
    scale: 8,
    modoBlend: "screen",
    colorBorde: "#f97316",
    colorNucleo: "rgba(254, 226, 226, 0.95)",
    estrella: true,
  },
};

function FiltroElectrico({ id, config }: { id: string; config: ConfigElectrico }) {
  const { baseFrequency, dur, scale, modoBlend, conMatrizHielo } = config;
  // Mismo cociente que la versión aprobada de Electric (scale 7 con
  // rangos 140/98): a mayor desplazamiento, mayor rango de offset.
  const dyAmt = scale * 20;
  const dxAmt = scale * 14;

  return (
    <svg className="avatar-skin-electric-defs" aria-hidden="true">
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="turbulence" baseFrequency={baseFrequency} numOctaves={10} result="ruido1" seed="1" />
          <feOffset in="ruido1" dx="0" dy="0" result="ruido1Despl">
            <animate attributeName="dy" values={`${dyAmt}; 0`} dur={dur} repeatCount="indefinite" calcMode="linear" />
          </feOffset>
          <feTurbulence type="turbulence" baseFrequency={baseFrequency} numOctaves={10} result="ruido2" seed="1" />
          <feOffset in="ruido2" dx="0" dy="0" result="ruido2Despl">
            <animate attributeName="dy" values={`0; -${dyAmt}`} dur={dur} repeatCount="indefinite" calcMode="linear" />
          </feOffset>
          <feTurbulence type="turbulence" baseFrequency={baseFrequency} numOctaves={10} result="ruido3" seed="2" />
          <feOffset in="ruido3" dx="0" dy="0" result="ruido3Despl">
            <animate attributeName="dx" values={`${dxAmt}; 0`} dur={dur} repeatCount="indefinite" calcMode="linear" />
          </feOffset>
          <feTurbulence type="turbulence" baseFrequency={baseFrequency} numOctaves={10} result="ruido4" seed="2" />
          <feOffset in="ruido4" dx="0" dy="0" result="ruido4Despl">
            <animate attributeName="dx" values={`0; -${dxAmt}`} dur={dur} repeatCount="indefinite" calcMode="linear" />
          </feOffset>
          <feComposite in="ruido1Despl" in2="ruido2Despl" result="parte1" />
          <feComposite in="ruido3Despl" in2="ruido4Despl" result="parte2" />
          <feBlend in="parte1" in2="parte2" mode={modoBlend} result="ruidoCombinado" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="ruidoCombinado"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="B"
            result="desplazado"
          />
          {conMatrizHielo && (
            <feColorMatrix
              in="desplazado"
              type="matrix"
              values="1.05 0 0 0 0.02  0 1.05 0 0 0.04  0 0 1.2 0 0.08  0 0 0 1 0"
            />
          )}
        </filter>
      </defs>
    </svg>
  );
}

export default function AvatarSkin({
  clave,
  bordeColor,
  bordeGrosor,
  forma = "redondo",
  children,
}: AvatarSkinProps) {
  const idBase = useId().replace(/:/g, "");
  const claseForma = forma === "cuadrado" ? "avatar-shape-cuadrado" : "avatar-shape-redondo";
  const config = clave ? CONFIG_ELECTRICO[clave] : undefined;

  // Sin skin de efectos ni borde básico: el avatar se muestra tal
  // cual, sin ningún envoltorio.
  if ((!clave || !config) && !bordeColor) {
    return <>{children}</>;
  }

  // Regla dura (pedida explícitamente): si hay una skin de efectos
  // activa, esa tiene prioridad visual -- el borde básico ni se
  // renderiza, nunca se mezclan los dos a la vez.
  if (!clave || !config) {
    return (
      <span className="avatar-skin" data-borde-basico="">
        <span className="avatar-skin-inner">{children}</span>
        <span
          className={`avatar-skin-borde-basico ${claseForma}`}
          style={{ borderColor: bordeColor ?? undefined, borderWidth: `${bordeGrosor ?? 3}px` }}
          aria-hidden="true"
        />
      </span>
    );
  }

  return (
    <span className="avatar-skin" data-skin={clave}>
      <span className="avatar-skin-inner">{children}</span>
      {/* overflow:hidden, del mismo tamaño y forma exactos que la
          foto: el filtro necesita margen de sobra (x/y -30% arriba)
          para no recortar la distorsión a mitad de camino, pero ese
          margen no puede pintarse más allá del propio avatar -- este
          contenedor es lo que garantiza que el efecto quede contenido
          exactamente en el grosor del anillo, sin tocar la foto del
          centro ni escaparse hacia afuera. */}
      <span className={`avatar-skin-electric-clip ${claseForma}`} aria-hidden="true">
        <FiltroElectrico id={`${idBase}-electrico`} config={config} />
        <span
          className="avatar-skin-electric-border"
          style={{
            filter: `url(#${idBase}-electrico)`,
            borderColor: config.colorBorde,
            boxShadow: `0 0 2px ${config.colorNucleo}`,
            opacity: config.opacidadBase ?? 1,
          }}
        />
      </span>
      {/* Migración 068: la estrella de los marcos de prestigio queda
          FUERA del clip de arriba a propósito -- ese contenedor recorta
          todo lo que sobresalga del avatar, y la estrella tiene que
          asomar por fuera del borde, no quedar contenida en el anillo. */}
      {config.estrella && (
        <span className="avatar-skin-estrella" style={{ color: config.colorBorde }} aria-hidden="true">
          ★
        </span>
      )}
    </span>
  );
}
