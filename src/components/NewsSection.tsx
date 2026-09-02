import { Link } from "react-router-dom";

// Sección de Noticias dentro de Inicio -- reemplaza al ícono propio
// que tenía en la barra inferior. Todavía no existe ningún sistema
// real de publicaciones (no hay tabla en la base ni forma de
// cargarlas): esto muestra el mismo aviso "Próximamente" que ya tenía
// /news, solo que ahora vive acá en vez de en una página aparte.
export default function NewsSection() {
  return (
    <section className="home-news-section">
      <h2 className="detail-subtitle">Noticias</h2>
      <p className="tournament-card-meta">
        Todavía no hay publicaciones cargadas. Acá van a aparecer las novedades de la comunidad y
        de los torneos de RemorApp.
      </p>
      <Link to="/news" className="btn-link">
        Ver todas las noticias
      </Link>
    </section>
  );
}
