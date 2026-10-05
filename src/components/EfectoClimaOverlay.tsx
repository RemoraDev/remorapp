import type { EfectoClima } from "../types/guerraRazas";

// Overlay de clima para el fondo de Guerra de Razas (migración 161):
// SVG animado con SMIL (<animate>/<animateMotion>/<animateTransform>),
// no CSS -- así el efecto queda autocontenido en el propio SVG, sin
// depender de que el contenedor tenga las keyframes correctas. Se
// pinta absoluto, cubriendo todo el padre (pointer-events: none, para
// no bloquear nada debajo), así que el padre solo necesita
// position: relative.
interface EfectoClimaOverlayProps {
  efecto: EfectoClima;
}

export default function EfectoClimaOverlay({ efecto }: EfectoClimaOverlayProps) {
  if (efecto === "ninguno") return null;

  return (
    <svg
      className="efecto-clima-overlay"
      viewBox="0 0 400 300"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {efecto === "lluvia" && <EfectoLluvia />}
      {efecto === "nevado" && <EfectoNevado />}
      {efecto === "rayos" && <EfectoRayos />}
      {efecto === "soleado" && <EfectoSoleado />}
    </svg>
  );
}

// 28 gotas, cada una con su propio ángulo, largo, velocidad y demora
// -- el módulo evita que todas caigan exactamente igual (se nota
// mucho la repetición con pocos elementos si caen en bloque).
function EfectoLluvia() {
  const gotas = Array.from({ length: 28 }, (_, i) => {
    const x = (i * 37) % 400;
    const largo = 14 + ((i * 11) % 10);
    const inclinacion = -14;
    const duracion = 0.55 + ((i * 7) % 5) * 0.07;
    const demora = -((i * 13) % 100) / 100;
    const opacidad = 0.18 + ((i * 17) % 30) / 100;
    return { x, largo, inclinacion, duracion, demora, opacidad, key: i };
  });

  return (
    <g strokeLinecap="round">
      {gotas.map((g) => (
        <line
          key={g.key}
          x1={g.x}
          y1={-20}
          x2={g.x + g.inclinacion}
          y2={-20 + g.largo}
          stroke="#bfe3ff"
          strokeOpacity={g.opacidad}
          strokeWidth={1.4}
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            from="0 0"
            to="-40 340"
            dur={`${g.duracion}s`}
            begin={`${g.demora}s`}
            repeatCount="indefinite"
          />
        </line>
      ))}
    </g>
  );
}

// 24 copos, radio y velocidad variables (los más chicos caen más
// lento, como si estuvieran más atrás) -- cada uno con una leve
// oscilación horizontal vía animateMotion sobre un path ondulado.
function EfectoNevado() {
  const copos = Array.from({ length: 24 }, (_, i) => {
    const x = (i * 53) % 400;
    const radio = 1.4 + ((i * 7) % 5) * 0.5;
    const duracion = 5 + ((i * 11) % 7);
    const demora = -((i * 19) % 100) / 100;
    const amplitud = 10 + ((i * 5) % 15);
    const opacidad = 0.45 + ((i * 13) % 40) / 100;
    const path = `M0,0 q${amplitud},40 0,80 q-${amplitud},40 0,80 q${amplitud},40 0,80 q-${amplitud},40 0,80`;
    return { x, radio, duracion, demora, opacidad, path, key: i };
  });

  return (
    <g fill="#ffffff">
      {copos.map((c) => (
        <circle key={c.key} cx={c.x} cy={-10} r={c.radio} fillOpacity={c.opacidad}>
          <animateMotion path={c.path} dur={`${c.duracion}s`} begin={`${c.demora}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

// Dos rayos con trazado en zigzag (quiebres bruscos, como un rayo de
// verdad) y un resplandor detrás (feGaussianBlur) -- el flash general
// de la escena es un rect blanco que pulsa junto con cada rayo,
// sincronizado por los mismos keyTimes.
function EfectoRayos() {
  return (
    <>
      <defs>
        <filter id="efecto-rayos-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="400" height="300" fill="#eaf4ff" opacity="0">
        <animate
          attributeName="opacity"
          values="0;0;0.35;0.05;0.3;0;0;0;0;0;0.22;0;0;0;0"
          keyTimes="0;0.38;0.4;0.43;0.45;0.5;0.6;0.72;0.74;0.77;0.79;0.84;0.9;0.95;1"
          dur="7s"
          repeatCount="indefinite"
        />
      </rect>

      <path
        d="M150,0 L132,70 L158,78 L118,170 L142,150 L108,300"
        fill="none"
        stroke="#d9ecff"
        strokeWidth="3"
        strokeLinejoin="round"
        filter="url(#efecto-rayos-glow)"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0;1;0.2;1;0;0;0;0;0;0;0;0;0;0"
          keyTimes="0;0.38;0.4;0.43;0.45;0.5;0.6;0.72;0.74;0.77;0.79;0.84;0.9;0.95;1"
          dur="7s"
          repeatCount="indefinite"
        />
      </path>

      <path
        d="M290,20 L268,100 L296,110 L250,210 L278,195 L246,300"
        fill="none"
        stroke="#d9ecff"
        strokeWidth="2.5"
        strokeLinejoin="round"
        filter="url(#efecto-rayos-glow)"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0;0;0;0;0;0;0;1;0.15;1;0;0;0;0"
          keyTimes="0;0.38;0.4;0.43;0.45;0.5;0.6;0.72;0.74;0.77;0.79;0.84;0.9;0.95;1"
          dur="7s"
          repeatCount="indefinite"
        />
      </path>
    </>
  );
}

// Sol en la esquina (resplandor radial que respira lento) con rayos
// finos girando muy despacio alrededor -- nada parpadea ni compite con
// el marcador, es un efecto de fondo, no debe distraer.
function EfectoSoleado() {
  const cx = 340;
  const cy = 45;
  const rayos = Array.from({ length: 10 }, (_, i) => i * 36);

  return (
    <>
      <defs>
        <radialGradient id="efecto-soleado-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6d8" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#ffe9a8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g stroke="#ffe9a8" strokeWidth="2" strokeLinecap="round" opacity="0.5">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur="50s"
          repeatCount="indefinite"
        />
        {rayos.map((angulo) => (
          <line
            key={angulo}
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy}
            transform={`rotate(${angulo} ${cx} ${cy})`}
          >
            <animate attributeName="y2" values={`${cy - 46};${cy - 54};${cy - 46}`} dur="5s" repeatCount="indefinite" />
          </line>
        ))}
      </g>

      <circle cx={cx} cy={cy} r="60" fill="url(#efecto-soleado-glow)">
        <animate attributeName="r" values="56;64;56" dur="5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="16" fill="#fff8e6">
        <animate attributeName="opacity" values="0.85;1;0.85" dur="5s" repeatCount="indefinite" />
      </circle>
    </>
  );
}
