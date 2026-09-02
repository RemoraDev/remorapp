import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HexPattern from "./HexPattern";

// Frases exactas pedidas, tal cual — no se inventan variantes.
const frasesGaming = [
  "No te bañas dos veces en el mismo build order.",
  "Conócete a ti mismo. Y conoce tu APM.",
  "El que lucha contra los rushes, cuide de no convertirse en un turtle.",
  "Pienso, luego construyo.",
  "Dame un punto de apoyo y un buen scouting, y moveré el mapa.",
  "La victoria pertenece al que más se adapta al meta, no al más fuerte.",
  "Solo sé que no sé nada... hasta que veo el replay.",
  "El silencio del enemigo es la peor de las respuestas.",
];

export default function Hero() {
  const [indice, setIndice] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let idFundido: ReturnType<typeof setTimeout>;

    // setInterval cambia de frase cada 6s. El setTimeout de adentro solo
    // orquesta el fundido: baja la opacidad, recién ahí cambia el texto,
    // y la vuelve a subir — sincronizado con la transición CSS de
    // .hero-phrase (0.3s), para que no sea un salto brusco.
    const idIntervalo = setInterval(() => {
      setVisible(false);
      idFundido = setTimeout(() => {
        setIndice((i) => (i + 1) % frasesGaming.length);
        setVisible(true);
      }, 300);
    }, 6000);

    // Limpia los dos temporizadores al desmontar (si el usuario navega a
    // otra página), para no dejar nada corriendo de fondo.
    return () => {
      clearInterval(idIntervalo);
      clearTimeout(idFundido);
    };
  }, []);

  return (
    <section className="hero">
      {/* Panal decorativo a los costados, detrás del contenido (mismo
          HexPattern.tsx que ya usa la barra de navegación). Acá queda
          quieto a propósito: sin el brillo animado que sí tiene la
          barra, solo la textura. */}
      <HexPattern id="hero-hex-izq" className="hex-pattern hero-hex hero-hex-izq" />
      <HexPattern id="hero-hex-der" className="hex-pattern hero-hex hero-hex-der" />

      <div className="hero-content">
        <h1 className="hero-title">Bienvenidos a RemorApp</h1>
        <p className={`hero-phrase ${visible ? "visible" : ""}`}>{frasesGaming[indice]}</p>
        <Link to="/register" className="btn btn-primary btn-primary-lg hero-cta">
          Crear mi cuenta
        </Link>
      </div>
    </section>
  );
}
