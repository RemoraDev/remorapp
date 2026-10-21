// Corrección QA/UX: los listados públicos (Clanes, Comunidades,
// Torneos, Ranking) mostraban un simple "Cargando..." de texto plano
// mientras esperaban la respuesta de Supabase -- la grilla aparecía
// de golpe recién al terminar, un parpadeo vacío->lleno notorio. Dos
// esqueletos reutilizables (tarjeta de grilla y fila de lista) cubren
// la mayoría de los casos sin tener que armar un skeleton a mano por
// página.
interface CardGridSkeletonProps {
  count?: number;
}

export function CardGridSkeleton({ count = 6 }: CardGridSkeletonProps) {
  return (
    <div className="team-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="team-card skeleton-card">
          <div className="skeleton-block skeleton-card-logo" />
          <div className="skeleton-card-info">
            <div className="skeleton-block skeleton-line" style={{ width: "70%" }} />
            <div className="skeleton-block skeleton-line" style={{ width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TournamentGridSkeleton({ count = 6 }: CardGridSkeletonProps) {
  return (
    <div className="tournament-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="tournament-card skeleton-card">
          <div>
            <div className="skeleton-block skeleton-line" style={{ width: "60%", marginBottom: "0.75rem" }} />
            <div className="skeleton-block skeleton-line" style={{ width: "85%", height: "1.1rem" }} />
          </div>
          <div className="skeleton-block skeleton-line" style={{ width: "45%" }} />
        </div>
      ))}
    </div>
  );
}

interface ListSkeletonProps {
  count?: number;
}

export function ListSkeleton({ count = 5 }: ListSkeletonProps) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-block skeleton-row" />
      ))}
    </div>
  );
}
