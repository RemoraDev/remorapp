import { useId } from "react";
import type { ReactNode } from "react";
import type { SkinAvatarClave } from "../types/skins";
import type { AvatarForma } from "../types/profile";

interface AvatarSkinProps {
  // null/undefined = sin skin, se muestra el avatar normal sin nada
  // envolviéndolo (mismo elemento que si AvatarSkin no existiera).
  clave: SkinAvatarClave | null | undefined;
  forma?: AvatarForma;
  children: ReactNode;
}

// Los 3 skins con textura orgánica (fuego, orca, zerg) comparten la
// misma técnica -- turbulencia SVG usada como máscara de opacidad
// sobre un color de relleno -- con distinta paleta y frecuencia. El
// resto de las skins usa formas dibujadas a mano (pocos trazos, sin
// filtro) o gradientes/clip-path puros en CSS -- ver el bloque
// [data-skin] en halcon.css para el resto del efecto de cada una.
function TexturaTurbulencia({
  id,
  baseFrequency,
  seed,
  colorA,
  colorB,
}: {
  id: string;
  baseFrequency: number;
  seed: number;
  colorA: string;
  colorB: string;
}) {
  return (
    <svg className="avatar-skin-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency={baseFrequency} numOctaves={2} seed={seed} result="ruido" />
          <feColorMatrix in="ruido" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.55 0.55 0.55 0 0" result="mascara" />
          <feComposite in="SourceGraphic" in2="mascara" operator="in" />
        </filter>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colorA} />
          <stop offset="100%" stopColor={colorB} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill={`url(#${id}-grad)`} filter={`url(#${id})`} />
    </svg>
  );
}

export default function AvatarSkin({ clave, forma = "redondo", children }: AvatarSkinProps) {
  const idBase = useId().replace(/:/g, "");
  const claseForma = forma === "cuadrado" ? "avatar-shape-cuadrado" : "avatar-shape-redondo";

  if (!clave) {
    return <>{children}</>;
  }

  return (
    <span className="avatar-skin" data-skin={clave}>
      <span className="avatar-skin-glow" aria-hidden="true" />
      <span className="avatar-skin-inner">{children}</span>
      <span className={`avatar-skin-overlay ${claseForma}`} aria-hidden="true">
        {clave === "fuego_electricidad" && (
          <>
            <TexturaTurbulencia id={`${idBase}-fuego`} baseFrequency={0.12} seed={4} colorA="#ff8a00" colorB="#ff3d00" />
            <span className="avatar-skin-spark avatar-skin-spark-1" />
            <span className="avatar-skin-spark avatar-skin-spark-2" />
            <span className="avatar-skin-spark avatar-skin-spark-3" />
          </>
        )}

        {clave === "demoniaca" && (
          <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
            <path
              className="avatar-skin-grieta"
              d="M50 4 L44 30 L58 38 L40 55 L52 62 L36 90"
              fill="none"
              stroke="#ff3355"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path
              className="avatar-skin-grieta"
              d="M14 46 L34 50 L26 66 L46 72"
              fill="none"
              stroke="#ff3355"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        )}

        {clave === "elfica" && (
          <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
            <path
              d="M8 70 C 24 60, 20 40, 36 30 C 46 24, 44 12, 52 4"
              fill="none"
              stroke="#d9c46a"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M92 30 C 78 38, 80 54, 66 62 C 58 67, 58 78, 50 88"
              fill="none"
              stroke="#8fd68f"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <circle cx="36" cy="30" r="2" fill="#d9c46a" />
            <circle cx="66" cy="62" r="2" fill="#8fd68f" />
          </svg>
        )}

        {clave === "orca" && (
          <TexturaTurbulencia id={`${idBase}-orca`} baseFrequency={0.35} seed={11} colorA="#2f4b32" colorB="#4a3524" />
        )}

        {clave === "sagrada" && <span className="avatar-skin-rayos" />}

        {clave === "cristal_negro" && (
          <>
            <span className="avatar-skin-faceta avatar-skin-faceta-1" />
            <span className="avatar-skin-faceta avatar-skin-faceta-2" />
            <span className="avatar-skin-faceta avatar-skin-faceta-3" />
            <span className="avatar-skin-reflejo" />
          </>
        )}

        {clave === "gatitos" && (
          <>
            <span className="avatar-skin-oreja avatar-skin-oreja-izq" />
            <span className="avatar-skin-oreja avatar-skin-oreja-der" />
            <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
              <g fill="#ffffff" opacity="0.55">
                <circle cx="20" cy="78" r="3.2" />
                <circle cx="27" cy="72" r="2" />
                <circle cx="15" cy="71" r="2" />
                <circle cx="82" cy="24" r="3.2" />
                <circle cx="89" cy="18" r="2" />
                <circle cx="77" cy="17" r="2" />
              </g>
            </svg>
            <span className="avatar-skin-brillo avatar-skin-brillo-1" />
            <span className="avatar-skin-brillo avatar-skin-brillo-2" />
          </>
        )}

        {clave === "zerg" && (
          <>
            <TexturaTurbulencia id={`${idBase}-zerg`} baseFrequency={0.18} seed={22} colorA="#6a1b9a" colorB="#2d0a45" />
            <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
              <path
                d="M10 20 C 30 30, 24 50, 44 54 C 60 57, 58 74, 76 82"
                fill="none"
                stroke="#c65bff"
                strokeWidth="1.3"
                strokeLinecap="round"
                opacity="0.8"
              />
            </svg>
          </>
        )}

        {clave === "protoss" && (
          <>
            <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
              <g fill="none" stroke="#ffd76a" strokeWidth="1" opacity="0.75">
                <path d="M50 4 L70 20 L70 50" />
                <path d="M50 96 L30 80 L30 50" />
                <path d="M4 50 L30 50" />
                <path d="M96 50 L70 50" />
              </g>
            </svg>
            <span className="avatar-skin-arco" />
          </>
        )}

        {clave === "terran" && (
          <>
            <svg className="avatar-skin-svg" viewBox="0 0 100 100" aria-hidden="true">
              <g stroke="#9fb4c7" strokeWidth="0.8" opacity="0.6">
                <line x1="0" y1="34" x2="100" y2="34" />
                <line x1="0" y1="66" x2="100" y2="66" />
              </g>
              <g fill="#cfe0ee" opacity="0.7">
                <circle cx="10" cy="34" r="1.4" />
                <circle cx="90" cy="34" r="1.4" />
                <circle cx="10" cy="66" r="1.4" />
                <circle cx="90" cy="66" r="1.4" />
              </g>
            </svg>
            <span className="avatar-skin-escaneo" />
          </>
        )}
      </span>
    </span>
  );
}
