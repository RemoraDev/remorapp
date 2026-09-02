import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import { SC2_REGION_OPTIONS } from "../types/profile";
import type { Sc2Region } from "../types/profile";
import type { HistoricalTournamentEstado, HistoricalTournamentRow } from "../types/historicalTournaments";

interface ParticipanteConNombre {
  id: string;
  nombreClan: string;
  teamId: string | null;
  teamTag: string | null;
  consentimiento: boolean | null;
}

interface TorneoConParticipantes {
  torneo: HistoricalTournamentRow;
  participantes: ParticipanteConNombre[];
}

interface FilaFormulario {
  nombreClan: string;
  tag: string;
}

const ESTADO_LABEL: Record<HistoricalTournamentEstado, string> = {
  pendiente_consentimiento: "Pendiente de consentimiento",
  confirmado: "Confirmado",
  referencia_historica: "Referencia histórica (sin confirmar)",
};

export default function HistoricalTournamentsPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<TorneoConParticipantes[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Formulario de registro ---
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [nombre, setNombre] = useState("");
  const [fechaAproximada, setFechaAproximada] = useState("");
  const [servidor, setServidor] = useState<Sc2Region | "">("");
  const [primerLugarNombre, setPrimerLugarNombre] = useState("");
  const [primerLugarTag, setPrimerLugarTag] = useState("");
  const [segundoLugarNombre, setSegundoLugarNombre] = useState("");
  const [segundoLugarTag, setSegundoLugarTag] = useState("");
  const [otrosParticipantes, setOtrosParticipantes] = useState<FilaFormulario[]>([{ nombreClan: "", tag: "" }]);
  const [registrando, setRegistrando] = useState(false);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  const [registroEnviado, setRegistroEnviado] = useState(false);

  const cargar = async () => {
    setLoading(true);

    const { data: torneosData } = await supabase
      .from("historical_tournaments")
      .select("*")
      .order("created_at", { ascending: false });

    const torneos = (torneosData ?? []) as HistoricalTournamentRow[];
    if (torneos.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data: participantesData } = await supabase
      .from("historical_tournament_participants")
      .select("*")
      .in(
        "historical_tournament_id",
        torneos.map((t) => t.id)
      );

    const teamIds = [...new Set((participantesData ?? []).map((p) => p.team_id).filter((id): id is string => id !== null))];
    let tagPorTeamId: Record<string, string> = {};
    if (teamIds.length > 0) {
      const { data: equiposData } = await supabase.from("teams").select("id, tag").in("id", teamIds);
      tagPorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.tag]));
    }

    setItems(
      torneos.map((torneo) => ({
        torneo,
        participantes: (participantesData ?? [])
          .filter((p) => p.historical_tournament_id === torneo.id)
          .map((p) => ({
            id: p.id,
            nombreClan: p.nombre_clan,
            teamId: p.team_id,
            teamTag: p.team_id ? tagPorTeamId[p.team_id] ?? null : null,
            consentimiento: p.consentimiento,
          })),
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    cargar();
  }, []);

  const handleAgregarFila = () => {
    setOtrosParticipantes((prev) => [...prev, { nombreClan: "", tag: "" }]);
  };

  const handleCambiarFila = (index: number, campo: keyof FilaFormulario, valor: string) => {
    setOtrosParticipantes((prev) =>
      prev.map((fila, i) => (i === index ? { ...fila, [campo]: valor } : fila))
    );
  };

  const handleQuitarFila = (index: number) => {
    setOtrosParticipantes((prev) => prev.filter((_, i) => i !== index));
  };

  // Un tag vacío no se resuelve (queda sin vincular); uno escrito que
  // no existe es un error -- mejor avisar ahora que dejar un dato mal
  // cargado.
  const resolverTag = async (tag: string): Promise<string | null> => {
    const tagLimpio = tag.trim().toUpperCase();
    if (!tagLimpio) return null;

    const { data, error } = await supabase.from("teams").select("id").eq("tag", tagLimpio).maybeSingle();
    if (error || !data) {
      throw new Error(`No encontré ningún equipo con el tag "${tagLimpio}".`);
    }
    return data.id;
  };

  const handleRegistrar = async (event: FormEvent) => {
    event.preventDefault();
    setErrorRegistro(null);
    setRegistroEnviado(false);

    if (!nombre.trim() || !fechaAproximada || !servidor || !primerLugarNombre.trim() || !segundoLugarNombre.trim()) {
      setErrorRegistro("Completa el nombre del torneo, la fecha, el servidor, y el 1° y 2° lugar.");
      return;
    }

    setRegistrando(true);

    try {
      const primerLugarTeamId = await resolverTag(primerLugarTag);
      const segundoLugarTeamId = await resolverTag(segundoLugarTag);

      const participantesResueltos = [];
      for (const fila of otrosParticipantes) {
        if (!fila.nombreClan.trim()) continue;
        const teamId = await resolverTag(fila.tag);
        participantesResueltos.push({ nombre_clan: fila.nombreClan.trim(), team_id: teamId });
      }

      const { error } = await supabase.rpc("registrar_torneo_historico", {
        p_nombre: nombre.trim(),
        p_fecha_aproximada: fechaAproximada,
        p_servidor: servidor,
        p_primer_lugar_nombre: primerLugarNombre.trim(),
        p_primer_lugar_team_id: primerLugarTeamId,
        p_segundo_lugar_nombre: segundoLugarNombre.trim(),
        p_segundo_lugar_team_id: segundoLugarTeamId,
        p_participantes: participantesResueltos,
      });

      if (error) {
        setErrorRegistro(error.message);
        setRegistrando(false);
        return;
      }

      setRegistroEnviado(true);
      setNombre("");
      setFechaAproximada("");
      setServidor("");
      setPrimerLugarNombre("");
      setPrimerLugarTag("");
      setSegundoLugarNombre("");
      setSegundoLugarTag("");
      setOtrosParticipantes([{ nombreClan: "", tag: "" }]);
      await cargar();
    } catch (err) {
      setErrorRegistro(err instanceof Error ? err.message : "No se pudo registrar el torneo.");
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Torneos Históricos</h1>
        {user && (
          <button type="button" className="btn btn-ghost" onClick={() => setMostrarFormulario((v) => !v)}>
            {mostrarFormulario ? "Cerrar" : "Registrar torneo histórico"}
          </button>
        )}
      </div>

      <p className="tournament-card-meta">
        Competencias jugadas antes de RemorApp. Solo se confirman -- con el bono de cortesía de MMR
        para el 1° y 2° lugar que estén vinculados a un equipo real -- cuando todos los clanes
        vinculados aceptan que quede público. Si alguno rechaza, el registro queda como referencia
        histórica visible, sin bono para nadie.
      </p>

      {mostrarFormulario && user && (
        <form className="auth-form" onSubmit={handleRegistrar}>
          {errorRegistro && <div className="form-error">{errorRegistro}</div>}
          {registroEnviado && <div className="form-success">¡Torneo histórico registrado!</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="ht-nombre">
              Nombre del torneo
            </label>
            <input
              id="ht-nombre"
              className="form-input"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ht-fecha">
              Fecha aproximada
            </label>
            <input
              id="ht-fecha"
              className="form-input"
              type="date"
              value={fechaAproximada}
              onChange={(e) => setFechaAproximada(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ht-servidor">
              Servidor
            </label>
            <select
              id="ht-servidor"
              className="form-select"
              value={servidor}
              onChange={(e) => setServidor(e.target.value as Sc2Region)}
            >
              <option value="">Selecciona un servidor</option>
              {SC2_REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ht-primer-nombre">
              Primer lugar -- nombre del clan
            </label>
            <input
              id="ht-primer-nombre"
              className="form-input"
              type="text"
              value={primerLugarNombre}
              onChange={(e) => setPrimerLugarNombre(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ht-primer-tag">
              Primer lugar -- tag en RemorApp (opcional, si el clan está registrado)
            </label>
            <input
              id="ht-primer-tag"
              className="form-input"
              type="text"
              placeholder="QSQD"
              value={primerLugarTag}
              onChange={(e) => setPrimerLugarTag(e.target.value.toUpperCase())}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ht-segundo-nombre">
              Segundo lugar -- nombre del clan
            </label>
            <input
              id="ht-segundo-nombre"
              className="form-input"
              type="text"
              value={segundoLugarNombre}
              onChange={(e) => setSegundoLugarNombre(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ht-segundo-tag">
              Segundo lugar -- tag en RemorApp (opcional)
            </label>
            <input
              id="ht-segundo-tag"
              className="form-input"
              type="text"
              placeholder="QSQD"
              value={segundoLugarTag}
              onChange={(e) => setSegundoLugarTag(e.target.value.toUpperCase())}
            />
          </div>

          <p className="form-hint">Otros clanes participantes (opcional, uno por fila):</p>
          {otrosParticipantes.map((fila, index) => (
            <div key={index} className="form-group">
              <input
                className="form-input"
                type="text"
                placeholder="Nombre del clan"
                value={fila.nombreClan}
                onChange={(e) => handleCambiarFila(index, "nombreClan", e.target.value)}
              />
              <input
                className="form-input"
                type="text"
                placeholder="Tag en RemorApp (opcional)"
                value={fila.tag}
                onChange={(e) => handleCambiarFila(index, "tag", e.target.value.toUpperCase())}
              />
              <button type="button" className="btn btn-ghost" onClick={() => handleQuitarFila(index)}>
                Quitar
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={handleAgregarFila}>
            Agregar otro clan
          </button>

          <button type="submit" className="btn btn-primary btn-block" disabled={registrando}>
            {registrando ? "Registrando..." : "Registrar torneo histórico"}
          </button>
        </form>
      )}

      {loading && <p className="tournament-card-meta">Cargando torneos históricos...</p>}
      {!loading && items.length === 0 && (
        <p className="tournament-card-meta">Todavía no hay torneos históricos registrados.</p>
      )}

      <div className="history-list">
        {items.map(({ torneo, participantes }) => (
          <div key={torneo.id} className="history-card">
            <div className="detail-badges">
              <span className="badge badge-format">
                {SC2_REGION_OPTIONS.find((o) => o.value === torneo.servidor)?.label ?? torneo.servidor}
              </span>
              <span className="badge badge-format">{ESTADO_LABEL[torneo.estado]}</span>
            </div>

            <h3 className="tournament-card-title">{torneo.nombre}</h3>
            <p className="tournament-card-meta">{formatFecha(torneo.fecha_aproximada)}</p>

            <p className="form-success">🥇 {torneo.primer_lugar_nombre}</p>
            <p className="tournament-card-meta">🥈 {torneo.segundo_lugar_nombre}</p>

            <h4 className="detail-subtitle">Participantes</h4>
            <div className="detail-participant-list">
              {participantes.map((p) => (
                <div key={p.id} className="detail-participant-item">
                  {p.nombreClan}
                  {p.teamTag && <span className="profile-nick-id">[{p.teamTag}]</span>}
                  {p.teamId && (
                    <span className="reto-status">
                      {p.consentimiento === true
                        ? "Aceptó"
                        : p.consentimiento === false
                        ? "Rechazó"
                        : "Sin responder"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
