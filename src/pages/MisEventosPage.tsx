import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { obtenerComunidadesDelUsuario, obtenerEventosDeComunidad } from "../lib/comunidades";
import { getModoLabel, getFormatoLabel } from "../lib/tournamentOptions";
import { formatFecha, formatPozo } from "../lib/formatters";
import type { TournamentRow, TorneoEstado } from "../types/tournaments";
import type { ComunidadRow, EventoComunidad } from "../types/comunidades";

const ESTADO_LABEL: Record<TorneoEstado, string> = {
  abierto: "Abierto",
  en_curso: "En curso",
  finalizado: "Finalizado",
};

function extraerTorneo(torneos: unknown): TournamentRow | null {
  const t = Array.isArray(torneos) ? torneos[0] : torneos;
  return (t as TournamentRow | undefined) ?? null;
}

// Mis Eventos (migración 201, a pedido del usuario): acceso directo en
// la barra inferior, junto al botón central -- solo aparece si
// pertenezco a (o creé) al menos una comunidad (ver BottomNav.tsx).
// "Generales" es lo mismo que mostraba Torneos inscritos
// (MyTournamentsPage.tsx, que sigue existiendo aparte sin tocarse);
// después, una pestaña por cada comunidad propia con SUS eventos
// (torneo/Race War/Clan War Amistosa vinculados a esa comunidad_id).
export default function MisEventosPage() {
  const { user, loading } = useAuth();

  const [torneosInscritos, setTorneosInscritos] = useState<TournamentRow[]>([]);
  const [cargandoGenerales, setCargandoGenerales] = useState(true);

  const [comunidades, setComunidades] = useState<ComunidadRow[]>([]);
  const [tab, setTab] = useState<string>("generales");

  const [eventosPorComunidad, setEventosPorComunidad] = useState<Record<string, EventoComunidad[]>>({});
  const [cargandoComunidad, setCargandoComunidad] = useState(false);

  useEffect(() => {
    if (!user) {
      setCargandoGenerales(false);
      return;
    }

    supabase
      .from("tournament_participants")
      .select("tournament_id, tournaments!tournament_id(*)")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando torneos inscritos:", error);
          setCargandoGenerales(false);
          return;
        }
        const lista = (data ?? [])
          .map((fila) => extraerTorneo(fila.tournaments))
          .filter((t): t is TournamentRow => t !== null);
        setTorneosInscritos(lista);
        setCargandoGenerales(false);
      });

    obtenerComunidadesDelUsuario(user.id).then(setComunidades);
  }, [user]);

  useEffect(() => {
    if (tab === "generales") return;
    if (eventosPorComunidad[tab]) return;

    setCargandoComunidad(true);
    obtenerEventosDeComunidad(tab).then((eventos) => {
      setEventosPorComunidad((prev) => ({ ...prev, [tab]: eventos }));
      setCargandoComunidad(false);
    });
  }, [tab, eventosPorComunidad]);

  if (!loading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para ver tus eventos</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  const eventosComunidadActual = tab !== "generales" ? eventosPorComunidad[tab] ?? [] : [];

  return (
    <section className="section section-page">
      <h1 className="section-title">Mis Eventos</h1>

      <div className="team-config-media-tabs">
        <button
          type="button"
          className={`team-config-media-tab ${tab === "generales" ? "is-active" : ""}`}
          onClick={() => setTab("generales")}
        >
          Generales
        </button>
        {comunidades.map((comunidad) => (
          <button
            key={comunidad.id}
            type="button"
            className={`team-config-media-tab ${tab === comunidad.id ? "is-active" : ""}`}
            onClick={() => setTab(comunidad.id)}
          >
            {comunidad.nombre}
          </button>
        ))}
      </div>

      {tab === "generales" && (
        <>
          {cargandoGenerales && <p className="tournament-card-meta">Cargando...</p>}
          {!cargandoGenerales && torneosInscritos.length === 0 && (
            <p className="detail-empty">Todavía no te inscribiste a ningún torneo.</p>
          )}
          {!cargandoGenerales && torneosInscritos.length > 0 && (
            <div className="tournament-grid">
              {torneosInscritos.map((torneo) => (
                <Link key={torneo.id} to={`/tournaments/${torneo.id}`} className="tournament-card">
                  <div>
                    <div className="tournament-card-head">
                      <span className="badge badge-format">{getFormatoLabel(torneo.formato)}</span>
                      <span className="badge badge-format">{getModoLabel(torneo.modo)}</span>
                      <span className="badge badge-format">{ESTADO_LABEL[torneo.estado]}</span>
                    </div>
                    <h3 className="tournament-card-title">{torneo.nombre}</h3>
                    <p className="tournament-card-meta">Comienza el {formatFecha(torneo.fecha_inicio)}</p>
                  </div>
                  {torneo.pozo_premio !== null && (
                    <div className="tournament-card-foot">
                      <div>
                        <p className="tournament-card-stat-label">Pozo</p>
                        <p className="tournament-card-stat-value tournament-card-stat-value-accent">
                          {formatPozo(torneo.pozo_premio)}
                        </p>
                      </div>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {tab !== "generales" && (
        <>
          {cargandoComunidad && !eventosPorComunidad[tab] ? (
            <p className="tournament-card-meta">Cargando...</p>
          ) : eventosComunidadActual.length === 0 ? (
            <p className="detail-empty">Todavía no hay eventos creados para esta comunidad.</p>
          ) : (
            <div className="detail-participant-list">
              {eventosComunidadActual.map((evento) => (
                <Link
                  key={`${evento.tipo}-${evento.id}`}
                  to={evento.href}
                  className="detail-participant-item detail-participant-item-evento"
                >
                  {evento.titulo}
                  <span className="tournament-card-meta">{formatFecha(evento.fecha)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
