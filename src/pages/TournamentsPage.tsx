import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import TournamentListCard from "../components/TournamentListCard";
import type { EventoPublico } from "../types/tournaments";

// Migración 109: "Torneos" pasa a llamarse "Eventos" y lista los tres
// tipos juntos (torneo por ligas, Clan War Amistosa, Race War) -- ver
// eventos_publicos() en la base. Antes había acá un botón aparte
// "Crear Race War"; ahora Race War es una opción más dentro de "Crear
// evento" (CreateTournamentPage.tsx), igual que Clan War Amistosa.
export default function TournamentsPage() {
  const [eventos, setEventos] = useState<EventoPublico[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .rpc("eventos_publicos")
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando eventos:", error);
        } else {
          setEventos((data ?? []) as EventoPublico[]);
        }
        setLoading(false);
      });
  }, []);

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Eventos</h1>
        <Link to="/tournaments/create" className="btn btn-primary">
          Crear evento
        </Link>
      </div>

      <p className="tournament-card-meta">
        <Link to="/tournaments/history" className="btn-link">
          Ver historial de torneos finalizados
        </Link>
        {" · "}
        <Link to="/torneos-historicos" className="btn-link">
          Ver torneos históricos (pre-RemorApp)
        </Link>
      </p>

      {loading && <p className="tournament-card-meta">Cargando eventos...</p>}

      {!loading && eventos.length === 0 && (
        <p className="tournament-card-meta">No hay eventos abiertos por ahora.</p>
      )}

      {!loading && eventos.length > 0 && (
        <div className="tournament-grid">
          {eventos.map((evento) => (
            <TournamentListCard key={`${evento.tipo}-${evento.id}`} evento={evento} />
          ))}
        </div>
      )}
    </section>
  );
}
