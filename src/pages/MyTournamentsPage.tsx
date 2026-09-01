import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getModoLabel } from "../lib/tournamentOptions";
import { formatFecha, formatPozo } from "../lib/formatters";
import type { TournamentRow, TorneoEstado } from "../types/tournaments";

const ESTADO_LABEL: Record<TorneoEstado, string> = {
  abierto: "Abierto",
  en_curso: "En curso",
  finalizado: "Finalizado",
};

// tournament_participants.tournament_id -> tournaments.id sí tiene FK,
// así que PostgREST embebe el torneo directo; igual puede venir como
// objeto o como array de 1 según la versión, sin tipos generados.
function extraerTorneo(torneos: unknown): TournamentRow | null {
  const t = Array.isArray(torneos) ? torneos[0] : torneos;
  return (t as TournamentRow | undefined) ?? null;
}

export default function MyTournamentsPage() {
  const { user, loading } = useAuth();
  const [torneos, setTorneos] = useState<TournamentRow[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!user) {
      setCargando(false);
      return;
    }

    supabase
      .from("tournament_participants")
      // "tournaments!tournament_id" y no solo "tournaments": hay dos
      // relaciones entre estas tablas (esta, y tournaments.
      // campeon_participant_id que apunta al revés a
      // tournament_participants), así que PostgREST necesita el nombre
      // de la columna para saber cuál de las dos usar acá.
      .select("tournament_id, tournaments!tournament_id(*)")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando torneos inscritos:", error);
          setCargando(false);
          return;
        }
        const lista = (data ?? [])
          .map((fila) => extraerTorneo(fila.tournaments))
          .filter((t): t is TournamentRow => t !== null);
        setTorneos(lista);
        setCargando(false);
      });
  }, [user]);

  if (!loading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para ver tus torneos</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="section section-page">
      <h1 className="section-title">Torneos inscritos</h1>

      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {!cargando && torneos.length === 0 && (
        <p className="tournament-card-meta">Todavía no te inscribiste a ningún torneo.</p>
      )}

      {!cargando && torneos.length > 0 && (
        <div className="tournament-grid">
          {torneos.map((torneo) => (
            <Link key={torneo.id} to={`/tournaments/${torneo.id}`} className="tournament-card">
              <div>
                <div className="tournament-card-head">
                  <span className="badge badge-format">{torneo.formato}</span>
                  <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
                  <span className="badge badge-format">{ESTADO_LABEL[torneo.estado]}</span>
                </div>
                <h3 className="tournament-card-title">{torneo.nombre}</h3>
                <p className="tournament-card-meta">Comienza el {formatFecha(torneo.fecha_inicio)}</p>
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
          ))}
        </div>
      )}
    </section>
  );
}
