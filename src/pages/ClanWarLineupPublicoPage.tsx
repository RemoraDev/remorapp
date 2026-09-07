import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import TarjetaLineupClanWar from "../components/TarjetaLineupClanWar";
import type { LineupPublicoClanWar } from "../types/clanWars";

// Vista pública del lineup de una Clan War (migración 066, con la
// tarjeta visual de la migración 067): a la que lleva la tarjeta de
// "Clan Wars próximas" en Inicio, una vez que lineup_revelado es true.
// Usa lineup_publico_clan_war() -- un solo jsonb armado en la base
// (mismo espíritu que overlay_clan_war()), sin exponer clan_war_lineup
// en crudo a nadie no involucrado. Si alguien llega acá con el link
// directo antes de que se revele, la función igual responde (con
// revelado: false y los lineups en null), así que esta vista solo
// tiene que mostrar el aviso de espera en ese caso.
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
          <p className="tournament-card-meta" style={{ marginBottom: "1rem" }}>
            {formatFecha(datos.fecha_hora_cet)} · Formato {datos.formato === "wtl" ? "WTL" : "Simple"}
          </p>

          {!datos.revelado ? (
            <p className="detail-empty">
              Todavía no se reveló la alineación de ambos equipos -- volvé a intentarlo más cerca del
              inicio de la Clan War.
            </p>
          ) : (
            <TarjetaLineupClanWar datos={datos} />
          )}
        </>
      )}
    </section>
  );
}
