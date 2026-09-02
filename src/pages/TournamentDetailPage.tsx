import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import {
  esFormatoPorEquipo,
  getMinimoMiembrosEquipo,
  getModoDescripcion,
  getModoLabel,
} from "../lib/tournamentOptions";
import { formatFecha, formatPozo } from "../lib/formatters";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import BracketView from "../components/BracketView";
import Avatar from "../components/Avatar";
import LigaBadge from "../components/LigaBadge";
import type { TournamentRow } from "../types/tournaments";
import type { BracketMatchRow } from "../types/bracket";

interface MapaSeleccionado {
  nombre: string;
  esVeteable: boolean;
}

// Representa un participante de la llave sea cual sea el formato del
// torneo: en 1v1 es un jugador (userId, nombre y avatar de su perfil);
// en 2v2/3v3/4v4 es un equipo completo (teamId, nombre y logo del
// equipo). Nunca los dos a la vez -- unificarlos en una sola forma acá
// es lo que permite que el resto de la página (lista de participantes,
// BracketView, el campeón) no tenga que preguntarse todo el tiempo
// "¿esto es un jugador o un equipo?".
interface ParticipanteConNombre {
  id: string;
  userId: string | null;
  teamId: string | null;
  nombre: string | null;
  avatarUrl: string | null;
  // MMR y liga (migración 020): en 1v1 son los del jugador (mmr_1v1);
  // en un torneo por equipo son los del equipo (teams.mmr) -- nunca
  // hay nivel acá para un equipo, ese cálculo todavía no existe (ver
  // calcular_nivel(), solo definido para 1v1 por ahora).
  mmr: number | null;
  liga: string | null;
  nivel: number | null;
  bancaRota: boolean;
  // Solo tiene sentido para jugador individual -- un equipo no se
  // "suspende", así que siempre queda en false para esas filas.
  suspendido: boolean;
  // Check-in antes de generar la llave (migración 010).
  checkedIn: boolean;
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
  const { user, profile } = useAuth();

  const [torneo, setTorneo] = useState<TournamentRow | null>(null);
  const [mapas, setMapas] = useState<MapaSeleccionado[]>([]);
  const [participantes, setParticipantes] = useState<ParticipanteConNombre[]>([]);
  const [partidas, setPartidas] = useState<BracketMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [inscribiendo, setInscribiendo] = useState(false);
  const [inscripcionError, setInscripcionError] = useState<string | null>(null);

  const [generandoLlave, setGenerandoLlave] = useState(false);
  const [errorLlave, setErrorLlave] = useState<string | null>(null);

