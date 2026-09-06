import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import type { LineupPublicoClanWar } from "../types/clanWars";

// Vista pública del lineup de una Clan War (migración 066): a la que
// lleva la tarjeta de "Clan Wars próximas" en Inicio, una vez que
// lineup_revelado es true. Usa lineup_publico_clan_war() -- un solo
// jsonb armado en la base (mismo espíritu que overlay_clan_war()), sin
// exponer clan_war_lineup en crudo a nadie no involucrado. Si alguien
// llega acá con el link directo antes de que se revele, la función
// igual responde (con revelado: false y los lineups en null), así que
// esta vista solo tiene que mostrar el aviso de espera en ese caso.
export default function ClanWarLineupPublicoPage() {
  const { id } = useParams<{ id: string }>();
  const [datos, setDatos] = useState<LineupPublicoClanWar | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase.rpc("lineup_publico_clan_war", { p_clan_war_id: id }).then(({ data, error: rpcError }) => {
      setCargando(false);
      if (rpcError || !data) {
        setError("No se pudo cargar esta Clan War.");
        return;
      }
      setDatos(data as LineupPublicoClanWar);
    });
  }, [id]);

  return (
    <section className="section section-page">
      <Link to="/" className="team-panel-back">
        ← Volver a Inicio
      </Link>

      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {error && <div className="form-error">{error}</div>}

      {datos && (
        <>
          <h1 className="section-title">
            {datos.challenger.nombre} [{datos.challenger.tag}] vs {datos.challenged.nombre} [
            {datos.challenged.tag}]
          </h1>
          <p className="tournament-card-meta">
            {formatFecha(datos.fecha_hora_cet)} · Formato {datos.formato === "wtl" ? "WTL" : "Simple"}
          </p>

          {!datos.revelado ? (
            <p className="detail-empty">
              Todavía no se reveló la alineación de ambos equipos -- volvé a intentarlo más cerca del
              inicio de la Clan War.
            </p>
          ) : (
            <>
              {(datos.caster_nombre || datos.caster_link) && (
                <p className="tournament-card-meta">
                  Caster: {datos.caster_nombre ?? "Por confirmar"}
                  {datos.caster_link && (
                    <>
                      {" "}
                      (
                      <a href={datos.caster_link} target="_blank" rel="noreferrer noopener" className="btn-link">
                        {datos.caster_link}
                      </a>
                      )
                    </>
                  )}
                </p>
              )}

              <div className="detail-columns">
                <div>
                  <h3 className="detail-subtitle">
                    {datos.challenger.nombre} [{datos.challenger.tag}]
                  </h3>
                  {!datos.lineup_challenger || datos.lineup_challenger.length === 0 ? (
                    <p className="detail-empty">Sin lineup declarado.</p>
                  ) : (
                    <div className="detail-participant-list">
                      {datos.lineup_challenger.map((j, indice) => (
                        <div key={indice} className="detail-participant-item">
                          {j.posicion && <span className="liga-badge">Pos. {j.posicion}</span>}
                          {j.nombre}
                          {j.es_temporal && <span className="team-temp-badge">Temporal</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="detail-subtitle">
                    {datos.challenged.nombre} [{datos.challenged.tag}]
                  </h3>
                  {!datos.lineup_challenged || datos.lineup_challenged.length === 0 ? (
                    <p className="detail-empty">Sin lineup declarado.</p>
                  ) : (
                    <div className="detail-participant-list">
                      {datos.lineup_challenged.map((j, indice) => (
                        <div key={indice} className="detail-participant-item">
                          {j.posicion && <span className="liga-badge">Pos. {j.posicion}</span>}
                          {j.nombre}
                          {j.es_temporal && <span className="team-temp-badge">Temporal</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
