import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatearHoraLocal } from "../lib/clanWars";

interface LogroClanWar {
  id: string;
  rivalNombre: string;
  rivalTag: string;
  fechaHoraCet: string;
  gane: boolean;
  empate: boolean;
  formato: "simple" | "wtl";
  jugadoresPorSet: number;
}

interface LogrosClanWarListProps {
  teamId: string;
  className?: string;
}

// Migración 091: Clan Wars finalizadas de un equipo que NO vienen de
// ningún torneo (Clan War Amistosa incluida, y cualquier reto directo
// de siempre) -- pública, vía logros_clan_war_de() (RPC sin
// restricción de participante). Se muestra en la pestaña "Logros" de
// la ficha pública del equipo, junto a los Títulos Padre/Hijo.
export default function LogrosClanWarList({ teamId, className = "" }: LogrosClanWarListProps) {
  const [logros, setLogros] = useState<LogroClanWar[]>([]);

  useEffect(() => {
    let cancelado = false;

    supabase
      .rpc("logros_clan_war_de", { p_team_id: teamId })
      .then(({ data }) => {
        if (cancelado) return;
        setLogros(
          (data ?? []).map((f: any) => ({
            id: f.id,
            rivalNombre: f.rival_nombre,
            rivalTag: f.rival_tag,
            fechaHoraCet: f.fecha_hora_cet,
            gane: f.gane,
            empate: f.empate,
            formato: f.formato,
            jugadoresPorSet: f.jugadores_por_set,
          }))
        );
      });

    return () => {
      cancelado = true;
    };
  }, [teamId]);

  if (logros.length === 0) {
    return <p className="detail-empty">Todavía no hay Clan Wars amistosas jugadas.</p>;
  }

  return (
    <div className={className}>
      {logros.map((l) => (
        <div key={l.id} className="detail-participant-item">
          <span className={l.gane ? "result-win" : "result-loss"}>
            {l.empate ? "Empate" : l.gane ? "Victoria" : "Derrota"}
          </span>
          vs {l.rivalNombre} [{l.rivalTag}]
          <span className="tournament-card-meta">
            {" "}
            · {l.formato === "wtl" ? `Clan vs Clan (WTL) ${l.jugadoresPorSet} sets` : `${l.jugadoresPorSet}v${l.jugadoresPorSet}`}
            {" "}
            · {formatearHoraLocal(l.fechaHoraCet)}
          </span>
        </div>
      ))}
    </div>
  );
}
