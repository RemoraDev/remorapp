import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getModoDescripcion, getModoLabel } from "../lib/tournamentOptions";
import { formatFecha, formatPozo } from "../lib/formatters";
import type { TournamentRow } from "../types/tournaments";

interface MapaSeleccionado {
  nombre: string;
  esVeteable: boolean;
}

interface ParticipanteConNombre {
  id: string;
  userId: string;
  nombre: string | null;
}

// PostgREST embebe una relación "to-one" a veces como objeto y a veces
// como array de un elemento; sin tipos generados de la base no hay forma
// de saberlo en tiempo de compilación, así que se contemplan las dos.
function extraerNombreDeMapa(maps: unknown): string {
  if (Array.isArray(maps)) {
    return (maps[0] as { nombre?: string } | undefined)?.nombre ?? "Mapa";
  }
  return (maps as { nombre?: string } | null)?.nombre ?? "Mapa";
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [torneo, setTorneo] = useState<TournamentRow | null>(null);
  const [mapas, setMapas] = useState<MapaSeleccionado[]>([]);
  const [participantes, setParticipantes] = useState<ParticipanteConNombre[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [inscribiendo, setInscribiendo] = useState(false);
  const [inscripcionError, setInscripcionError] = useState<string | null>(null);

  const cargarTorneo = useCallback(async () => {
    if (!id) return;

    const { data: torneoData, error: torneoError } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", id)
      .single();

    if (torneoError || !torneoData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setTorneo(torneoData);

    const { data: mapasData } = await supabase
      .from("tournament_maps")
      .select("es_veteable, maps(nombre)")
      .eq("tournament_id", id);

    setMapas(
      (mapasData ?? []).map((m) => ({
        // La relación viene embebida por la FK tournament_maps.map_id -> maps.id.
        // Sin tipos generados de la base, PostgREST puede devolverla como
        // objeto o como array de 1 según la versión; se contemplan las dos.
        nombre: extraerNombreDeMapa(m.maps),
        esVeteable: m.es_veteable,
      }))
    );

    const { data: participantesData } = await supabase
      .from("tournament_participants")
      .select("id, user_id, inscrito_en")
      .eq("tournament_id", id)
      .order("inscrito_en", { ascending: true });

    const userIds = (participantesData ?? []).map((p) => p.user_id);
    let nombresPorId: Record<string, string | null> = {};

    // tournament_participants.user_id apunta a auth.users, no a
    // profiles, así que no hay join automático: se resuelven los
    // nombres en una segunda consulta aparte.
    if (userIds.length > 0) {
      const { data: perfilesData } = await supabase
        .from("profiles")
        .select("id, nombre")
        .in("id", userIds);

      nombresPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nombre]));
    }

    setParticipantes(
      (participantesData ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        nombre: nombresPorId[p.user_id] ?? null,
      }))
    );

    setLoading(false);
  }, [id]);

  useEffect(() => {
    cargarTorneo();
  }, [cargarTorneo]);

  const yaInscrito = !!user && participantes.some((p) => p.userId === user.id);
  const cuposDisponibles = torneo ? torneo.cupos_totales - torneo.cupos_ocupados : 0;

  const handleInscribirse = async () => {
    if (!user || !torneo) return;

    setInscribiendo(true);
    setInscripcionError(null);

    const { error } = await supabase
      .from("tournament_participants")
      .insert({ tournament_id: torneo.id, user_id: user.id });

    if (error) {
      const mensaje =
        error.code === "23505" ? "Ya estás inscrito en este torneo." : error.message;
      setInscripcionError(mensaje);
      setInscribiendo(false);
      return;
    }

    await cargarTorneo();
    setInscribiendo(false);
  };

  if (loading) {
    return (
      <section className="section section-page">
        <p className="tournament-card-meta">Cargando torneo...</p>
      </section>
    );
  }

  if (notFound || !torneo) {
    return (
      <section className="page-placeholder">
        <h1>Torneo no encontrado</h1>
        <p>
          <Link to="/tournaments" className="btn-link">
            Volver a torneos
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="section section-page">
      <div className="detail-badges">
        <span className="badge badge-format">{torneo.formato}</span>
        <span className={`badge ${torneo.publico ? "badge-public" : "badge-private"}`}>
          {torneo.publico ? "Público" : "Privado"}
        </span>
      </div>

      <h1 className="section-title">{torneo.nombre}</h1>
      <p className="tournament-card-meta">
        {getModoLabel(torneo.modo)} — {getModoDescripcion(torneo.modo)}
      </p>

      <div className="detail-stats">
        <div>
          <p className="featured-stat-label">Pozo</p>
          <p className="featured-stat-value featured-stat-value-accent">
            {formatPozo(torneo.pozo_premio)}
          </p>
        </div>
        <div>
          <p className="featured-stat-label">Cupos</p>
          <p className="featured-stat-value">
            {torneo.cupos_ocupados}/{torneo.cupos_totales}
          </p>
        </div>
        <div>
          <p className="featured-stat-label">Inicio</p>
          <p className="featured-stat-value">{formatFecha(torneo.fecha_inicio)}</p>
        </div>
      </div>

      <h2 className="detail-subtitle">Mapas</h2>
      {mapas.length === 0 ? (
        <p className="detail-empty">El organizador todavía no eligió mapas.</p>
      ) : (
        <div className="detail-map-list">
          {mapas.map((mapa, i) => (
            <span key={i} className="detail-map-chip">
              {mapa.nombre}
              {mapa.esVeteable && <span className="veto-tag">· vetable</span>}
            </span>
          ))}
        </div>
      )}

      <h2 className="detail-subtitle">Participantes ({participantes.length})</h2>
      {participantes.length === 0 ? (
        <p className="detail-empty">Todavía no hay nadie inscrito.</p>
      ) : (
        <div className="detail-participant-list">
          {participantes.map((p) => (
            <div key={p.id} className="detail-participant-item">
              <span className="detail-participant-avatar">
                {(p.nombre ?? "?").charAt(0).toUpperCase()}
              </span>
              {p.nombre ?? "Jugador de RemorApp"}
            </div>
          ))}
        </div>
      )}

      <div className="detail-register-box">
        {inscripcionError && <div className="form-error">{inscripcionError}</div>}

        {!user && (
          <p className="tournament-card-meta">
            <Link to="/login" className="btn-link">
              Inicia sesión
            </Link>{" "}
            para inscribirte.
          </p>
        )}

        {user && yaInscrito && <p className="form-success">Ya estás inscrito en este torneo.</p>}

        {user && !yaInscrito && torneo.estado !== "abierto" && (
          <p className="tournament-card-meta">Las inscripciones están cerradas.</p>
        )}

        {user && !yaInscrito && torneo.estado === "abierto" && cuposDisponibles <= 0 && (
          <p className="tournament-card-meta">Sin cupos disponibles.</p>
        )}

        {user && !yaInscrito && torneo.estado === "abierto" && cuposDisponibles > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={inscribiendo}
            onClick={handleInscribirse}
          >
            {inscribiendo ? "Inscribiendo..." : "Inscribirme"}
          </button>
        )}
      </div>
    </section>
  );
}
