import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { COUNTRY_OPTIONS, PERFIL_TIPO_OPTIONS } from "../types/profile";
import type { PerfilTipo } from "../types/profile";
import type { AdminUserRow } from "../types/admin";
import type { TournamentRow } from "../types/tournaments";
import type { BracketMatchRow } from "../types/bracket";

type Tab = "torneos" | "usuarios" | "disputas";

interface DisputaConNombres extends BracketMatchRow {
  tournamentNombre: string;
  p1Nombre: string;
  p2Nombre: string;
  reportedP1Nombre: string | null;
  reportedP2Nombre: string | null;
}

interface DisputaApuestaConNombres {
  id: string;
  challengerTeamId: string;
  challengerNombre: string;
  challengedTeamId: string;
  challengedNombre: string;
  monto: number;
}

export default function AdminPage() {
  const { user, profile, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("torneos");

  // --- Torneos por confirmar ---
  const [torneos, setTorneos] = useState<TournamentRow[]>([]);
  const [cargandoTorneos, setCargandoTorneos] = useState(true);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  // --- Usuarios ---
  const [usuarios, setUsuarios] = useState<AdminUserRow[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [guardandoUsuario, setGuardandoUsuario] = useState<string | null>(null);
  // Rol elegido en el <select> de cada fila, antes de confirmar "Guardar".
  const [rolesSeleccionados, setRolesSeleccionados] = useState<Record<string, PerfilTipo>>({});

  // --- Disputas de bracket ---
  const [disputas, setDisputas] = useState<DisputaConNombres[]>([]);
  const [cargandoDisputas, setCargandoDisputas] = useState(true);
  const [errorDisputas, setErrorDisputas] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [erroresResolver, setErroresResolver] = useState<Record<string, string>>({});

  // --- Disputas de apuestas de XP entre clanes ---
  const [disputasApuestas, setDisputasApuestas] = useState<DisputaApuestaConNombres[]>([]);
  const [cargandoDisputasApuestas, setCargandoDisputasApuestas] = useState(true);
  const [errorDisputasApuestas, setErrorDisputasApuestas] = useState<string | null>(null);
  const [resolviendoApuesta, setResolviendoApuesta] = useState<string | null>(null);
  const [erroresResolverApuesta, setErroresResolverApuesta] = useState<Record<string, string>>({});

  const esAdmin = !!profile?.es_admin;

  useEffect(() => {
    if (!esAdmin) return;

    supabase
      .from("tournaments")
      .select("*")
      .eq("publico", true)
      .eq("confirmado_por_staff", false)
      .gte("cupos_ocupados", 20)
      .order("creado_en", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setTorneos(data ?? []);
        setCargandoTorneos(false);
      });

    // admin_listar_usuarios es una función (no una tabla): el correo
    // no es público (ver migración 004), así que el listado completo
    // solo se puede pedir así, y la propia función revisa de nuevo
    // que quien llama sea admin antes de devolver algo.
    supabase.rpc("admin_listar_usuarios").then(({ data, error }) => {
      if (error) {
        setErrorUsuarios(error.message);
      } else {
        setUsuarios((data ?? []) as AdminUserRow[]);
      }
      setCargandoUsuarios(false);
    });

    const cargarDisputas = async () => {
      const { data: partidas, error } = await supabase
        .from("bracket_matches")
        .select("*")
        .eq("status", "en_disputa");

      if (error) {
        setErrorDisputas(error.message);
        setCargandoDisputas(false);
        return;
      }

      const filas = (partidas ?? []) as BracketMatchRow[];
      if (filas.length === 0) {
        setDisputas([]);
        setCargandoDisputas(false);
        return;
      }

      const tournamentIds = [...new Set(filas.map((m) => m.tournament_id))];
      // bracket_matches.participant*_id / reported_p*_winner apuntan a
      // tournament_participants, que a su vez apunta a auth.users (no a
      // profiles): mismo patrón de dos consultas encadenadas que ya se
      // usa en participants.ts.
      const participantIds = [
        ...new Set(
          filas
            .flatMap((m) => [m.participant1_id, m.participant2_id, m.reported_p1_winner, m.reported_p2_winner])
            .filter((id): id is string => id !== null)
        ),
      ];

      const [{ data: torneosData }, { data: participantesData }] = await Promise.all([
        supabase.from("tournaments").select("id, nombre").in("id", tournamentIds),
        supabase.from("tournament_participants").select("id, user_id").in("id", participantIds),
      ]);

      const nombreTorneoPorId = Object.fromEntries((torneosData ?? []).map((t) => [t.id, t.nombre]));
      const userIdPorParticipante = Object.fromEntries(
        (participantesData ?? []).map((p) => [p.id, p.user_id])
      );
      const userIds = [...new Set(Object.values(userIdPorParticipante))];

      const { data: perfilesData } = await supabase.from("profiles").select("id, nombre").in("id", userIds);
      const nombrePorUserId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nombre]));

      const nombreDeParticipante = (participantId: string | null) => {
        if (!participantId) return null;
        const uid = userIdPorParticipante[participantId];
        return (uid && nombrePorUserId[uid]) || "Jugador de RemorApp";
      };

      setDisputas(
        filas.map((m) => ({
          ...m,
          tournamentNombre: nombreTorneoPorId[m.tournament_id] ?? "Torneo",
          p1Nombre: nombreDeParticipante(m.participant1_id) ?? "Jugador de RemorApp",
          p2Nombre: nombreDeParticipante(m.participant2_id) ?? "Jugador de RemorApp",
          reportedP1Nombre: nombreDeParticipante(m.reported_p1_winner),
          reportedP2Nombre: nombreDeParticipante(m.reported_p2_winner),
        }))
      );
      setCargandoDisputas(false);
    };

    cargarDisputas();

    const cargarDisputasApuestas = async () => {
      const { data: apuestas, error } = await supabase
        .from("team_xp_wagers")
        .select("id, challenger_team_id, challenged_team_id, monto")
        .eq("status", "en_disputa");

      if (error) {
        setErrorDisputasApuestas(error.message);
        setCargandoDisputasApuestas(false);
        return;
      }

      const filas = apuestas ?? [];
      if (filas.length === 0) {
        setDisputasApuestas([]);
        setCargandoDisputasApuestas(false);
        return;
      }

      const teamIds = [...new Set(filas.flatMap((a) => [a.challenger_team_id, a.challenged_team_id]))];
      const { data: equiposData } = await supabase.from("teams").select("id, name, tag").in("id", teamIds);
      const nombrePorTeamId = Object.fromEntries(
        (equiposData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`])
      );

      setDisputasApuestas(
        filas.map((a) => ({
          id: a.id,
          challengerTeamId: a.challenger_team_id,
          challengerNombre: nombrePorTeamId[a.challenger_team_id] ?? "Equipo",
          challengedTeamId: a.challenged_team_id,
          challengedNombre: nombrePorTeamId[a.challenged_team_id] ?? "Equipo",
          monto: a.monto,
        }))
      );
      setCargandoDisputasApuestas(false);
    };

    cargarDisputasApuestas();
  }, [esAdmin]);

  // Orden importa: primero la sesión, después el perfil (llega por una
  // consulta aparte, después de la sesión) y recién ahí se puede saber
  // si es admin. Mostrar "nada" mientras cualquiera de los dos está
  // cargando, para no mandar a Inicio a un admin real por apurarse.
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!profile) return null;
  if (!profile.es_admin) return <Navigate to="/" replace />;

  const handleConfirmar = async (torneoId: string) => {
    setConfirmando(torneoId);
    const { error } = await supabase
      .from("tournaments")
      .update({ confirmado_por_staff: true })
      .eq("id", torneoId);
    setConfirmando(null);

    // El trigger generar_puntos_organizador ya existente se encarga de
    // los puntos del organizador solo -- no hace falta hacer nada más
    // acá que marcar confirmado_por_staff.
    if (!error) {
      setTorneos((prev) => prev.filter((t) => t.id !== torneoId));
    }
  };

  const handleGuardarRol = async (usuarioId: string) => {
    const nuevoRol = rolesSeleccionados[usuarioId];
    if (!nuevoRol) return;

    setGuardandoUsuario(usuarioId);
    const { error } = await supabase
      .from("profiles")
      .update({ perfil_tipo: nuevoRol })
      .eq("id", usuarioId);
    setGuardandoUsuario(null);

    if (!error) {
      setUsuarios((prev) =>
        prev.map((u) => (u.id === usuarioId ? { ...u, perfil_tipo: nuevoRol } : u))
      );
    }
  };

  const handleSuspender = async (usuarioId: string, suspenderA: boolean) => {
    setGuardandoUsuario(usuarioId);
    const { error } = await supabase
      .from("profiles")
      .update({ suspendido: suspenderA })
      .eq("id", usuarioId);
    setGuardandoUsuario(null);

    if (!error) {
      setUsuarios((prev) =>
        prev.map((u) => (u.id === usuarioId ? { ...u, suspendido: suspenderA } : u))
      );
    }
  };

  const handleResolverDisputa = async (matchId: string, ganadorId: string) => {
    setResolviendo(matchId);
    setErroresResolver((prev) => ({ ...prev, [matchId]: "" }));

    const { error } = await supabase.rpc("resolver_disputa", {
      p_match_id: matchId,
      p_ganador_id: ganadorId,
    });

    setResolviendo(null);

    if (error) {
      setErroresResolver((prev) => ({ ...prev, [matchId]: error.message }));
      return;
    }

    setDisputas((prev) => prev.filter((d) => d.id !== matchId));
  };

  const handleResolverDisputaApuesta = async (wagerId: string, ganadorTeamId: string) => {
    setResolviendoApuesta(wagerId);
    setErroresResolverApuesta((prev) => ({ ...prev, [wagerId]: "" }));

    const { error } = await supabase.rpc("resolver_disputa_apuesta", {
      p_wager_id: wagerId,
      p_ganador_team_id: ganadorTeamId,
    });

    setResolviendoApuesta(null);

    if (error) {
      setErroresResolverApuesta((prev) => ({ ...prev, [wagerId]: error.message }));
      return;
    }

    setDisputasApuestas((prev) => prev.filter((d) => d.id !== wagerId));
  };

  return (
    <section className="section section-page">
      <h1 className="section-title">Administración</h1>

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${tab === "torneos" ? "active" : ""}`}
          onClick={() => setTab("torneos")}
        >
          Torneos por confirmar
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "usuarios" ? "active" : ""}`}
          onClick={() => setTab("usuarios")}
        >
          Usuarios
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "disputas" ? "active" : ""}`}
          onClick={() => setTab("disputas")}
        >
          Disputas
          {disputas.length + disputasApuestas.length > 0 && ` (${disputas.length + disputasApuestas.length})`}
        </button>
      </div>

      {tab === "torneos" && (
        <div className="admin-panel">
          {cargandoTorneos && <p className="tournament-card-meta">Cargando torneos...</p>}
          {!cargandoTorneos && torneos.length === 0 && (
            <p className="tournament-card-meta">No hay torneos pendientes de confirmar.</p>
          )}
          <div className="admin-list">
            {torneos.map((torneo) => (
              <div key={torneo.id} className="admin-row">
                <div className="admin-row-info">
                  <p className="admin-row-title">{torneo.nombre}</p>
                  <p className="admin-row-meta">{torneo.cupos_ocupados} participantes</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={confirmando === torneo.id}
                  onClick={() => handleConfirmar(torneo.id)}
                >
                  {confirmando === torneo.id ? "Confirmando..." : "Confirmar"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "usuarios" && (
        <div className="admin-panel">
          {errorUsuarios && <div className="form-error">{errorUsuarios}</div>}
          {cargandoUsuarios && <p className="tournament-card-meta">Cargando usuarios...</p>}
          <div className="admin-list">
            {usuarios.map((usuario) => (
              <div key={usuario.id} className="admin-row admin-row-usuario">
                <div className="admin-row-info">
                  <p className="admin-row-title">
                    {usuario.nick ?? "Sin nick"}
                    <span className="profile-nick-id">#{usuario.unique_id}</span>
                  </p>
                  <p className="admin-row-meta">{usuario.email ?? "Sin correo"}</p>
                  <p className="admin-row-meta">
                    {COUNTRY_OPTIONS.find((o) => o.value === usuario.country)?.label ?? "Sin país"}
                    {" · "}
                    {usuario.cuenta_validada ? "Cuenta validada" : "Cuenta sin validar"}
                    {usuario.suspendido && " · Suspendido"}
                  </p>
                </div>

                <div className="admin-row-actions">
                  <select
                    className="form-select"
                    value={rolesSeleccionados[usuario.id] ?? usuario.perfil_tipo ?? ""}
                    onChange={(e) =>
                      setRolesSeleccionados((prev) => ({
                        ...prev,
                        [usuario.id]: e.target.value as PerfilTipo,
                      }))
                    }
                  >
                    <option value="" disabled>
                      Sin rol
                    </option>
                    {PERFIL_TIPO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={guardandoUsuario === usuario.id}
                    onClick={() => handleGuardarRol(usuario.id)}
                  >
                    Guardar rol
                  </button>
                  <button
                    type="button"
                    className={`btn ${usuario.suspendido ? "btn-primary" : "btn-ghost"}`}
                    disabled={guardandoUsuario === usuario.id}
                    onClick={() => handleSuspender(usuario.id, !usuario.suspendido)}
                  >
                    {usuario.suspendido ? "Reactivar" : "Suspender"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "disputas" && (
        <div className="admin-panel">
          {errorDisputas && <div className="form-error">{errorDisputas}</div>}
          {cargandoDisputas && <p className="tournament-card-meta">Cargando disputas...</p>}
          {!cargandoDisputas && disputas.length === 0 && (
            <p className="tournament-card-meta">No hay ninguna disputa pendiente.</p>
          )}
          <div className="admin-list">
            {disputas.map((d) => (
              <div key={d.id} className="admin-row admin-row-disputa">
                <div className="admin-row-info">
                  <p className="admin-row-title">{d.tournamentNombre}</p>
                  <p className="admin-row-meta">
                    Ronda {d.round}, partido {d.match_number} · {d.p1Nombre} vs {d.p2Nombre}
                  </p>
                  <p className="admin-row-meta">
                    {d.p1Nombre} reportó que ganó: {d.reportedP1Nombre ?? "sin reportar"}
                  </p>
                  <p className="admin-row-meta">
                    {d.p2Nombre} reportó que ganó: {d.reportedP2Nombre ?? "sin reportar"}
                  </p>
                  {erroresResolver[d.id] && <div className="form-error">{erroresResolver[d.id]}</div>}
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolviendo === d.id}
                    onClick={() => handleResolverDisputa(d.id, d.participant1_id as string)}
                  >
                    Ganó {d.p1Nombre}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolviendo === d.id}
                    onClick={() => handleResolverDisputa(d.id, d.participant2_id as string)}
                  >
                    Ganó {d.p2Nombre}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <h2 className="detail-subtitle">Apuestas de XP en disputa</h2>
          {errorDisputasApuestas && <div className="form-error">{errorDisputasApuestas}</div>}
          {cargandoDisputasApuestas && <p className="tournament-card-meta">Cargando apuestas...</p>}
          {!cargandoDisputasApuestas && disputasApuestas.length === 0 && (
            <p className="tournament-card-meta">No hay ninguna apuesta en disputa.</p>
          )}
          <div className="admin-list">
            {disputasApuestas.map((d) => (
              <div key={d.id} className="admin-row admin-row-disputa">
                <div className="admin-row-info">
                  <p className="admin-row-title">
                    {d.challengerNombre} vs {d.challengedNombre}
                  </p>
                  <p className="admin-row-meta">Apuesta de {d.monto} XP</p>
                  {erroresResolverApuesta[d.id] && (
                    <div className="form-error">{erroresResolverApuesta[d.id]}</div>
                  )}
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolviendoApuesta === d.id}
                    onClick={() => handleResolverDisputaApuesta(d.id, d.challengerTeamId)}
                  >
                    Ganó {d.challengerNombre}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolviendoApuesta === d.id}
                    onClick={() => handleResolverDisputaApuesta(d.id, d.challengedTeamId)}
                  >
                    Ganó {d.challengedNombre}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
