import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface NoticiaPreview {
  id: string;
  titulo: string;
  createdAt: string;
}

// Sección de Noticias dentro de Inicio -- una vista previa corta de
// las últimas 3, el listado completo vive en /news (que ahora también
// tiene su propio ícono en la barra inferior).
export default function NewsSection() {
  const [noticias, setNoticias] = useState<NoticiaPreview[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase
      .from("noticias")
      .select("id, titulo, created_at")
      .order("created_at", { ascending: false })
      .limit(3)
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando noticias:", error);
        } else {
          setNoticias((data ?? []).map((n) => ({ id: n.id, titulo: n.titulo, createdAt: n.created_at })));
        }
        setCargando(false);
      });
  }, []);

  return (
    <section className="home-news-section">
      <h2 className="detail-subtitle">Noticias</h2>
      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {!cargando && noticias.length === 0 && (
        <p className="tournament-card-meta">
          Todavía no hay publicaciones cargadas. Acá van a aparecer las novedades de la comunidad y
          de los torneos de RemorApp.
        </p>
      )}
      {noticias.length > 0 && (
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