  const [abriendoCheckIn, setAbriendoCheckIn] = useState(false);
  const [errorCheckIn, setErrorCheckIn] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);

  const [abandonando, setAbandonando] = useState(false);
  const [errorAbandonar, setErrorAbandonar] = useState<string | null>(null);

  // --- Mi equipo (solo relevante en torneos 2v2/3v3/4v4) ---
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);
  const [miEquipoMiembros, setMiEquipoMiembros] = useState(0);
  const [cargandoMiEquipo, setCargandoMiEquipo] = useState(true);

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
    const esPorEquipos = esFormatoPorEquipo(torneoData.formato);

    const { data: mapasData } = await supabase
      .from("tournament_maps")
      .select("es_veteable, maps(nombre)")
      .eq("tournament_id", id);

    setMapas(
      (mapasData ?? []).map((m) => ({
        nombre: extraerNombreDeMapa(m.maps),
        esVeteable: m.es_veteable,
      }))
    );

    const { data: participantesData } = await supabase
      .from("tournament_participants")
      .select("id, user_id, team_id, inscrito_en, checked_in")
      .eq("tournament_id", id)
      .order("inscrito_en", { ascending: true });

    let listaParticipantes: ParticipanteConNombre[] = [];

    if (esPorEquipos) {
      const teamIds = [
        ...new Set((participantesData ?? []).map((p) => p.team_id).filter((t): t is string => t !== null)),
      ];
      let nombrePorTeamId: Record<string, string> = {};
      let logoPorTeamId: Record<string, string | null> = {};
      let mmrPorTeamId: Record<string, number> = {};
      let ligaPorTeamId: Record<string, string> = {};
      let bancaRotaPorTeamId: Record<string, boolean> = {};

      if (teamIds.length > 0) {
        const { data: equiposData } = await supabase
          .from("teams")
          .select("id, name, logo_url, mmr, liga, banca_rota")
          .in("id", teamIds);

        nombrePorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.name]));
        logoPorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.logo_url]));
        mmrPorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.mmr]));
        ligaPorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.liga]));
        bancaRotaPorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, t.banca_rota]));
      }

      listaParticipantes = (participantesData ?? []).map((p) => ({
        id: p.id,
        userId: null,
        teamId: p.team_id,
        nombre: p.team_id ? nombrePorTeamId[p.team_id] ?? "Equipo de RemorApp" : null,
        avatarUrl: p.team_id ? logoPorTeamId[p.team_id] ?? null : null,
        mmr: p.team_id ? mmrPorTeamId[p.team_id] ?? null : null,
        liga: p.team_id ? ligaPorTeamId[p.team_id] ?? null : null,
        nivel: null,
        bancaRota: p.team_id ? bancaRotaPorTeamId[p.team_id] ?? false : false,
        suspendido: false,
        checkedIn: p.checked_in,
      }));
    } else {
      const userIds = (participantesData ?? []).map((p) => p.user_id).filter((u): u is string => u !== null);
      let nombresPorId: Record<string, string | null> = {};
      let suspendidoPorId: Record<string, boolean> = {};
      let avatarPorId: Record<string, string | null> = {};
      let mmrPorId: Record<string, number> = {};
      let ligaPorId: Record<string, string> = {};
      let nivelPorId: Record<string, number> = {};
      let bancaRotaPorId: Record<string, boolean> = {};

      // tournament_participants.user_id apunta a auth.users, no a
      // profiles, así que no hay join automático: se resuelven los
      // nombres en una segunda consulta aparte.
      if (userIds.length > 0) {
        const { data: perfilesData } = await supabase
          .from("profiles")
          .select("id, nombre, suspendido, avatar_url, mmr_1v1, liga_1v1, nivel_1v1, banca_rota")
          .in("id", userIds);

        nombresPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nombre]));
        suspendidoPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.suspendido]));
        avatarPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.avatar_url]));
        mmrPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.mmr_1v1]));
        ligaPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.liga_1v1]));
        nivelPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.nivel_1v1]));
        bancaRotaPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.banca_rota]));
      }

      listaParticipantes = (participantesData ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        teamId: null,
        nombre: p.user_id ? nombresPorId[p.user_id] ?? null : null,
        avatarUrl: p.user_id ? avatarPorId[p.user_id] ?? null : null,
        mmr: p.user_id ? mmrPorId[p.user_id] ?? null : null,
        liga: p.user_id ? ligaPorId[p.user_id] ?? null : null,
        nivel: p.user_id ? nivelPorId[p.user_id] ?? 0 : null,
        bancaRota: p.user_id ? bancaRotaPorId[p.user_id] ?? false : false,
        suspendido: p.user_id ? suspendidoPorId[p.user_id] ?? false : false,
        checkedIn: p.checked_in,
      }));
    }

    // Ojo: esta lista sigue incluyendo a los suspendidos -- hace falta
    // para que "ya estás inscrito" siga funcionando si la propia cuenta
    // logueada está suspendida. Lo que NO debe mostrar suspendidos es
    // el listado público de abajo (participantesVisibles).
    setParticipantes(listaParticipantes);

    // La llave existe para cualquier formato (1v1, 2v2, 3v3, 4v4)
    // siempre que el modo sea eliminación simple -- el motor de llave
    // (generar_llave/avanzar_ganador/reportar_resultado) es el mismo
    // para todos, ver migración 009. Recién se consulta si ya se
    // generó (estado distinto de "abierto").
    if (torneoData.modo === "eliminacion_simple" && torneoData.estado !== "abierto") {
      const { data: partidasData } = await supabase
        .from("bracket_matches")
        .select(
          "id, tournament_id, round, match_number, participant1_id, participant2_id, winner_id, reported_p1_winner, reported_p2_winner, status"
        )
        .eq("tournament_id", id);

      setPartidas((partidasData ?? []) as BracketMatchRow[]);
    } else {
      setPartidas([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    cargarTorneo();
  }, [cargarTorneo]);

  // Se carga aparte porque no depende del torneo recargándose cada vez
  // (inscribir gente, generar la llave, etc.) -- solo del usuario
  // logueado y de si este torneo es por equipos.
  useEffect(() => {
    if (!user || !torneo || !esFormatoPorEquipo(torneo.formato)) {
      setMiEquipo(null);
      setMiEquipoMiembros(0);
      setCargandoMiEquipo(false);
      return;
    }

    let cancelado = false;
    setCargandoMiEquipo(true);

    obtenerEquipoDelUsuario(user.id).then(async (equipo) => {
      if (cancelado) return;
      setMiEquipo(equipo);

      if (equipo) {
        const { count } = await supabase
          .from("team_members")
          .select("*", { count: "exact", head: true })
          .eq("team_id", equipo.team_id);
        if (!cancelado) setMiEquipoMiembros(count ?? 0);
      } else {
        setMiEquipoMiembros(0);
      }

      if (!cancelado) setCargandoMiEquipo(false);
    });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, torneo?.formato]);

  const esPorEquipos = torneo ? esFormatoPorEquipo(torneo.formato) : false;

  const yaInscrito = !torneo
    ? false
    : esPorEquipos
    ? !!miEquipo && participantes.some((p) => p.teamId === miEquipo.team_id)
    : !!user && participantes.some((p) => p.userId === user.id);

  const cuposDisponibles = torneo ? torneo.cupos_totales - torneo.cupos_ocupados : 0;
  // Las cuentas suspendidas no aparecen en el listado público de
  // participantes (pero sí cuentan para yaInscrito arriba). Los
  // equipos nunca están "suspendidos", así que siempre pasan este filtro.
  const participantesVisibles = participantes.filter((p) => !p.suspendido);

  const soyOwnerDeMiEquipo = miEquipo?.roles.includes("owner") ?? false;
  const minimoMiembros = torneo ? getMinimoMiembrosEquipo(torneo.formato) : 1;

  const handleInscribirse = async () => {
    if (!user || !torneo) return;

    // También bloqueado a nivel de RLS (tournament_participants_insert_propio,
    // ver migración 004) -- este chequeo acá es solo para mostrar el
    // aviso al toque, no la única barrera.
    if (profile?.suspendido) {
      setInscripcionError("Tu cuenta está suspendida.");
      return;
    }

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

  const handleInscribirEquipo = async () => {
    if (!torneo) return;

    setInscribiendo(true);
    setInscripcionError(null);

    // Toda la validación real (dueño del equipo, cantidad de
    // miembros, cupos, torneo abierto) vive en inscribir_equipo() en
    // la base -- lo de acá arriba (ocultar el botón si falta algo) es
    // solo para el aviso al toque, no la única barrera.
    const { error } = await supabase.rpc("inscribir_equipo", { p_tournament_id: torneo.id });

    if (error) {
      setInscripcionError(error.message);
      setInscribiendo(false);
      return;
    }

    await cargarTorneo();
    setInscribiendo(false);
  };

  const esOrganizador = !!user && !!torneo && user.id === torneo.creador_id;

  // El check-in tiene que abrirse antes de poder generar la llave --
  // ver el botón "Abrir check-in" más abajo. Con el check-in ya
  // abierto, el mismo organizador ve "Cerrar check-in y generar
  // llave" en vez de este botón.
  const puedeAbrirCheckIn =
    esOrganizador &&
    torneo?.modo === "eliminacion_simple" &&
    torneo?.estado === "abierto" &&
    !torneo?.check_in_abierto &&
    torneo.cupos_ocupados >= 2;

  const handleAbrirCheckIn = async () => {
    if (!torneo) return;

    setAbriendoCheckIn(true);
    setErrorCheckIn(null);

    // tournaments_update_organizador (RLS que ya existe) ya exige que
    // seas el creador del torneo -- no hace falta una función nueva
    // para un simple toggle de booleano.
    const { error } = await supabase
      .from("tournaments")
      .update({ check_in_abierto: true })
      .eq("id", torneo.id);

    setAbriendoCheckIn(false);

    if (error) {
      setErrorCheckIn(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleGenerarLlave = async () => {
    if (!torneo) return;

    setGenerandoLlave(true);
    setErrorLlave(null);

    // La lógica de emparejar al azar, asignar byes, filtrar por
    // checked_in = true y validar quién puede generarla vive en la
    // función generar_llave() de la base (migración 006, extendida en
    // la 009 para equipos y en la 010 para el check-in) -- no acá,
    // para que no se pueda fabricar una llave a mano mandando un
    // insert directo. La propia función cierra el check-in
    // (check_in_abierto = false) si todo sale bien; si falla (por
    // ejemplo, menos de 2 confirmados), no cambia nada del torneo.
    const { error } = await supabase.rpc("generar_llave", { p_tournament_id: torneo.id });

    setGenerandoLlave(false);

    if (error) {
      setErrorLlave(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleConfirmarAsistencia = async (participantId: string) => {
    setConfirmando(true);
    setErrorConfirmar(null);

    const { error } = await supabase.rpc("confirmar_asistencia", {
      p_participant_id: participantId,
    });

    setConfirmando(false);

    if (error) {
      setErrorConfirmar(error.message);
      return;
    }

    await cargarTorneo();
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

  // tournament_participants.id -> puede el usuario logueado reportar
  // por ese participante: en 1v1 es "soy yo", en equipo es "soy el
  // dueño de ese equipo" -- BracketView recibe esto ya resuelto, no le
  // importa cuál de los dos casos es.
  const puedeReportarPorParticipante = Object.fromEntries(
    participantes.map((p) => {
      if (!user) return [p.id, false];
      if (!esPorEquipos) return [p.id, p.userId === user.id];
      return [p.id, !!miEquipo && soyOwnerDeMiEquipo && p.teamId === miEquipo.team_id];
    })
  );

  // Mi propia fila en tournament_participants -- para el check-in: en
  // 1v1 es la fila con mi user_id, en equipo es la fila del equipo que
  // soy dueño. Reusa exactamente el mismo criterio que
  // puedeReportarPorParticipante (el check-in lo confirma quien puede
  // reportar por ese participante, ni más ni menos).
  const miParticipante = participantes.find((p) => puedeReportarPorParticipante[p.id]);
  const confirmados = participantesVisibles.filter((p) => p.checkedIn).length;

  // Tiene una partida pendiente (todavía no jugada) en la llave --
  // "abandonar" en un torneo en_curso solo tiene sentido si esto es
  // true: si ya perdió, o el torneo terminó, no hay nada que abandonar.
  const tengoPartidaPendiente =
    !!miParticipante &&
    partidas.some(
      (m) =>
        (m.participant1_id === miParticipante.id || m.participant2_id === miParticipante.id) &&
        m.status === "pendiente"
    );

  const puedoAbandonar =
    !!miParticipante &&
    (torneo.estado === "abierto" || (torneo.estado === "en_curso" && tengoPartidaPendiente));

  const handleAbandonarTorneo = async () => {
    if (!miParticipante) return;

    const mensaje =
      torneo.estado === "abierto"
        ? "¿Seguro que quieres abandonar este torneo? Se cancelará tu inscripción."
        : "¿Seguro que quieres abandonar este torneo? Tu rival avanzará automáticamente a la siguiente ronda.";
    if (!window.confirm(mensaje)) return;

    setAbandonando(true);
    setErrorAbandonar(null);

    // Toda la validación real (según el estado del torneo, si tienes
    // permiso, si tienes una partida pendiente) vive en
    // abandonar_torneo() en la base -- lo de acá arriba (ocultar el
    // botón si no corresponde) es solo para el aviso al toque.
    const { error } = await supabase.rpc("abandonar_torneo", {
      p_participant_id: miParticipante.id,
    });

    setAbandonando(false);

    if (error) {
      setErrorAbandonar(error.message);
      return;
    }

    await cargarTorneo();
  };

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

      <h2 className="detail-subtitle">
        {esPorEquipos ? "Equipos inscritos" : "Participantes"} ({participantesVisibles.length})
      </h2>
      {participantesVisibles.length === 0 ? (
        <p className="detail-empty">
          {esPorEquipos ? "Todavía no hay equipos inscritos." : "Todavía no hay nadie inscrito."}
        </p>
      ) : (
        <div className="detail-participant-list">
          {participantesVisibles.map((p) => (
            <div key={p.id} className="detail-participant-item">
              <Avatar url={p.avatarUrl} nombre={p.nombre} className="detail-participant-avatar" />
              {p.nombre ?? "Jugador de RemorApp"}
              {p.liga !== null && p.mmr !== null && (
                <LigaBadge
                  liga={p.liga}
                  mmr={p.mmr}
                  nivel={p.nivel ?? undefined}
                  bancaRota={p.bancaRota}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {torneo.modo === "eliminacion_simple" && (
        <>
          {puedeAbrirCheckIn && (
            <div className="detail-register-box">
              {errorCheckIn && <div className="form-error">{errorCheckIn}</div>}
              <p className="tournament-card-meta">
                Antes de armar la llave, pedile a los inscritos que confirmen que van a jugar --
                así se evitan byes injustos por gente que no aparece.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={abriendoCheckIn}
                onClick={handleAbrirCheckIn}
              >
                {abriendoCheckIn ? "Abriendo..." : "Abrir check-in"}
              </button>
            </div>
          )}

          {torneo.estado === "abierto" && torneo.check_in_abierto && (
            <div className="detail-register-box">
              {errorLlave && <div className="form-error">{errorLlave}</div>}
              {errorConfirmar && <div className="form-error">{errorConfirmar}</div>}

              <p className="tournament-card-meta">
                {confirmados} de {participantesVisibles.length} confirmados
              </p>

              {miParticipante && !miParticipante.checkedIn && (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  disabled={confirmando}
                  onClick={() => handleConfirmarAsistencia(miParticipante.id)}
                >
                  {confirmando ? "Confirmando..." : "Confirmar que voy a jugar"}
                </button>
              )}

              {miParticipante && miParticipante.checkedIn && (
                <p className="form-success">Ya confirmaste tu asistencia.</p>
              )}

              {esOrganizador && (
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={generandoLlave}
                  onClick={handleGenerarLlave}
                >
                  {generandoLlave ? "Generando..." : "Cerrar check-in y generar llave"}
                </button>
              )}
            </div>
          )}

          {torneo.estado !== "abierto" && (
            <>
              <h2 className="detail-subtitle">Llave</h2>
              {torneo.estado === "finalizado" && torneo.campeon_participant_id && (
                <p className="form-success">
                  🏆 Campeón:{" "}
                  {participantes.find((p) => p.id === torneo.campeon_participant_id)?.nombre ??
                    "Jugador de RemorApp"}
                </p>
              )}
              {partidas.length === 0 ? (
                <p className="detail-empty">Cargando la llave...</p>
              ) : (
                <BracketView
                  matches={partidas}
                  nombresPorParticipante={Object.fromEntries(
                    participantes.map((p) => [p.id, p.nombre ?? "Jugador de RemorApp"])
                  )}
                  logosPorParticipante={
                    esPorEquipos
                      ? Object.fromEntries(participantes.map((p) => [p.id, p.avatarUrl]))
                      : undefined
                  }
                  puedeReportarPorParticipante={puedeReportarPorParticipante}
                  userId={user?.id ?? null}
                  organizadorId={torneo.creador_id}
                  onCambio={cargarTorneo}
                />
              )}
            </>
          )}
        </>
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

        {/* --- Inscripción individual (1v1) --- */}
        {user && !esPorEquipos && (
          <>
            {yaInscrito && <p className="form-success">Ya estás inscrito en este torneo.</p>}

            {!yaInscrito && profile?.suspendido && (
              <p className="form-error">Tu cuenta está suspendida.</p>
            )}

            {!yaInscrito && !profile?.suspendido && torneo.estado !== "abierto" && (
              <p className="tournament-card-meta">Las inscripciones están cerradas.</p>
            )}

            {!yaInscrito && !profile?.suspendido && torneo.estado === "abierto" && cuposDisponibles <= 0 && (
              <p className="tournament-card-meta">Sin cupos disponibles.</p>
            )}

            {!yaInscrito && !profile?.suspendido && torneo.estado === "abierto" && cuposDisponibles > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={inscribiendo}
                onClick={handleInscribirse}
              >
                {inscribiendo ? "Inscribiendo..." : "Inscribirme"}
              </button>
            )}
          </>
        )}

        {/* --- Inscripción por equipo (2v2/3v3/4v4) --- */}
        {user && esPorEquipos && (
          <>
            {cargandoMiEquipo && <p className="tournament-card-meta">Cargando tu equipo...</p>}

            {!cargandoMiEquipo && yaInscrito && (
              <p className="form-success">Tu equipo ya está inscrito en este torneo.</p>
            )}

            {!cargandoMiEquipo && !yaInscrito && profile?.suspendido && (
              <p className="form-error">Tu cuenta está suspendida.</p>
            )}

            {!cargandoMiEquipo && !yaInscrito && !profile?.suspendido && !miEquipo && (
              <p className="tournament-card-meta">
                Necesitas un equipo para inscribirte a este torneo.{" "}
                <Link to="/equipos/crear" className="btn-link">
                  Crear equipo
                </Link>
              </p>
            )}

            {!cargandoMiEquipo && !yaInscrito && !profile?.suspendido && miEquipo && !soyOwnerDeMiEquipo && (
              <p className="tournament-card-meta">
                Solo el dueño de tu equipo ({miEquipo.teamTag}) puede inscribirlo a este torneo.
              </p>
            )}

            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros < minimoMiembros && (
                <p className="tournament-card-meta">
                  Tu equipo necesita al menos {minimoMiembros} miembros para un torneo{" "}
                  {torneo.formato} (tiene {miEquipoMiembros}).
                </p>
              )}

            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros >= minimoMiembros &&
              torneo.estado !== "abierto" && (
                <p className="tournament-card-meta">Las inscripciones están cerradas.</p>
              )}

            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros >= minimoMiembros &&
              torneo.estado === "abierto" &&
              cuposDisponibles <= 0 && <p className="tournament-card-meta">Sin cupos disponibles.</p>}

            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros >= minimoMiembros &&
              torneo.estado === "abierto" &&
              cuposDisponibles > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={inscribiendo}
                  onClick={handleInscribirEquipo}
                >
                  {inscribiendo ? "Inscribiendo..." : `Inscribir a ${miEquipo.teamTag}`}
                </button>
              )}
          </>
        )}
      </div>

      {puedoAbandonar && (
        <div className="detail-register-box">
          {errorAbandonar && <div className="form-error">{errorAbandonar}</div>}
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={abandonando}
            onClick={handleAbandonarTorneo}
          >
            {abandonando ? "Abandonando..." : "Abandonar torneo"}
          </button>
        </div>
      )}
    </section>
  );
}
