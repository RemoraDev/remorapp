interface PublicacionForo {
  titulo: string;
  autor: string;
  fecha: string;
  respuestas: number;
}

// Publicaciones de ejemplo: todavía no hay funcionalidad real de crear
// publicaciones ni de responder, es solo la vista (mismo criterio que
// se usó con Noticias al principio del proyecto).
const PUBLICACIONES_EJEMPLO: PublicacionForo[] = [
  {
    titulo: "¿Cuál es el mejor build order contra Zerg en 1v1?",
    autor: "CarpeDiem#82451",
    fecha: "3 de septiembre",
    respuestas: 14,
  },
  {
    titulo: "Buscamos 2 jugadores para clan competitivo en Chile",
    autor: "NovaStrike#10234",
    fecha: "1 de septiembre",
    respuestas: 6,
  },
  {
    titulo: "Guía rápida: cómo vetar mapas antes de un torneo",
    autor: "AdminRemor#00001",
    fecha: "29 de agosto",
    respuestas: 21,
  },
  {
    titulo: "Feedback sobre el nuevo sistema de inscripción",
    autor: "Wraithling#55219",
    fecha: "27 de agosto",
    respuestas: 9,
  },
  {
    titulo: "¿Alguien juega en el servidor Europa desde Latinoamérica?",
    autor: "LagKing#33012",
    fecha: "25 de agosto",
    respuestas: 17,
  },
];

export default function ForumPage() {
  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Foro</h1>
      </div>
      <p className="tournament-card-meta">
        Publicar todavía no está disponible — esto es solo una vista de ejemplo.
      </p>

      <div className="foro-list">
        {PUBLICACIONES_EJEMPLO.map((post) => (
          <div key={post.titulo} className="foro-post">
            <div className="foro-post-info">
              <h3 className="foro-post-title">{post.titulo}</h3>
              <p className="foro-post-meta">
                {post.autor} · {post.fecha}
              </p>
            </div>
            <div className="foro-post-replies">
              <span className="foro-post-replies-count">{post.respuestas}</span>
              <span className="foro-post-replies-label">respuestas</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
