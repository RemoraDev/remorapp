import { Link } from "react-router-dom";
import { formatFecha } from "../lib/formatters";

export interface NoticiaPreview {
  id: string;
  titulo: string;
  createdAt: string;
}

interface Props {
  noticias?: NoticiaPreview[];
  cargando?: boolean;
}

// Página de Noticias dentro del carrusel de Inicio -- HomePage.tsx hace
// la carga y arma un grupo de a NOTICIAS_POR_PAGINA por página de
// carrusel. Si no hay ninguna noticia cargada, HomePage directamente no
// incluye esta página en el carrusel (no tiene sentido mostrar un
// slide vacío que dice "todavía no hay noticias").
export default function NewsSection({ noticias = [], cargando = false }: Props) {
  return (
    <section className="home-news-section">
      <h2 className="detail-subtitle">Noticias</h2>
      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {!cargando && (
        <ul className="home-news-preview-list">
          {noticias.map((n) => (
            <li key={n.id}>
              <Link to="/news">{n.titulo}</Link>
              <span className="tournament-card-meta">{formatFecha(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/news" className="btn-link">
        Ver todas las noticias
      </Link>
    </section>
  );
}
