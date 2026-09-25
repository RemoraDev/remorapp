import { Link } from "react-router-dom";
import { getModoLabel, getFormatoLabel } from "../lib/tournamentOptions";
import { formatCuposDisponibles, formatFecha, formatPozo } from "../lib/formatters";
import type { EventoPublico } from "../types/tournaments";

interface TournamentListCardProps {
  evento: EventoPublico;
}

const RUTA_POR_TIPO: Record<EventoPublico["tipo"], (id: string) => string> = {
  torneo: (id) => `/tournaments/${id}`,
  race_war: (id) => `/guerra-razas/${id}`,
  clan_war_amistosa: (id) => `/clan-war/${id}`,
};

const ETIQUETA_POR_TIPO: Record<EventoPublico["tipo"], string> = {
  torneo: "Torneo por ligas",
  race_war: "Race War",
  clan_war_amistosa: "Clan War Amistosa",
};

// Tarjeta para el listado público de eventos (migración 109: torneo
// por ligas, Race War y Clan War Amistosa juntos) -- distinta de
// TournamentCard.tsx, que todavía muestra los torneos de ejemplo de la
// portada con datos mock, no de Supabase.
export default function TournamentListCard({ evento }: TournamentListCardProps) {
  const esTorneo = evento.tipo === "torneo";

  return (
    <Link to={RUTA_POR_TIPO[evento.tipo](evento.id)} className="tournament-card">
      <div>
        <div className="tournament-card-head">
          <span className={`badge badge-tipo-evento badge-tipo-${evento.tipo}`}>
            {ETIQUETA_POR_TIPO[evento.tipo]}
          </span>
          {esTorneo && evento.formato && <span className="badge badge-format">{getFormatoLabel(evento.formato)}</span>}
          {esTorneo && evento.modo && <span className="badge badge-format">{getModoLabel(evento.modo)}</span>}
        </div>
        <h3 className="tournament-card-title">{evento.titulo}</h3>
        <p className="tournament-card-meta">
          {esTorneo && evento.cupos_totales !== null && evento.cupos_ocupados !== null && (
            <>{formatCuposDisponibles(evento.cupos_totales, evento.cupos_ocupados)} · </>
          )}
          Comienza el {formatFecha(evento.fecha)}
        </p>
      </div>
      {esTorneo && (
        <div className="tournament-card-foot">
          <div>
            <p className="tournament-card-stat-label">Pozo</p>
            <p className="tournament-card-stat-value tournament-card-stat-value-accent">
              {formatPozo(evento.pozo_premio)}
            </p>
          </div>
        </div>
      )}
    </Link>
  );
}
