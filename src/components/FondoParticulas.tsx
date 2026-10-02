import type { CSSProperties } from "react";

// Fondo de partículas subiendo en zigzag ("esporas") -- puro CSS, ver
// @keyframes home-subir-zigzag en halcon.css. Compartido entre la
// portada de Inicio y la vista de escritorio del perfil de jugador (a
// pedido del usuario, "el mismo efecto en los dos lados"). El
// contenedor que lo use necesita position:relative + overflow:hidden
// para que el fondo quede recortado a esa sección.
//
// Cantidad fija, a mano -- no por Math.random() en cada render (se
// recalcularía solo, el fondo "saltaría" en cada re-render). Cada una
// entra con un retraso/duración/posición propios, para que no se vean
// todas sincronizadas en fila.
const PARTICULAS = Array.from({ length: 18 }, (_, i) => ({
  izquierda: (i * 37 + 5) % 100,
  retraso: (i % 9) * 1.1,
  duracion: 9 + (i % 5) * 1.8,
  tamano: 3 + (i % 3),
  zigzag: i % 2 === 0 ? 1 : -1,
}));

export default function FondoParticulas() {
  return (
    <div className="home-particulas" aria-hidden="true">
      {PARTICULAS.map((p, i) => {
        // CSSProperties no tipa variables CSS propias (--zigzag) -- se
        // castea, igual que cualquier otro estilo inline calculado.
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
  );
}
