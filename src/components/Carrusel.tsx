import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginaCarrusel {
  key: string;
  contenido: ReactNode;
}

interface CarruselProps {
  paginas: PaginaCarrusel[];
}

export interface CarruselHandle {
  irAPagina: (indice: number) => void;
}

// Carrusel horizontal genérico (Inicio y Mi perfil, migración 110):
// scroll-snap nativo del navegador, sin ninguna librería de gestos --
// funciona con el dedo en celular y con las flechas en escritorio (sin
// pantalla táctil). Cada página es 100% del ancho y
// 100% del alto disponible; si el contenido de una página es más alto
// que ese espacio, esa página hace scroll vertical PROPIA (overflow-y
// acá adentro), sin que la ventana ni <main> se muevan -- ver
// .carrusel-pagina en halcon.css.
//
// forwardRef + useImperativeHandle (portada de Inicio): un botón
// dentro de una página del carrusel ("Ver próximos eventos") necesita
// poder mandar al carrusel a otra página puntual -- irAPagina() ya
// existía adentro nada más, acá se expone hacia afuera sin cambiar en
// nada el uso sin ref que ya tenía Mi perfil.
const Carrusel = forwardRef<CarruselHandle, CarruselProps>(function Carrusel({ paginas }, ref) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [indiceActivo, setIndiceActivo] = useState(0);

  const irAPagina = (i: number) => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    contenedor.scrollTo({ left: i * contenedor.clientWidth, behavior: "smooth" });
  };

  useImperativeHandle(ref, () => ({ irAPagina }), []);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;

    const onScroll = () => {
      const ancho = contenedor.clientWidth || 1;
      setIndiceActivo(Math.round(contenedor.scrollLeft / ancho));
    };

    contenedor.addEventListener("scroll", onScroll, { passive: true });
    return () => contenedor.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="carrusel-wrap">
      <div className="carrusel" ref={contenedorRef}>
        {paginas.map((p) => (
          <div className="carrusel-pagina" key={p.key}>
            {p.contenido}
          </div>
        ))}
      </div>

      {paginas.length > 1 && (
        <div className="carrusel-controles">
          <button
            type="button"
            className="carrusel-flecha"
            onClick={() => irAPagina(indiceActivo - 1)}
            disabled={indiceActivo === 0}
            aria-label="Página anterior"
          >
            <ChevronLeft size={18} />
          </button>

          <button
            type="button"
            className="carrusel-flecha"
            onClick={() => irAPagina(indiceActivo + 1)}
            disabled={indiceActivo === paginas.length - 1}
            aria-label="Página siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
});

export default Carrusel;
