import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import type { ClanWarProxima } from "../types/clanWars";

// Listado completo de Clan Wars programadas (confirmadas o en curso),
// sin cortar en hoy/mañana como el widget de Inicio -- mismo dato
// (clan_wars_proximas()), sin filtrar en el frontend.
export default function ClanWarsSchedulePage() {
  const [clanWars, setClanWars] = useState<ClanWarProxima[] | null>(null);

  useEffect(() => {
    supabase.rpc("clan_wars_proximas").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando el horario de Clan Wars:", error);
        setClanWars([]);
        return;
      }
      setClanWars((data ?? []) as ClanWarProxima[]);
    });
  }, []);

  return (
    <section className="section section-page">
      <h1 className="section-title">Horario de Clan Wars</h1>
      <p className="tournament-card-meta">Todas las Clan Wars confirmadas, ordenadas por fecha.</p>

      {clanWars === null ? (
        <p className="tournament-card-meta">Cargando...</p>
      ) : clanWars.length === 0 ? (
        <p className="detail-empty">No hay ninguna Clan War programada por el momento.</p>
      ) : (
        <div className="detail-participant-list">
          {clanWars.map((cw) => (
            <div key={cw.id} className="proxima-clan-war-item proxima-clan-war-item-completo">
              <span className="proxima-clan-war-hora">{formatFecha(cw.fecha_hora_cet)}</span>
              <span className="proxima-clan-war-equipos">
                {cw.challenger_nombre} [{cw.challenger_tag}] vs {cw.challenged_nombre} [{cw.challenged_tag}]
              </span>
              <span className="badge badge-format">{cw.formato === "wtl" ? "WTL" : "Simple"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
