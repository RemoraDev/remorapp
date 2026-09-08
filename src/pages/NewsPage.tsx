import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface NoticiaRow {
  id: string;
  titulo: string;
  contenido: string;
  createdAt: string;
  autorNombre: string;
}

// Antes esta página era un aviso fijo de "Próximamente" -- la tabla
// noticias y su RLS (migración 065) ya existían, incluida la política
// de insert para is_admin(); solo faltaba una pantalla real que lea y
// muestre esas filas (esta) y un formulario para publicar (ver la
// pestaña Noticias del Panel de Administración).
export default function NewsPage() {
  const [noticias, setNoticias] = useState<NoticiaRow[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase
      .from("noticias")
      .select("id, titulo, contenido, created_at, publicado_por")
      .order("created_at", { ascending: false })
      .then(async ({ data, error }) => {
        if (error || !data) {
          console.error("Error cargando noticias:", error);
          setCargando(false);
          return;
        }

        const autorIds = [...new Set(data.map((n) => n.publicado_por))];
        let nombrePorAutorId: Record<string, string> = {};
        if (autorIds.length > 0) {
          const { data: perfilesData } = await supabase
            .from("profiles")
            .select("id, nick, unique_id")
            .in("id", autorIds);
          nombrePorAutorId = Object.fromEntries(
            (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "RemorApp"])
          );
        }

        setNoticias(
          data.map((n) => ({
            id: n.id,
            titulo: n.titulo,
            contenido: n.contenido,
            createdAt: n.created_at,
            autorNombre: nombrePorAutorId[n.publicado_por] ?? "RemorApp",
          }))
        );
        setCargando(false);
      });
  }, []);

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Noticias</h1>
      </div>

      {cargando && <p className="tournament-card-meta">Cargando noticias...</p>}
      {!cargando && noticias.length === 0 && (
        <p className="detail-empty">Todavía no hay ninguna noticia publicada.</p>
      )}

      <div className="news-list">
        {noticias.map((n) => (
          <article key={n.id} className="news-item">
            <h2 className="news-item-title">{n.titulo}</h2>
            <p className="news-item-meta">
              {n.autorNombre} · {formatFecha(n.createdAt)}
            </p>
            <p className="news-item-contenido">{n.contenido}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
