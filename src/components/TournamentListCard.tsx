import { Link } from "react-router-dom";
import { getModoLabel } from "../lib/tournamentOptions";
import { formatCuposDisponibles, formatFecha, formatPozo } from "../lib/formatters";
import type { TournamentRow } from "../types/tournaments";

interface TournamentListCardProps {
  torneo: TournamentRow;
}

// Tarjeta para el listado público de torneos (distinta de
// TournamentCard.tsx, que todavía muestra los torneos de ejemplo
// de la portada con datos mock, no de Supabase).
export default function TournamentListCard({ torneo }: TournamentListCardProps) {
  return (
    <Link to={`/tournaments/${torneo.id}`} className="tournament-card">
      <div>
        <div className="tournament-card-head">
          <span className="badge badge-format">{torneo.formato}</span>
          <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
        </div>
        <h3 className="tournament-card-title">{torneo.nombre}</h3>
        <p className="tournament-card-game">{torneo.juego}</p>
        <p className="tournament-card-meta">
          {formatCuposDisponibles(torneo.cupos_totales, torneo.cupos_ocupados)} · Comienza el{" "}
          {formatFecha(torneo.fecha_inicio)}
        </p>
      </div>
      <div className="tournament-card-foot">
        <div>
          <p className="tournament-card-stat-label">Pozo</p>
          <p className="tournament-card-stat-value tournament-card-stat-value-accent">
            {formatPozo(torneo.pozo_premio)}
          </p>
        </div>
      </div>
    </Link>
  );
}
