import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { formatFecha } from "../lib/formatters";
import type { NoticiaPreview } from "./NewsSection";

interface Props {
  noticiasDestacadas: NoticiaPreview[];
  onVerProximosEventos: () => void;
}

// Portada de Inicio (primera página del carrusel): título de marca,
// hasta 3 noticias destacadas si es que hay (las siguientes, si
// existen, van en páginas de Noticias aparte -- ver HomePage.tsx), y
// un llamado a la acción que lleva directo a la página de "Clan Wars
// próximas" del mismo carrusel, sin salir de Inicio.
export default function HomePortada({ noticiasDestacadas, onVerProximosEventos }: Props) {
  return (
    <div className="home-portada">
      <div className="home-portada-glow" aria-hidden="true" />
      <h1 className="home-portada-titulo">
        Bienvenidos a RemorApp<span className="home-portada-titulo-accent"> Gaming</span>
      </h1>
      <div className="home-portada-franja" />

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

      <button type="button" className="btn btn-primary btn-primary-lg home-portada-cta" onClick={onVerProximosEventos}>
        Ver próximos eventos
        <ArrowRight size={18} className="icon-inline" aria-hidden="true" />
      </button>
    </div>
  );
}
