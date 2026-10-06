import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatearHoraLocal } from "../lib/clanWars";

interface ActividadClan {
  tipo: "clan_war_amistosa" | "torneo" | "race_war";
  id: string;
  titulo: string;
  fecha: string;
  detalle: string;
}

interface ActividadClanListProps {
  teamId: string;
  className?: string;
}

function linkDe(ev: ActividadClan): string {
  if (ev.tipo === "clan_war_amistosa") return `/clan-war/${ev.id}`;
  if (ev.tipo === "race_war") return `/guerra-razas/${ev.id}`;
  return `/tournaments/${ev.id}`;
}

// Migración 165, a pedido del usuario: "Actividad" ahora es solo lo
// que está en curso (Clan War Amistosa, torneos y Race War en los que
// el equipo está inscrito o que organizó, sin terminar) -- lo
// finalizado se mudó a la sub-pestaña "Finalizados".
export default function ActividadClanList({ teamId, className = "" }: ActividadClanListProps) {
  const [actividad, setActividad] = useState<ActividadClan[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    supabase
      .rpc("actividad_clan_en_curso", { p_team_id: teamId })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) console.error("Error cargando actividad del clan:", error);
        setActividad((data ?? []) as ActividadClan[]);
        setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [teamId]);

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (actividad.length === 0) {
    return <p className="detail-empty">Este equipo no tiene ninguna actividad en curso por el momento.</p>;
  }

  return (
    <div className={className}>
      {actividad.map((ev) => (
        <Link key={`${ev.tipo}-${ev.id}`} to={linkDe(ev)} className="detail-participant-item">
          {ev.titulo}
          <span className="reto-status">{ev.detalle}</span>
          <span className="tournament-card-meta"> · {formatearHoraLocal(ev.fecha)}</span>
        </Link>
      ))}
    </div>
  );
}
