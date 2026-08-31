import type { Torneo } from "../types";

interface TournamentCardProps {
  torneo: Torneo;
}

export default function TournamentCard({ torneo }: TournamentCardProps) {
  const esPublico = torneo.visibilidad === "publico";

  return (
    <div className="tournament-card">
      <div>
        <div className="tournament-card-head">
          <span className="badge badge-format">{torneo.formato}</span>
          <span className={`badge ${esPublico ? "badge-public" : "badge-private"}`}>
            {esPublico ? "Público" : "Privado"}
          </span>
        </div>
        <h3 className="tournament-card-title">{torneo.nombre}</h3>
        <p className="tournament-card-game">{torneo.juego}</p>
        <p className="tournament-card-meta">
          Comienza el {torneo.fechaInicio} · {torneo.paises.join(", ")}
        </p>
      </div>
      <div className="tournament-card-foot">
        <div>
          <p className="tournament-card-stat-label">Cupos</p>
          <p className="tournament-card-stat-value">
            {torneo.cuposOcupados}/{torneo.cuposTotales}
          </p>
        </div>
        {torneo.pozo && (
          <div className="tournament-card-stat-right">
            <p className="tournament-card-stat-label">Pozo</p>
            <p className="tournament-card-stat-value tournament-card-stat-value-accent">
              {torneo.pozo}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
