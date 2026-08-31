import { Link } from "react-router-dom";
import { torneosActivos } from "../data/mockTournaments";
import TournamentCard from "./TournamentCard";

export default function ActiveTournaments() {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Torneos activos</h2>
        <Link to="/tournaments" className="btn-link">
          Ver todos
        </Link>
      </div>
      <div className="tournament-grid">
        {torneosActivos.map((torneo) => (
          <TournamentCard key={torneo.id} torneo={torneo} />
        ))}
      </div>
    </section>
  );
}
