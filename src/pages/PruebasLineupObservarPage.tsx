import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatFecha } from "../lib/formatters";
import type { FondoLineup } from "../types/teams";

// Se refresca sola cada 7s (mismo intervalo que las páginas de overlay)
// para que el armado del lineup y el check-in se vean "en vivo" sin
// tener que recargar la página a mano.
const INTERVALO_MS = 7000;

interface RetoObservado {
  id: string;
  status: string;
  formato: string;
  fechaHoraCet: string;
  fondoLineup: FondoLineup;
  challengerTeamId: string;
  challengedTeamId: string;
  lineupVistoBuenoChallenger: boolean;
  lineupVistoBuenoChallenged: boolean;
  challengerConfirmado: boolean;
  challengedConfirmado: boolean;
}

interface EquipoInfo {
  name: string;
  tag: string;
}

interface LineupEntry {
  id: string;
  teamId: string;
  posicion: number | null;
  linkVerificacion: string | null;
  nombre: string;
}

// PostgREST embebe una relación "to-one" a veces como objeto y a veces
// como array de un elemento -- mismo patrón que el resto de la app.
function extraerUno<T>(valor: unknown): T | null {
  if (Array.isArray(valor)) return (valor[0] as T) ?? null;
  return (valor as T) ?? null;
}

export default function PruebasLineupObservarPage() {
  const { clanWarId } = useParams<{ clanWarId: string }>();
  const { user, loading } = useAuth();

  const [reto, setReto] = useState<RetoObservado | null>(null);
  const [equipoChallenger, setEquipoChallenger] = useState<EquipoInfo | null>(null);
  const [equipoChallenged, setEquipoChallenged] = useState<EquipoInfo | null>(null);
  const [lineup, setLineup] = useState<LineupEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!clanWarId) return;

    // Sin es_dueno_plataforma(), esta consulta simplemente vuelve
    // vacía (RLS) -- no hace falta ninguna otra verificación acá.
    const { data: retoData, error: retoError } = await supabase
      .from("clan_wars")
      .select(
        "id, status, formato, fecha_hora_cet, fondo_lineup, challenger_team_id, challenged_team_id, lineup_visto_bueno_challenger, lineup_visto_bueno_challenged, challenger_confirmado, challenged_confirmado"
      )
      .eq("id", clanWarId)
      .maybeSingle();

    if (retoError || !retoData) {
      setError(retoError?.message ?? "No se pudo cargar este reto (o no tienes acceso).");
      setCargando(false);
      return;
    }

    setReto({
      id: retoData.id,
      status: retoData.status,
      formato: retoData.formato,
      fechaHoraCet: retoData.fecha_hora_cet,
      fondoLineup: retoData.fondo_lineup as FondoLineup,
      challengerTeamId: retoData.challenger_team_id,
      challengedTeamId: retoData.challenged_team_id,
      lineupVistoBuenoChallenger: retoData.lineup_visto_bueno_challenger,
      lineupVistoBuenoChallenged: retoData.lineup_visto_bueno_challenged,
      challengerConfirmado: retoData.challenger_confirmado,
      challengedConfirmado: retoData.challenged_confirmado,
    });

    const [{ data: teamA }, { data: teamB }, { data: lineupData }] = await Promise.all([
      supabase.from("teams").select("name, tag").eq("id", retoData.challenger_team_id).maybeSingle(),
      supabase.from("teams").select("name, tag").eq("id", retoData.challenged_team_id).maybeSingle(),
      supabase
        .from("clan_war_lineup")
        .select(
          "id, team_id, posicion, link_verificacion, profiles!clan_war_lineup_jugador_id_fkey(nick, unique_id), team_temp_players(nick_temporal)"
        )
        .eq("clan_war_id", clanWarId),
    ]);

    setEquipoChallenger(teamA);
    setEquipoChallenged(teamB);

    setLineup(
      (lineupData ?? []).map((entry) => {
        const jugador = extraerUno<{ nick: string | null; unique_id: string }>(entry.profiles);
        const temporal = extraerUno<{ nick_temporal: string }>(entry.team_temp_players);
        const nombre = jugador
          ? `${jugador.nick ?? "Jugador"}${jugador.unique_id ? `#${jugador.unique_id}` : ""}`
          : temporal
            ? `${temporal.nick_temporal} (Temporal)`
            : "Jugador";
        return {
          id: entry.id,
          teamId: entry.team_id,
          posicion: entry.posicion,
          linkVerificacion: entry.link_verificacion,
          nombre,
        };
      })
    );

    setCargando(false);
  }, [clanWarId]);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, INTERVALO_MS);
    return () => clearInterval(intervalo);
  }, [cargar]);

  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;

  return (
    <section className="section section-page">
      <Link to="/admin" className="team-panel-back">
        ← Volver a Administración
      </Link>
      <h1 className="section-title">Sala de lineup (solo observación)</h1>
      <p className="tournament-card-meta">
        Vista de solo lectura -- no podés armar el lineup ni confirmar el check-in desde acá. Se
        actualiza sola cada pocos segundos.
      </p>

      {error && <div className="form-error">{error}</div>}
      {cargando && <p className="tournament-card-meta">Cargando...</p>}

      {reto && (
        <div className="clan-war-lineup-room" data-fondo-lineup={reto.fondoLineup}>
          <h2 className="detail-subtitle">
            {equipoChallenger?.tag ?? "Equipo A"} vs {equipoChallenged?.tag ?? "Equipo B"}
          </h2>
          <p className="tournament-card-meta">
            Estado: {reto.status} · Formato: {reto.formato} · {formatFecha(reto.fechaHoraCet)}
          </p>

          <div className="detail-columns">
            <div>
              <h3 className="detail-subtitle">
                {equipoChallenger?.name ?? "Equipo A"} ({equipoChallenger?.tag})
              </h3>
              <p className="tournament-card-meta">
                Lineup: {reto.lineupVistoBuenoChallenger ? "Confirmado" : "Pendiente"} · Check-in:{" "}
                {reto.challengerConfirmado ? "Confirmado" : "Pendiente"}
              </p>
              {lineup.filter((l) => l.teamId === reto.challengerTeamId).length === 0 ? (
                <p className="detail-empty">Todavía no hay jugadores en el lineup.</p>
              ) : (
                <div className="detail-participant-list">
                  {lineup
                    .filter((l) => l.teamId === reto.challengerTeamId)
                    .map((l) => (
                      <div key={l.id} className="detail-participant-item">
                        {l.posicion && <span className="liga-badge">Pos. {l.posicion}</span>}
                        {l.nombre}
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="detail-subtitle">
                {equipoChallenged?.name ?? "Equipo B"} ({equipoChallenged?.tag})
              </h3>
              <p className="tournament-card-meta">
                Lineup: {reto.lineupVistoBuenoChallenged ? "Confirmado" : "Pendiente"} · Check-in:{" "}
                {reto.challengedConfirmado ? "Confirmado" : "Pendiente"}
              </p>
              {lineup.filter((l) => l.teamId === reto.challengedTeamId).length === 0 ? (
                <p className="detail-empty">Todavía no hay jugadores en el lineup.</p>
              ) : (
                <div className="detail-participant-list">
                  {lineup
                    .filter((l) => l.teamId === reto.challengedTeamId)
                    .map((l) => (
                      <div key={l.id} className="detail-participant-item">
                        {l.posicion && <span className="liga-badge">Pos. {l.posicion}</span>}
                        {l.nombre}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
