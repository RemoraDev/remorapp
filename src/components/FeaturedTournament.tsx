import type { Torneo } from "../types";

interface FeaturedTournamentProps {
  torneo: Torneo;
}

export default function FeaturedTournament({ torneo }: FeaturedTournamentProps) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Torneo destacado</h2>
      </div>
      <div className="featured">
        <div className="featured-glow" aria-hidden />
        <div className="featured-body">
          <div>
            <span className="featured-badge">{torneo.juego}</span>
            <h3 className="featured-title">{torneo.nombre}</h3>
            <p className="featured-meta">
              {torneo.formato} · Abierto a {torneo.paises.join(", ")} · Comienza el{" "}
              {torneo.fechaInicio}
            </p>
          </div>
          <div className="featured-stats">
            <div>
              <p className="featured-stat-label">Pozo</p>
              <p className="featured-stat-value featured-stat-value-gold">{torneo.pozo}</p>
            </div>
            <div>
              <p className="featured-stat-label">Cupos</p>
              <p className="featured-stat-value">
                {torneo.cuposOcupados}/{torneo.cuposTotales}
              </p>
            </div>
          </div>
        </div>
        <button className="btn btn-primary featured-cta">Ver torneo</button>
      </div>
    </section>
  );
}
