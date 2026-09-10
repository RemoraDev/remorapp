import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
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
import BracketStylePicker from "../components/BracketStylePicker";
import GroupStage from "../components/GroupStage";
import Avatar from "../components/Avatar";
import LigaBadge from "../components/LigaBadge";
import type { PosicionGrupo, TournamentGroupMatchRow, TournamentGroupRow, TournamentRow } from "../types/tournaments";
import type { AvatarForma } from "../types/profile";
import type { BracketMatchRow } from "../types/bracket";
import type { TemporadaRow, TorneoSolicitudEquipoRow } from "../types/teams";

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
  // Solo se completa para participantes jugador (1v1) -- un equipo
  // muestra su logo, que no está sujeto a esta preferencia personal.
  avatarForma: AvatarForma | undefined;
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
  // Migración 069: solo tiene sentido en un torneo modo "tabla_posiciones".
  puntosLeaderboard: number;
}

// Convierte una fecha ISO (como llega de la base) al formato que
// entiende el atributo value/min de un <input type="datetime-local">
// ("YYYY-MM-DDTHH:mm", en hora local) -- para poder usar la fecha de
// inicio del torneo como piso del selector de fecha de fin.
function fechaInicioComoInputLocal(fechaIso: string): string {
  const d = new Date(fechaIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Íconos de las tarjetas del panel de organizador -- mismo estilo
// lineal (viewBox 24x24, stroke currentColor) que ModoIcono.tsx, para
// que la ficha del torneo se sienta parte de la misma app.
const iconoComun = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function IconoEngranaje() {
  return (
    <svg {...iconoComun} width={18} height={18}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.5a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.5a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.04H19.5a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04" />
    </svg>
  );
}

function IconoFormato() {
  return (
    <svg {...iconoComun}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="8.5" y="13.5" width="7" height="7" rx="1.3" />
      <path d="M7 10.5v3M17 10.5v3M7 13.5h5M17 13.5h-5" />
    </svg>
  );
}

function IconoCuadro() {
  return (
    <svg {...iconoComun}>
      <path d="M4 5h5M4 10h5M9 5v5M9 7.5h5" />
      <path d="M4 15h5M4 20h5M9 15v5M9 17.5h5" />
      <path d="M14 7.5v10" strokeDasharray="1.5 2.5" />
    </svg>
  );
}

function IconoPermisos() {
  return (
    <svg {...iconoComun}>
      <path d="M12 3.5 5 6v5.5c0 4.4 2.9 7.6 7 9 4.1-1.4 7-4.6 7-9V6z" />
      <path d="M9.3 12l1.9 1.9 3.6-3.8" />
    </svg>
  );
}

function IconoVisualizacion() {
  return (
    <svg {...iconoComun}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function IconoChevron() {
  return (
    <svg {...iconoComun} width={16} height={16}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Fila de una sola opción on/off del panel de organizador -- reemplaza
// el <label><input type="checkbox">...</label> plano por un switch
// interactivo, sin cambiar en nada la lógica de guardado (sigue siendo
// handleActualizarOpcionAvanzada por debajo).
function OpcionToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="organizer-toggle-row">
      <span className="organizer-toggle-text">
        <span className="organizer-toggle-label">{label}</span>
        {hint && <span className="organizer-toggle-hint">{hint}</span>}
      </span>
      <span className="organizer-toggle-switch">
        <input
          type="checkbox"
          className="organizer-toggle-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="organizer-toggle-track">
          <span className="organizer-toggle-thumb" />
        </span>
      </span>
    </label>
  );
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();

  const [torneo, setTorneo] = useState<TournamentRow | null>(null);
  const [participantes, setParticipantes] = useState<ParticipanteConNombre[]>([]);
  const [partidas, setPartidas] = useState<BracketMatchRow[]>([]);
  // Migración 041: etapa de grupos, previa a la llave -- solo se
  // llenan mientras torneo.fase_actual === "grupos".
  const [grupos, setGrupos] = useState<TournamentGroupRow[]>([]);
  const [partidasGrupo, setPartidasGrupo] = useState<TournamentGroupMatchRow[]>([]);
  const [posiciones, setPosiciones] = useState<PosicionGrupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Overlay para OBS (migración 044): visible para cualquiera, no
  // solo el organizador -- cualquiera puede querer transmitir el
  // torneo, no necesariamente quien lo creó.
  const [urlObsCopiada, setUrlObsCopiada] = useState(false);

  const [inscribiendo, setInscribiendo] = useState(false);
  const [inscripcionError, setInscripcionError] = useState<string | null>(null);

  const [generandoLlave, setGenerandoLlave] = useState(false);
  const [errorLlave, setErrorLlave] = useState<string | null>(null);

  // Suizo (migración 069).
  const [iniciandoSuizo, setIniciandoSuizo] = useState(false);
  const [errorSuizo, setErrorSuizo] = useState<string | null>(null);
  const [generandoRondaSuiza, setGenerandoRondaSuiza] = useState(false);

  // Todos contra todos (migración 077) -- a diferencia de Suizo, sí
  // usa check-in (puedeAbrirCheckIn, más abajo) antes de armar el
  // fixture completo de una sola vez.
  const [iniciandoTodosContraTodos, setIniciandoTodosContraTodos] = useState(false);
  const [errorTodosContraTodos, setErrorTodosContraTodos] = useState<string | null>(null);
  const [finalizandoTodosContraTodos, setFinalizandoTodosContraTodos] = useState(false);

  // Tabla de posiciones / Leaderboard (migración 069).
  const [puntosEditados, setPuntosEditados] = useState<Record<string, string>>({});
  const [guardandoPuntosId, setGuardandoPuntosId] = useState<string | null>(null);
  const [errorLeaderboard, setErrorLeaderboard] = useState<string | null>(null);
  const [campeonElegido, setCampeonElegido] = useState("");
  const [finalizandoLeaderboard, setFinalizandoLeaderboard] = useState(false);
  const [generandoGrupos, setGenerandoGrupos] = useState(false);
  const [errorGrupos, setErrorGrupos] = useState<string | null>(null);
  // Migración 057: fixture de First Stand (todos contra todos en 7
  // jornadas), separado de "generar grupos" -- generar_grupos() no
  // sirve acá, exige cantidad_grupos >= 2.
  const [generandoFixture, setGenerandoFixture] = useState(false);
  const [errorFixture, setErrorFixture] = useState<string | null>(null);

  // Invitación rápida de varios clanes a la vez (migración 057),
  // solo para el organizador de un torneo por equipos abierto.
  const [invitarAbierto, setInvitarAbierto] = useState(false);
  const [equiposPublicos, setEquiposPublicos] = useState<{ id: string; name: string; tag: string }[]>([]);
  const [cargandoEquiposPublicos, setCargandoEquiposPublicos] = useState(false);
  const [equiposSeleccionados, setEquiposSeleccionados] = useState<Record<string, boolean>>({});
  const [invitandoEquipos, setInvitandoEquipos] = useState(false);
  const [errorInvitarEquipos, setErrorInvitarEquipos] = useState<string | null>(null);

  // Invitar equipos amigos al evento (migración 073): a diferencia del
  // bloque de arriba (inscripción directa, sin pedirle nada al
  // equipo), esto manda una invitación real que el equipo amigo tiene
  // que aceptar desde su Panel de control -- y solo se le puede
  // ofrecer al organizador si su propio equipo tiene amigos.
  const [amigosAbierto, setAmigosAbierto] = useState(false);
  const [equiposAmigosDisponibles, setEquiposAmigosDisponibles] = useState<{ id: string; name: string; tag: string }[]>([]);
  const [cargandoEquiposAmigos, setCargandoEquiposAmigos] = useState(false);
  const [equiposAmigosSeleccionados, setEquiposAmigosSeleccionados] = useState<Record<string, boolean>>({});
  const [invitandoAmigos, setInvitandoAmigos] = useState(false);
  const [errorInvitarAmigos, setErrorInvitarAmigos] = useState<string | null>(null);
  const [amigosInvitados, setAmigosInvitados] = useState(false);

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

  // Solicitud de ingreso a torneo de liga (migración 079): tercera vía
  // de entrada, junto a la inscripción libre (que queda deshabilitada
  // para torneos de liga) y la invitación del organizador.
  const [miSolicitud, setMiSolicitud] = useState<TorneoSolicitudEquipoRow | null>(null);
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [errorSolicitud, setErrorSolicitud] = useState<string | null>(null);
  const [solicitudesRecibidas, setSolicitudesRecibidas] = useState<
    { id: string; equipoNombre: string; status: string }[]
  >([]);
  const [respondiendoSolicitudId, setRespondiendoSolicitudId] = useState<string | null>(null);
  const [erroresResponderSolicitud, setErroresResponderSolicitud] = useState<Record<string, string>>({});

  // --- Temporadas (migración 047): solo el organizador las administra ---
  const [temporadas, setTemporadas] = useState<TemporadaRow[]>([]);
  const [nombreTemporada, setNombreTemporada] = useState("");
  const [fechaFinTemporada, setFechaFinTemporada] = useState("");
  const [creandoTemporada, setCreandoTemporada] = useState(false);
  const [errorTemporada, setErrorTemporada] = useState<string | null>(null);

  // Opciones avanzadas (migración 079): antes se elegían al crear el
  // torneo, ahora se ajustan en cualquier momento después, desde acá
  // -- exclusivo del organizador. tournaments_update_organizador (RLS
  // que ya existe) alcanza para un update directo, sin RPC nueva.
  const [mostrarOpcionesAvanzadas, setMostrarOpcionesAvanzadas] = useState(false);
  const [errorOpcionesAvanzadas, setErrorOpcionesAvanzadas] = useState<string | null>(null);
  const [guardandoInscripciones, setGuardandoInscripciones] = useState<string | null>(null);
  const [temporadaRangosAbierta, setTemporadaRangosAbierta] = useState<string | null>(null);
  const [rangosMmrForm, setRangosMmrForm] = useState<Record<string, string>>({});
  const [guardandoRangos, setGuardandoRangos] = useState<string | null>(null);
  const [errorRangos, setErrorRangos] = useState<string | null>(null);

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

    const { data: participantesData } = await supabase
      .from("tournament_participants")
      .select("id, user_id, team_id, inscrito_en, checked_in, puntos_leaderboard")
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
        avatarForma: undefined,
        mmr: p.team_id ? mmrPorTeamId[p.team_id] ?? null : null,
        liga: p.team_id ? ligaPorTeamId[p.team_id] ?? null : null,
        nivel: null,
        bancaRota: p.team_id ? bancaRotaPorTeamId[p.team_id] ?? false : false,
        suspendido: false,
        checkedIn: p.checked_in,
        puntosLeaderboard: p.puntos_leaderboard,
      }));
    } else {
      const userIds = (participantesData ?? []).map((p) => p.user_id).filter((u): u is string => u !== null);
      let nombresPorId: Record<string, string | null> = {};
      let suspendidoPorId: Record<string, boolean> = {};
      let avatarPorId: Record<string, string | null> = {};
      let avatarFormaPorId: Record<string, AvatarForma> = {};
      let mmrPorId: Record<string, number> = {};
      let ligaPorId: Record<string, string> = {};
      let nivelPorId: Record<string, number> = {};
      let bancaRotaPorId: Record<string, boolean> = {};

      // tournament_participants.user_id apunta a auth.users, no a
      // profiles, así que no hay join automático: se resuelven los
      // nombres en una segunda consulta aparte. Corrección: acá se
      // pedía profiles.nombre (el nombre real, cuando existe) en vez
      // de nick#unique_id -- la convención de identidad pública que
      // usa el resto de la app (Sala de la Fama, Panel de
      // Administración, listas de miembros, etc.) en todos lados
      // menos acá. Además de la inconsistencia visual, exponía el
      // nombre real de la cuenta en un lugar público (la llave).
      if (userIds.length > 0) {
        const { data: perfilesData } = await supabase
          .from("profiles")
          .select("id, nick, unique_id, suspendido, avatar_url, avatar_forma, mmr_1v1, liga_1v1, nivel_1v1, banca_rota")
          .in("id", userIds);

        nombresPorId = Object.fromEntries(
          (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : null])
        );
        suspendidoPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.suspendido]));
        avatarPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.avatar_url]));
        avatarFormaPorId = Object.fromEntries((perfilesData ?? []).map((p) => [p.id, p.avatar_forma]));
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
        avatarForma: p.user_id ? avatarFormaPorId[p.user_id] : undefined,
        mmr: p.user_id ? mmrPorId[p.user_id] ?? null : null,
        liga: p.user_id ? ligaPorId[p.user_id] ?? null : null,
        nivel: p.user_id ? nivelPorId[p.user_id] ?? 0 : null,
        bancaRota: p.user_id ? bancaRotaPorId[p.user_id] ?? false : false,
        suspendido: p.user_id ? suspendidoPorId[p.user_id] ?? false : false,
        checkedIn: p.checked_in,
        puntosLeaderboard: p.puntos_leaderboard,
      }));
    }

    // Ojo: esta lista sigue incluyendo a los suspendidos -- hace falta
    // para que "ya estás inscrito" siga funcionando si la propia cuenta
    // logueada está suspendida. Lo que NO debe mostrar suspendidos es
    // el listado público de abajo (participantesVisibles).
    setParticipantes(listaParticipantes);

    // La llave existe para cualquier formato (1v1, 2v2, 3v3, 4v4)
    // siempre que el modo sea eliminación simple o doble -- el motor
    // de llave (generar_llave/avanzar_ganador/reportar_resultado, y
    // generar_llave_doble/avanzar_ganador_doble para el modo doble,
    // migración 084) es el mismo bracket_matches para los dos. Recién
    // se consulta si ya se generó (estado distinto de "abierto").
    if (
      (torneoData.modo === "eliminacion_simple" || torneoData.modo === "eliminacion_doble") &&
      torneoData.estado !== "abierto" &&
      torneoData.fase_actual === "eliminacion"
    ) {
      const { data: partidasData } = await supabase
        .from("bracket_matches")
        .select(
          "id, tournament_id, round, match_number, participant1_id, participant2_id, winner_id, reported_p1_winner, reported_p2_winner, status, es_tercer_lugar, formato_partido, bracket_tipo"
        )
        .eq("tournament_id", id);

      setPartidas((partidasData ?? []) as BracketMatchRow[]);
    } else {
      setPartidas([]);
    }

    // Migración 041: mientras la etapa de grupos está en curso, se
    // trae grupos + sus partidos + la tabla de posiciones -- la llave
    // todavía no existe (fase_actual sigue en "grupos"). Migración 069:
    // un torneo Suizo reutiliza exactamente este mismo trío de tablas
    // (un solo grupo, "Suizo"), así que se trae con el mismo criterio.
    // Migración 077: Todos contra todos hace exactamente lo mismo (un
    // solo grupo, "Todos contra todos", sin fase de eliminación
    // después).
    if (
      (torneoData.modo === "eliminacion_simple" && torneoData.fase_actual === "grupos") ||
      torneoData.modo === "suizo" ||
      torneoData.modo === "todos_contra_todos"
    ) {
      const { data: gruposData } = await supabase
        .from("tournament_groups")
        .select("id, tournament_id, nombre, created_at")
        .eq("tournament_id", id)
        .order("nombre");

      const idsGrupos = (gruposData ?? []).map((g) => g.id);

      const { data: partidasGrupoData } = await supabase
        .from("tournament_group_matches")
        .select(
          "id, group_id, participant1_id, participant2_id, ganador_id, status, jornada, resultado_participant1, resultado_participant2, clan_war_id"
        )
        .in("group_id", idsGrupos.length > 0 ? idsGrupos : ["00000000-0000-0000-0000-000000000000"]);

      const { data: posicionesData } = await supabase.rpc("posiciones_grupos", { p_tournament_id: id });

      setGrupos((gruposData ?? []) as TournamentGroupRow[]);
      setPartidasGrupo((partidasGrupoData ?? []) as TournamentGroupMatchRow[]);
      setPosiciones((posicionesData ?? []) as PosicionGrupo[]);
    } else {
      setGrupos([]);
      setPartidasGrupo([]);
      setPosiciones([]);
    }

    // Temporadas (migración 047): públicas, pero solo el organizador
    // las administra -- se traen siempre, así cualquiera puede ver
    // qué temporada eligió un equipo aliado/mercenario más adelante.
    const { data: temporadasData } = await supabase
      .from("temporadas")
      .select("*")
      .eq("torneo_id", id)
      .order("fecha_inicio", { ascending: false });
    setTemporadas((temporadasData ?? []) as TemporadaRow[]);

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

  // Solicitud de ingreso (migración 079): la propia -- si mi equipo ya
  // pidió entrar a este torneo de liga, en cualquier estado (pendiente,
  // aceptada o rechazada).
  useEffect(() => {
    if (!torneo?.liga_id || !miEquipo) {
      setMiSolicitud(null);
      return;
    }
    let cancelado = false;
    supabase
      .from("torneo_solicitudes_equipo")
      .select("id, tournament_id, equipo_id, solicitado_por, status, created_at, respondida_en")
      .eq("tournament_id", torneo.id)
      .eq("equipo_id", miEquipo.team_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) setMiSolicitud((data as TorneoSolicitudEquipoRow | null) ?? null);
      });
    return () => {
      cancelado = true;
    };
  }, [torneo?.id, torneo?.liga_id, miEquipo]);

  // Solicitudes de ingreso recibidas (migración 079): solo para el
  // organizador de un torneo de liga -- las pendientes, para
  // aceptar/rechazar.
  useEffect(() => {
    if (!torneo?.liga_id || !user || user.id !== torneo.creador_id) {
      setSolicitudesRecibidas([]);
      return;
    }
    let cancelado = false;
    supabase
      .from("torneo_solicitudes_equipo")
      .select("id, equipo_id, status")
      .eq("tournament_id", torneo.id)
      .eq("status", "pendiente")
      .then(async ({ data }) => {
        if (cancelado || !data || data.length === 0) {
          if (!cancelado) setSolicitudesRecibidas([]);
          return;
        }
        const { data: equiposData } = await supabase
          .from("teams")
          .select("id, name, tag")
          .in(
            "id",
            data.map((s) => s.equipo_id)
          );
        const nombrePorEquipoId = Object.fromEntries(
          (equiposData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`])
        );
        if (!cancelado) {
          setSolicitudesRecibidas(
            data.map((s) => ({ id: s.id, equipoNombre: nombrePorEquipoId[s.equipo_id] ?? "Equipo", status: s.status }))
          );
        }
      });
    return () => {
      cancelado = true;
    };
  }, [torneo?.id, torneo?.liga_id, torneo?.creador_id, user]);

  const handleSolicitarIngreso = async () => {
    if (!torneo || !miEquipo) return;
    setEnviandoSolicitud(true);
    setErrorSolicitud(null);

    const { error } = await supabase.rpc("solicitar_ingreso_torneo", {
      p_tournament_id: torneo.id,
      p_equipo_id: miEquipo.team_id,
    });

    setEnviandoSolicitud(false);

    if (error) {
      setErrorSolicitud(error.message);
      return;
    }

    const { data } = await supabase
      .from("torneo_solicitudes_equipo")
      .select("id, tournament_id, equipo_id, solicitado_por, status, created_at, respondida_en")
      .eq("tournament_id", torneo.id)
      .eq("equipo_id", miEquipo.team_id)
      .maybeSingle();
    setMiSolicitud((data as TorneoSolicitudEquipoRow | null) ?? null);
  };

  const handleResponderSolicitud = async (solicitudId: string, aceptar: boolean) => {
    setRespondiendoSolicitudId(solicitudId);
    setErroresResponderSolicitud((prev) => ({ ...prev, [solicitudId]: "" }));

    const { error } = await supabase.rpc("responder_solicitud_torneo", {
      p_solicitud_id: solicitudId,
      p_aceptar: aceptar,
    });

    setRespondiendoSolicitudId(null);

    if (error) {
      setErroresResponderSolicitud((prev) => ({ ...prev, [solicitudId]: error.message }));
      return;
    }

    setSolicitudesRecibidas((prev) => prev.filter((s) => s.id !== solicitudId));
    await cargarTorneo();
  };

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
    (torneo?.modo === "eliminacion_simple" ||
      torneo?.modo === "eliminacion_doble" ||
      torneo?.modo === "todos_contra_todos") &&
    torneo?.estado === "abierto" &&
    !torneo?.check_in_abierto &&
    torneo.cupos_ocupados >= 2;

  const handleActualizarOpcionAvanzada = async (
    campo:
      | "mostrar_nombres_ronda_personalizados"
      | "ocultar_numeros_semilla"
      | "ocultar_bracket_publico"
      | "reglas_semillas"
      | "permite_autoreporte"
      | "excluido_de_busqueda"
      | "mostrar_posiciones"
      | "tiene_fase_grupos"
      | "cantidad_grupos"
      | "avanzan_por_grupo"
      | "tiene_tercer_lugar",
    valor: boolean | string | number | null
  ) => {
    if (!torneo) return;
    setErrorOpcionesAvanzadas(null);

    const { error } = await supabase
      .from("tournaments")
      .update({ [campo]: valor })
      .eq("id", torneo.id);

    if (error) {
      setErrorOpcionesAvanzadas(error.message);
      return false;
    }

    await cargarTorneo();
    return true;
  };

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

  // --- Temporadas (migración 047) ---
  const handleCrearTemporada = async (event: FormEvent) => {
    event.preventDefault();
    if (!torneo) return;
    setErrorTemporada(null);

    if (!nombreTemporada.trim()) {
      setErrorTemporada("Escribe un nombre para la temporada.");
      return;
    }
    if (!fechaFinTemporada) {
      setErrorTemporada("Elige la fecha de fin de la temporada.");
      return;
    }
    if (new Date(fechaFinTemporada) <= new Date(torneo.fecha_inicio)) {
      setErrorTemporada("La fecha de fin debe ser posterior a la fecha de inicio del torneo.");
      return;
    }

    setCreandoTemporada(true);

    // temporadas_insert_organizador (RLS) ya exige ser el creador del
    // torneo o un administrador -- no hace falta una función aparte
    // para un insert directo, mismo criterio que el resto de ajustes
    // sueltos del organizador en esta página (abrir check-in, etc.).
    // La fecha de inicio de la temporada es la misma del torneo -- no
    // tiene sentido pedirla de nuevo por separado.
    const { error } = await supabase.from("temporadas").insert({
      torneo_id: torneo.id,
      nombre: nombreTemporada.trim(),
      fecha_inicio: torneo.fecha_inicio,
      fecha_fin: new Date(fechaFinTemporada).toISOString(),
    });

    setCreandoTemporada(false);

    if (error) {
      setErrorTemporada(error.message);
      return;
    }

    setNombreTemporada("");
    setFechaFinTemporada("");
    await cargarTorneo();
  };

  const handleToggleInscripciones = async (temporadaId: string, abrir: boolean) => {
    setGuardandoInscripciones(temporadaId);

    const { error } = await supabase
      .from("temporadas")
      .update({ inscripciones_abiertas: abrir })
      .eq("id", temporadaId);

    setGuardandoInscripciones(null);

    if (!error) await cargarTorneo();
  };

  const handleAbrirRangos = (temporada: TemporadaRow) => {
    if (temporadaRangosAbierta === temporada.id) {
      setTemporadaRangosAbierta(null);
      return;
    }
    setTemporadaRangosAbierta(temporada.id);
    setErrorRangos(null);

    const valores: Record<string, string> = {};
    for (const posicion of [1, 2, 3] as const) {
      const rango = temporada.rangos_mmr_por_posicion?.find((r) => r.posicion === posicion);
      valores[`${temporada.id}-${posicion}-min`] = rango ? String(rango.mmr_min) : "";
      valores[`${temporada.id}-${posicion}-max`] = rango ? String(rango.mmr_max) : "";
    }
    setRangosMmrForm((prev) => ({ ...prev, ...valores }));
  };

  const handleGuardarRangos = async (temporadaId: string) => {
    setErrorRangos(null);

    const rangos: { posicion: 1 | 2 | 3; mmr_min: number; mmr_max: number }[] = [];
    for (const posicion of [1, 2, 3] as const) {
      const min = rangosMmrForm[`${temporadaId}-${posicion}-min`]?.trim();
      const max = rangosMmrForm[`${temporadaId}-${posicion}-max`]?.trim();
      // Una posición se guarda solo si tiene los dos valores -- dejar
      // ambos vacíos significa "sin restricción para esa posición".
      if (!min && !max) continue;
      if (!min || !max || Number(min) > Number(max)) {
        setErrorRangos(`La posición ${posicion} necesita un mínimo y un máximo válidos (mínimo ≤ máximo).`);
        return;
      }
      rangos.push({ posicion, mmr_min: Number(min), mmr_max: Number(max) });
    }

    setGuardandoRangos(temporadaId);

    // temporadas_update_organizador (RLS) ya exige ser el creador del
    // torneo o un administrador.
    const { error } = await supabase
      .from("temporadas")
      .update({ rangos_mmr_por_posicion: rangos.length > 0 ? rangos : null })
      .eq("id", temporadaId);

    setGuardandoRangos(null);

    if (error) {
      setErrorRangos(error.message);
      return;
    }

    setTemporadaRangosAbierta(null);
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
    const { error } = await supabase.rpc(
      torneo.modo === "eliminacion_doble" ? "generar_llave_doble" : "generar_llave",
      { p_tournament_id: torneo.id }
    );

    setGenerandoLlave(false);

    if (error) {
      setErrorLlave(error.message);
      return;
    }

    await cargarTorneo();
  };

  // Suizo (migración 069): arranca el torneo (arma el grupo único y la
  // ronda 1, al azar) -- de ahí en más se avanza con
  // handleSiguienteRondaSuiza.
  const handleIniciarSuizo = async () => {
    if (!torneo) return;

    setIniciandoSuizo(true);
    setErrorSuizo(null);

    const { error } = await supabase.rpc("generar_torneo_suizo", { p_tournament_id: torneo.id });

    setIniciandoSuizo(false);

    if (error) {
      setErrorSuizo(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleSiguienteRondaSuiza = async () => {
    if (!torneo) return;

    setGenerandoRondaSuiza(true);
    setErrorSuizo(null);

    const { error } = await supabase.rpc("generar_siguiente_ronda_suiza", { p_tournament_id: torneo.id });

    setGenerandoRondaSuiza(false);

    if (error) {
      setErrorSuizo(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleIniciarTodosContraTodos = async () => {
    if (!torneo) return;

    setIniciandoTodosContraTodos(true);
    setErrorTodosContraTodos(null);

    const { error } = await supabase.rpc("generar_todos_contra_todos", { p_tournament_id: torneo.id });

    setIniciandoTodosContraTodos(false);

    if (error) {
      setErrorTodosContraTodos(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleFinalizarTodosContraTodos = async () => {
    if (!torneo) return;

    setFinalizandoTodosContraTodos(true);
    setErrorTodosContraTodos(null);

    const { error } = await supabase.rpc("finalizar_todos_contra_todos", { p_tournament_id: torneo.id });

    setFinalizandoTodosContraTodos(false);

    if (error) {
      setErrorTodosContraTodos(error.message);
      return;
    }

    await cargarTorneo();
  };

  // Tabla de posiciones / Leaderboard (migración 069): el organizador
  // carga el puntaje de cada inscrito directo, sin partidos de por
  // medio -- "por el criterio que corresponda", como pide el pedido.
  const handleGuardarPuntosLeaderboard = async (participantId: string) => {
    const puntos = Number(puntosEditados[participantId]);
    if (!Number.isFinite(puntos)) {
      setErrorLeaderboard("El puntaje tiene que ser un número.");
      return;
    }

    setGuardandoPuntosId(participantId);
    setErrorLeaderboard(null);

    const { error } = await supabase.rpc("actualizar_puntos_leaderboard", {
      p_participant_id: participantId,
      p_puntos: puntos,
    });

    setGuardandoPuntosId(null);

    if (error) {
      setErrorLeaderboard(error.message);
      return;
    }

    await cargarTorneo();
  };

  const handleFinalizarLeaderboard = async () => {
    if (!torneo || !campeonElegido) return;
    if (!window.confirm("¿Confirmas finalizar el torneo con este campeón? No se puede deshacer.")) return;

    setFinalizandoLeaderboard(true);
    setErrorLeaderboard(null);

    const { error } = await supabase.rpc("finalizar_leaderboard", {
      p_tournament_id: torneo.id,
      p_campeon_participant_id: campeonElegido,
    });

    setFinalizandoLeaderboard(false);

    if (error) {
      setErrorLeaderboard(error.message);
      return;
    }

    await cargarTorneo();
  };

  // Migración 041: mismo botón de "cerrar check-in", pero cuando el
  // torneo tiene etapa de grupos arma los grupos en vez de la llave
  // directo -- generar_grupos() es quien reparte y arma los partidos
  // de todos contra todos, y deja fase_actual = "grupos".
  const handleGenerarGrupos = async () => {
    if (!torneo) return;

    setGenerandoGrupos(true);
    setErrorGrupos(null);

    const { error } = await supabase.rpc("generar_grupos", { p_tournament_id: torneo.id });

    setGenerandoGrupos(false);

    if (error) {
      setErrorGrupos(error.message);
      return;
    }

    await cargarTorneo();
  };

  // Migración 057, reemplazada por la 087: cierra el check-in y arma
  // las jornadas del fixture de First Stand -- reemplaza a
  // handleGenerarGrupos para este formato de liga, que no puede usar
  // generar_grupos() (exige al menos 2 grupos). Desde la migración 087
  // usa generar_todos_contra_todos() (la misma función que ya usaba la
  // liga "Todos contra todos"), que además de armar el fixture crea
  // una Clan War real por partido -- antes First Stand se quedaba en
  // el reporte de un solo clic, sin lineup ni check-in de Clan War.
  const handleGenerarFixtureFirstStand = async () => {
    if (!torneo) return;

    setGenerandoFixture(true);
    setErrorFixture(null);

    const { error } = await supabase.rpc("generar_todos_contra_todos", { p_tournament_id: torneo.id });

    setGenerandoFixture(false);

    if (error) {
      setErrorFixture(error.message);
      return;
    }

    await cargarTorneo();
  };

  // Invitación rápida de varios clanes a la vez (migración 057):
  // lista los equipos públicos no disueltos que todavía no están
  // inscritos, para que el organizador los marque e inscriba de una.
  const handleAbrirInvitarEquipos = async () => {
    if (invitarAbierto) {
      setInvitarAbierto(false);
      return;
    }

    setInvitarAbierto(true);
    setCargandoEquiposPublicos(true);
    setErrorInvitarEquipos(null);

    const { data } = await supabase
      .from("teams")
      .select("id, name, tag")
      .eq("is_public", true)
      .eq("disuelto", false)
      .order("name");

    const idsYaInscritos = new Set(participantes.map((p) => p.teamId).filter((t): t is string => t !== null));
    setEquiposPublicos((data ?? []).filter((t) => !idsYaInscritos.has(t.id)));
    setEquiposSeleccionados({});
    setCargandoEquiposPublicos(false);
  };

  const handleSeleccionarTodosLosEquipos = () => {
    const todosMarcados = equiposPublicos.every((t) => equiposSeleccionados[t.id]);
    setEquiposSeleccionados(
      Object.fromEntries(equiposPublicos.map((t) => [t.id, !todosMarcados]))
    );
  };

  const handleInvitarEquiposMarcados = async () => {
    if (!torneo) return;

    const idsMarcados = equiposPublicos.filter((t) => equiposSeleccionados[t.id]).map((t) => t.id);
    if (idsMarcados.length === 0) return;

    setInvitandoEquipos(true);
    setErrorInvitarEquipos(null);

    // Se llama una vez por equipo marcado -- organizador_inscribir_equipo()
    // ya valida cupos, tamaño mínimo y que el torneo siga abierto en
    // cada llamada, así que un equipo que falla no bloquea al resto.
    const errores: string[] = [];
    for (const teamId of idsMarcados) {
      const { error } = await supabase.rpc("organizador_inscribir_equipo", {
        p_tournament_id: torneo.id,
        p_team_id: teamId,
      });
      if (error) errores.push(error.message);
    }

    setInvitandoEquipos(false);

    if (errores.length > 0) {
      setErrorInvitarEquipos(errores.join(" · "));
    } else {
      setInvitarAbierto(false);
    }

    await cargarTorneo();
  };

  // Invitar equipos amigos al evento (migración 073): a diferencia de
  // arriba, esto no inscribe directo -- manda una invitación real que
  // el equipo amigo tiene que aceptar desde su Panel de control
  // (responder_invitacion_torneo_equipo). Solo se le ofrecen los
  // amigos de MI PROPIO equipo (miEquipo, ya resuelto más arriba),
  // que todavía no estén inscritos ni tengan una invitación pendiente.
  const handleAbrirInvitarAmigos = async () => {
    if (amigosAbierto) {
      setAmigosAbierto(false);
      return;
    }
    if (!torneo || !miEquipo) return;

    setAmigosAbierto(true);
    setCargandoEquiposAmigos(true);
    setErrorInvitarAmigos(null);
    setAmigosInvitados(false);

    const { data: amistadesData } = await supabase
      .from("team_amistades")
      .select("equipo_solicitante_id, equipo_destinatario_id")
      .eq("status", "aceptada")
      .or(`equipo_solicitante_id.eq.${miEquipo.team_id},equipo_destinatario_id.eq.${miEquipo.team_id}`);

    const idsAmigos = (amistadesData ?? []).map((a) =>
      a.equipo_solicitante_id === miEquipo.team_id ? a.equipo_destinatario_id : a.equipo_solicitante_id
    );

    if (idsAmigos.length === 0) {
      setEquiposAmigosDisponibles([]);
      setCargandoEquiposAmigos(false);
      return;
    }

    const idsYaInscritos = new Set(participantes.map((p) => p.teamId).filter((t): t is string => t !== null));

    const { data: invitacionesPendientesData } = await supabase
      .from("torneo_invitaciones_equipo")
      .select("equipo_id")
      .eq("tournament_id", torneo.id)
      .eq("status", "pendiente");
    const idsYaInvitados = new Set((invitacionesPendientesData ?? []).map((i) => i.equipo_id));

    const { data: equiposData } = await supabase
      .from("teams")
      .select("id, name, tag")
      .in("id", idsAmigos)
      .eq("disuelto", false)
      .order("name");

    setEquiposAmigosDisponibles(
      (equiposData ?? []).filter((t) => !idsYaInscritos.has(t.id) && !idsYaInvitados.has(t.id))
    );
    setEquiposAmigosSeleccionados({});
    setCargandoEquiposAmigos(false);
  };

  const handleSeleccionarTodosLosAmigos = () => {
    const todosMarcados = equiposAmigosDisponibles.every((t) => equiposAmigosSeleccionados[t.id]);
    setEquiposAmigosSeleccionados(
      Object.fromEntries(equiposAmigosDisponibles.map((t) => [t.id, !todosMarcados]))
    );
  };

  const handleInvitarAmigosMarcados = async () => {
    if (!torneo) return;

    const idsMarcados = equiposAmigosDisponibles.filter((t) => equiposAmigosSeleccionados[t.id]).map((t) => t.id);
    if (idsMarcados.length === 0) return;

    setInvitandoAmigos(true);
    setErrorInvitarAmigos(null);

    const errores: string[] = [];
    for (const teamId of idsMarcados) {
      const { error } = await supabase.rpc("invitar_equipo_amigo_torneo", {
        p_tournament_id: torneo.id,
        p_equipo_id: teamId,
      });
      if (error) errores.push(error.message);
    }

    setInvitandoAmigos(false);

    if (errores.length > 0) {
      setErrorInvitarAmigos(errores.join(" · "));
    } else {
      setAmigosInvitados(true);
      setEquiposAmigosDisponibles((prev) => prev.filter((t) => !idsMarcados.includes(t.id)));
      setEquiposAmigosSeleccionados({});
    }
  };

  // Overlay para OBS (migración 044): copia el link completo, no una
  // ruta relativa -- OBS necesita una URL absoluta para poder abrirla
  // como "Fuente de navegador".
  const handleCopiarUrlObs = async () => {
    if (!torneo) return;
    await navigator.clipboard.writeText(`${window.location.origin}/overlay/torneo/${torneo.id}`);
    setUrlObsCopiada(true);
    setTimeout(() => setUrlObsCopiada(false), 2000);
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

      <div className="overlay-obs-copy">
        <button type="button" className="btn btn-ghost" onClick={handleCopiarUrlObs}>
          {urlObsCopiada ? "¡Copiado!" : "Copiar URL para OBS"}
        </button>
        <p className="form-hint">
          Pégala en OBS como "Fuente de navegador" para mostrar el marcador en tu transmisión.
        </p>
      </div>

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

      {/* Temporadas (migración 047): solo el organizador las
          administra -- contenedor mínimo para que "fichado para toda
          la temporada" (mercenarios) y las alianzas entre equipos
          tengan un límite de tiempo real. Los equipos las eligen al
          proponer una Clan War, no acá. */}
      {esOrganizador && (
        <>
          <h2 className="detail-subtitle">Temporadas</h2>
          {temporadas.length === 0 ? (
            <p className="detail-empty">Todavía no creaste ninguna temporada para este torneo.</p>
          ) : (
            <div className="detail-participant-list">
              {temporadas.map((t) => (
                <div key={t.id} className="reto-item">
                  <p className="reto-desc">
                    {t.nombre}
                    <span className="reto-status">
                      {t.inscripciones_abiertas ? "Inscripciones abiertas" : "Inscripciones cerradas"}
                    </span>
                  </p>
                  <p className="tournament-card-meta">
                    {formatFecha(t.fecha_inicio)} — {formatFecha(t.fecha_fin)}
                  </p>
                  <div className="bracket-report">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={guardandoInscripciones === t.id}
                      onClick={() => handleToggleInscripciones(t.id, !t.inscripciones_abiertas)}
                    >
                      {t.inscripciones_abiertas ? "Cerrar inscripciones" : "Abrir inscripciones"}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => handleAbrirRangos(t)}>
                      {temporadaRangosAbierta === t.id ? "Cerrar rangos de MMR" : "Rangos de MMR por posición"}
                    </button>
                  </div>

                  {temporadaRangosAbierta === t.id && (
                    <div className="form-group">
                      <p className="tournament-card-meta">
                        Rango de mmr_equipos permitido para cada posición del set (formato WTL). Deja
                        una posición vacía (mínimo y máximo) para no restringirla.
                      </p>
                      {errorRangos && <div className="form-error">{errorRangos}</div>}
                      {([1, 2, 3] as const).map((posicion) => (
                        <div key={posicion} className="form-group">
                          <label className="form-label">Posición {posicion}</label>
                          <input
                            className="form-input"
                            type="number"
                            placeholder="MMR mínimo"
                            value={rangosMmrForm[`${t.id}-${posicion}-min`] ?? ""}
                            onChange={(e) =>
                              setRangosMmrForm((prev) => ({ ...prev, [`${t.id}-${posicion}-min`]: e.target.value }))
                            }
                          />
                          <input
                            className="form-input"
                            type="number"
                            placeholder="MMR máximo"
                            value={rangosMmrForm[`${t.id}-${posicion}-max`] ?? ""}
                            onChange={(e) =>
                              setRangosMmrForm((prev) => ({ ...prev, [`${t.id}-${posicion}-max`]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={guardandoRangos === t.id}
                        onClick={() => handleGuardarRangos(t.id)}
                      >
                        {guardandoRangos === t.id ? "Guardando..." : "Guardar rangos de MMR"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <form className="auth-form" onSubmit={handleCrearTemporada}>
            {errorTemporada && <div className="form-error">{errorTemporada}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="temporada-nombre">
                Nombre de la nueva temporada
              </label>
              <input
                id="temporada-nombre"
                className="form-input"
                type="text"
                placeholder="SLL Temporada 6"
                value={nombreTemporada}
                onChange={(e) => setNombreTemporada(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="temporada-fin">
                Fecha de fin
              </label>
              <p className="form-hint">
                Arranca el mismo día que el torneo ({formatFecha(torneo.fecha_inicio)}).
              </p>
              <input
                id="temporada-fin"
                className="form-input"
                type="datetime-local"
                min={fechaInicioComoInputLocal(torneo.fecha_inicio)}
                value={fechaFinTemporada}
                onChange={(e) => setFechaFinTemporada(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-ghost btn-block" disabled={creandoTemporada}>
              {creandoTemporada ? "Creando..." : "Crear temporada"}
            </button>
          </form>
        </>
      )}

      {/* Panel de organizador (migración 079, rediseñado): ya no se
          eligen al crear el torneo -- se ajustan acá, en cualquier
          momento, exclusivo del organizador. Misma lógica de guardado
          de siempre (handleActualizarOpcionAvanzada), solo cambia la
          presentación: tarjetas por tema en vez de una lista plana de
          checkboxes. */}
      {esOrganizador && (
        <div className="organizer-panel">
          <button
            type="button"
            className={`organizer-panel-toggle ${mostrarOpcionesAvanzadas ? "is-open" : ""}`}
            onClick={() => setMostrarOpcionesAvanzadas((v) => !v)}
          >
            <span className="organizer-panel-toggle-icon">
              <IconoEngranaje />
            </span>
            <span className="organizer-panel-toggle-text">
              <span className="organizer-panel-toggle-title">Panel de organizador</span>
              <span className="organizer-panel-toggle-sub">Formato, cuadro, permisos y visualización</span>
            </span>
            <span className="organizer-panel-chevron">
              <IconoChevron />
            </span>
          </button>

          {mostrarOpcionesAvanzadas && (
            <div className="organizer-panel-body">
              {errorOpcionesAvanzadas && <div className="form-error">{errorOpcionesAvanzadas}</div>}

              <div className="organizer-panel-grid">
                {/* Etapa de grupos y tercer lugar: solo tienen sentido
                    ANTES de generar la llave -- una vez que el torneo
                    arrancó, cambiarlas no tendría ningún efecto real. */}
                {torneo.modo === "eliminacion_simple" && !torneo.formato_liga && torneo.estado === "abierto" && (
                  <div className="organizer-panel-card">
                    <div className="organizer-panel-card-header">
                      <span className="organizer-panel-card-icon">
                        <IconoFormato />
                      </span>
                      <h3 className="organizer-panel-card-title">Formato</h3>
                    </div>
                    <div className="organizer-panel-card-body">
                      <OpcionToggle
                        label="Con etapa de grupos"
                        hint="Los inscritos se reparten en grupos y juegan todos contra todos dentro de su grupo; los mejores de cada uno avanzan a la llave eliminatoria."
                        checked={torneo.tiene_fase_grupos}
                        onChange={async (checked) => {
                          // Una a la vez: las tres llamadas actualizan el
                          // mismo torneo y cada una termina en
                          // cargarTorneo() -- lanzarlas en paralelo podía
                          // dejar el estado a medio camino si alguna
                          // fallaba (o pisarse entre ellas al refrescar).
                          const ok = await handleActualizarOpcionAvanzada("tiene_fase_grupos", checked);
                          if (ok && !checked) {
                            await handleActualizarOpcionAvanzada("cantidad_grupos", null);
                            await handleActualizarOpcionAvanzada("avanzan_por_grupo", null);
                          }
                        }}
                      />

                      {torneo.tiene_fase_grupos && (
                        <div className="organizer-panel-subfields">
                          <div className="form-group">
                            <label className="form-label" htmlFor="torneo-cantidad-grupos-editar">
                              Cantidad de grupos
                            </label>
                            <input
                              id="torneo-cantidad-grupos-editar"
                              className="form-input"
                              type="number"
                              min={2}
                              defaultValue={torneo.cantidad_grupos ?? 2}
                              onBlur={(e) =>
                                handleActualizarOpcionAvanzada("cantidad_grupos", Number(e.target.value))
                              }
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label" htmlFor="torneo-avanzan-por-grupo-editar">
                              Cuántos avanzan por grupo
                            </label>
                            <input
                              id="torneo-avanzan-por-grupo-editar"
                              className="form-input"
                              type="number"
                              min={1}
                              defaultValue={torneo.avanzan_por_grupo ?? 2}
                              onBlur={(e) =>
                                handleActualizarOpcionAvanzada("avanzan_por_grupo", Number(e.target.value))
                              }
                            />
                          </div>
                        </div>
                      )}

                      <OpcionToggle
                        label="Con partido por el tercer lugar"
                        hint="Los dos perdedores de semifinal juegan aparte por el tercer puesto, en paralelo a la final."
                        checked={torneo.tiene_tercer_lugar}
                        onChange={(checked) => handleActualizarOpcionAvanzada("tiene_tercer_lugar", checked)}
                      />
                    </div>
                  </div>
                )}

                <div className="organizer-panel-card">
                  <div className="organizer-panel-card-header">
                    <span className="organizer-panel-card-icon">
                      <IconoCuadro />
                    </span>
                    <h3 className="organizer-panel-card-title">Cuadro</h3>
                  </div>
                  <div className="organizer-panel-card-body">
                    <OpcionToggle
                      label="Nombres de ronda personalizados"
                      hint="Octavos, Cuartos, Semifinal, Final -- en vez de Ronda 1, Ronda 2..."
                      checked={torneo.mostrar_nombres_ronda_personalizados}
                      onChange={(checked) =>
                        handleActualizarOpcionAvanzada("mostrar_nombres_ronda_personalizados", checked)
                      }
                    />
                    <OpcionToggle
                      label="Ocultar números de semilla"
                      checked={torneo.ocultar_numeros_semilla}
                      onChange={(checked) => handleActualizarOpcionAvanzada("ocultar_numeros_semilla", checked)}
                    />
                    <OpcionToggle
                      label="Ocultar el cuadro al público"
                      hint="Solo lo ven los inscritos, hasta que empiece el torneo."
                      checked={torneo.ocultar_bracket_publico}
                      onChange={(checked) => handleActualizarOpcionAvanzada("ocultar_bracket_publico", checked)}
                    />
                    <div className="form-group organizer-panel-select-group">
                      <label className="form-label" htmlFor="torneo-reglas-semillas-editar">
                        Ubicar a los participantes usando
                      </label>
                      <select
                        id="torneo-reglas-semillas-editar"
                        className="form-select"
                        value={torneo.reglas_semillas}
                        onChange={(e) => handleActualizarOpcionAvanzada("reglas_semillas", e.target.value)}
                      >
                        <option value="aleatorio">Sorteo al azar</option>
                        <option value="tradicional">Semillas tradicionales (por MMR)</option>
                      </select>
                      <p className="form-hint">Solo tiene efecto la próxima vez que generes la llave.</p>
                    </div>
                  </div>
                </div>

                <div className="organizer-panel-card">
                  <div className="organizer-panel-card-header">
                    <span className="organizer-panel-card-icon">
                      <IconoPermisos />
                    </span>
                    <h3 className="organizer-panel-card-title">Permisos</h3>
                  </div>
                  <div className="organizer-panel-card-body">
                    <OpcionToggle
                      label="Autoreporte de resultados"
                      hint="Los participantes pueden reportar su propio resultado."
                      checked={torneo.permite_autoreporte}
                      onChange={(checked) => handleActualizarOpcionAvanzada("permite_autoreporte", checked)}
                    />
                    <OpcionToggle
                      label="Excluir del buscador público"
                      checked={torneo.excluido_de_busqueda}
                      onChange={(checked) => handleActualizarOpcionAvanzada("excluido_de_busqueda", checked)}
                    />
                  </div>
                </div>

                <div className="organizer-panel-card">
                  <div className="organizer-panel-card-header">
                    <span className="organizer-panel-card-icon">
                      <IconoVisualizacion />
                    </span>
                    <h3 className="organizer-panel-card-title">Visualización</h3>
                  </div>
                  <div className="organizer-panel-card-body">
                    <OpcionToggle
                      label="Mostrar la pestaña de posiciones"
                      checked={torneo.mostrar_posiciones}
                      onChange={(checked) => handleActualizarOpcionAvanzada("mostrar_posiciones", checked)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
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
              <Avatar url={p.avatarUrl} nombre={p.nombre} className="detail-participant-avatar" forma={p.avatarForma} />
              {p.nombre ?? "Jugador de RemorApp"}
              {p.liga !== null && p.mmr !== null && (
                <LigaBadge liga={p.liga} mmr={p.mmr} bancaRota={p.bancaRota} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Invitación rápida de varios clanes a la vez (migración 057):
          comodidad para el organizador -- automatiza llamar a
          organizador_inscribir_equipo() varias veces en vez de tener
          que esperar a que cada equipo se inscriba solo. */}
      {esOrganizador && esPorEquipos && torneo.estado === "abierto" && (
        <div className="detail-register-box">
          <button type="button" className="btn btn-ghost btn-block" onClick={handleAbrirInvitarEquipos}>
            {invitarAbierto ? "Cerrar" : "Invitar varios clanes a la vez"}
          </button>

          {invitarAbierto && (
            <>
              {errorInvitarEquipos && <div className="form-error">{errorInvitarEquipos}</div>}
              {cargandoEquiposPublicos ? (
                <p className="tournament-card-meta">Cargando clanes públicos...</p>
              ) : equiposPublicos.length === 0 ? (
                <p className="tournament-card-meta">
                  No hay clanes públicos disponibles para invitar (ya están todos inscritos o no
                  hay ninguno creado).
                </p>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={handleSeleccionarTodosLosEquipos}>
                    {equiposPublicos.every((t) => equiposSeleccionados[t.id])
                      ? "Desmarcar todos"
                      : "Seleccionar todos"}
                  </button>
                  <div className="detail-participant-list">
                    {equiposPublicos.map((equipo) => (
                      <label key={equipo.id} className="form-checkbox-label">
                        <input
                          type="checkbox"
                          checked={!!equiposSeleccionados[equipo.id]}
                          onChange={(e) =>
                            setEquiposSeleccionados((prev) => ({ ...prev, [equipo.id]: e.target.checked }))
                          }
                        />
                        {equipo.name} [{equipo.tag}]
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={invitandoEquipos || equiposPublicos.every((t) => !equiposSeleccionados[t.id])}
                    onClick={handleInvitarEquiposMarcados}
                  >
                    {invitandoEquipos ? "Inscribiendo..." : "Inscribir a los clanes marcados"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Invitar equipos amigos al evento (migración 073): a
          diferencia del bloque de arriba, esto manda una invitación
          real que el equipo amigo tiene que aceptar desde su propio
          Panel de control -- solo aparece si el organizador tiene un
          equipo propio con amigos. */}
      {esOrganizador && esPorEquipos && torneo.estado === "abierto" && miEquipo && (
        <div className="detail-register-box">
          <button type="button" className="btn btn-ghost btn-block" onClick={handleAbrirInvitarAmigos}>
            {amigosAbierto ? "Cerrar" : "Invitar equipos amigos al evento"}
          </button>

          {amigosAbierto && (
            <>
              {errorInvitarAmigos && <div className="form-error">{errorInvitarAmigos}</div>}
              {amigosInvitados && (
                <div className="form-success">
                  Invitación enviada -- queda pendiente de que el equipo la acepte desde su Panel de
                  control.
                </div>
              )}
              {cargandoEquiposAmigos ? (
                <p className="tournament-card-meta">Cargando equipos amigos...</p>
              ) : equiposAmigosDisponibles.length === 0 ? (
                <p className="tournament-card-meta">
                  No hay equipos amigos disponibles para invitar (todavía no tienes ninguno, ya están
                  todos inscritos, o ya tienen una invitación pendiente). Podés hacerte amigo de otro
                  equipo desde el Panel de control de tu clan, en "Equipos amigos".
                </p>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={handleSeleccionarTodosLosAmigos}>
                    {equiposAmigosDisponibles.every((t) => equiposAmigosSeleccionados[t.id])
                      ? "Desmarcar todos"
                      : "Seleccionar todos"}
                  </button>
                  <div className="detail-participant-list">
                    {equiposAmigosDisponibles.map((equipo) => (
                      <label key={equipo.id} className="form-checkbox-label">
                        <input
                          type="checkbox"
                          checked={!!equiposAmigosSeleccionados[equipo.id]}
                          onChange={(e) =>
                            setEquiposAmigosSeleccionados((prev) => ({ ...prev, [equipo.id]: e.target.checked }))
                          }
                        />
                        {equipo.name} [{equipo.tag}]
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={invitandoAmigos || equiposAmigosDisponibles.every((t) => !equiposAmigosSeleccionados[t.id])}
                    onClick={handleInvitarAmigosMarcados}
                  >
                    {invitandoAmigos ? "Invitando..." : "Invitar a los equipos marcados"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {(torneo.modo === "eliminacion_simple" || torneo.modo === "eliminacion_doble") && (
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

              {esOrganizador && torneo.formato_liga === "first_stand" && (
                <>
                  {errorFixture && <div className="form-error">{errorFixture}</div>}
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={generandoFixture}
                    onClick={handleGenerarFixtureFirstStand}
                  >
                    {generandoFixture ? "Generando..." : "Cerrar check-in y generar fixture"}
                  </button>
                </>
              )}

              {esOrganizador && torneo.formato_liga !== "first_stand" && torneo.tiene_fase_grupos && (
                <>
                  {errorGrupos && <div className="form-error">{errorGrupos}</div>}
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={generandoGrupos}
                    onClick={handleGenerarGrupos}
                  >
                    {generandoGrupos ? "Generando..." : "Cerrar check-in y generar grupos"}
                  </button>
                </>
              )}

              {esOrganizador && torneo.formato_liga !== "first_stand" && !torneo.tiene_fase_grupos && (
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

          {torneo.fase_actual === "grupos" && (
            <>
              <h2 className="detail-subtitle">Grupos</h2>
              <GroupStage
                grupos={grupos}
                partidas={partidasGrupo}
                posiciones={posiciones}
                nombresPorParticipante={Object.fromEntries(
                  participantes.map((p) => [p.id, p.nombre ?? "Jugador de RemorApp"])
                )}
                puedeReportarPorParticipante={puedeReportarPorParticipante}
                userId={user?.id ?? null}
                organizadorId={torneo.creador_id}
                onCambio={cargarTorneo}
                permiteAutoreporte={torneo.permite_autoreporte}
                mostrarPosiciones={torneo.mostrar_posiciones}
                esFirstStand={torneo.formato_liga === "first_stand"}
              />

              {esOrganizador && (
                <div className="detail-register-box">
                  {errorLlave && <div className="form-error">{errorLlave}</div>}
                  {partidasGrupo.length > 0 && partidasGrupo.every((m) => m.status === "jugado") ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      disabled={generandoLlave}
                      onClick={handleGenerarLlave}
                    >
                      {generandoLlave
                        ? "Generando..."
                        : torneo.formato_liga === "first_stand"
                        ? "Generar playoffs"
                        : "Cerrar etapa de grupos y generar llave"}
                    </button>
                  ) : (
                    <p className="tournament-card-meta">
                      Todavía faltan partidos de grupo por jugarse antes de poder generar la llave.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {torneo.estado !== "abierto" && torneo.fase_actual === "eliminacion" && (
            <>
              <h2 className="detail-subtitle">Llave</h2>
              {torneo.ocultar_bracket_publico &&
              !esOrganizador &&
              !Object.values(puedeReportarPorParticipante).some(Boolean) ? (
                <p className="tournament-card-meta">
                  El organizador configuró este cuadro como privado -- solo lo ven los inscritos.
                </p>
              ) : (
                <>
                  {torneo.estado === "finalizado" && torneo.campeon_participant_id && (
                    <p className="form-success">
                      🏆 Campeón:{" "}
                      {participantes.find((p) => p.id === torneo.campeon_participant_id)?.nombre ??
                        "Jugador de RemorApp"}
                    </p>
                  )}
                  {torneo.tiene_tercer_lugar && torneo.tercer_lugar_participant_id && (
                    <p className="tournament-card-meta">
                      🥉 Tercer lugar:{" "}
                      {participantes.find((p) => p.id === torneo.tercer_lugar_participant_id)?.nombre ??
                        "Jugador de RemorApp"}
                    </p>
                  )}

                  {/* Estilo y fondo: visibles y editables solo para el
                      organizador, en cualquier momento, incluso con el
                      torneo en curso -- migración 040. */}
                  {esOrganizador && (
                    <BracketStylePicker
                      tournamentId={torneo.id}
                      estilo={torneo.estilo_bracket}
                      fondo={torneo.fondo_bracket}
                      onCambio={cargarTorneo}
                    />
                  )}

                  {partidas.length === 0 ? (
                    <p className="detail-empty">Cargando la llave...</p>
                  ) : (
                    <div className="tournament-bracket-wrap" data-fondo-bracket={torneo.fondo_bracket}>
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
                        avatarsPorParticipante={Object.fromEntries(participantes.map((p) => [p.id, p.avatarUrl]))}
                        estilo={torneo.estilo_bracket}
                        nombreTorneo={torneo.nombre}
                        nombresRondaPersonalizados={torneo.mostrar_nombres_ronda_personalizados}
                        permiteAutoreporte={torneo.permite_autoreporte}
                        puedeReportarPorParticipante={puedeReportarPorParticipante}
                        userId={user?.id ?? null}
                        organizadorId={torneo.creador_id}
                        onCambio={cargarTorneo}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Suizo (migración 069): reutiliza GroupStage tal cual --
          un torneo Suizo es, en los hechos, un solo grupo ("Suizo")
          cuyas rondas se generan de a una. */}
      {torneo.modo === "suizo" && (
        <>
          <h2 className="detail-subtitle">Suizo</h2>
          {errorSuizo && <div className="form-error">{errorSuizo}</div>}

          {torneo.estado === "finalizado" && torneo.campeon_participant_id && (
            <p className="form-success">
              🏆 Campeón:{" "}
              {participantes.find((p) => p.id === torneo.campeon_participant_id)?.nombre ??
                "Jugador de RemorApp"}
            </p>
          )}

          {torneo.estado === "abierto" ? (
            esOrganizador && (
              <div className="detail-register-box">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={iniciandoSuizo}
                  onClick={handleIniciarSuizo}
                >
                  {iniciandoSuizo ? "Iniciando..." : "Cerrar inscripciones e iniciar torneo Suizo"}
                </button>
              </div>
            )
          ) : (
            <>
              <GroupStage
                grupos={grupos}
                partidas={partidasGrupo}
                posiciones={posiciones}
                nombresPorParticipante={Object.fromEntries(
                  participantes.map((p) => [p.id, p.nombre ?? "Jugador de RemorApp"])
                )}
                puedeReportarPorParticipante={puedeReportarPorParticipante}
                userId={user?.id ?? null}
                organizadorId={torneo.creador_id}
                onCambio={cargarTorneo}
                permiteAutoreporte={torneo.permite_autoreporte}
                mostrarPosiciones={torneo.mostrar_posiciones}
                agruparPorJornada
              />

              {esOrganizador && torneo.estado === "en_curso" && (
                <div className="detail-register-box">
                  {(() => {
                    const ultimaJornada = Math.max(0, ...partidasGrupo.map((m) => m.jornada ?? 0));
                    const partidosUltimaJornada = partidasGrupo.filter((m) => (m.jornada ?? 0) === ultimaJornada);
                    const faltan = partidosUltimaJornada.some((m) => m.status !== "jugado");
                    return faltan ? (
                      <p className="tournament-card-meta">
                        Todavía faltan partidos de la ronda {ultimaJornada} por jugarse.
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-block"
                        disabled={generandoRondaSuiza}
                        onClick={handleSiguienteRondaSuiza}
                      >
                        {generandoRondaSuiza
                          ? "Generando..."
                          : ultimaJornada >= (torneo.swiss_rondas_totales ?? ultimaJornada)
                          ? "Cerrar torneo"
                          : "Generar siguiente ronda"}
                      </button>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Todos contra todos (migración 077): reutiliza el mismo trío
          de tablas que Suizo (un solo grupo), pero arma TODOS los
          partidos de una sola vez apenas se cierra el check-in, en
          vez de ronda por ronda -- no hay "siguiente ronda" acá, cada
          inscrito juega contra todos los demás exactamente una vez.
          A diferencia de Suizo, si usa check-in (mismo mecanismo que
          eliminación simple, ver puedeAbrirCheckIn más arriba). */}
      {torneo.modo === "todos_contra_todos" && (
        <>
          <h2 className="detail-subtitle">Todos contra todos</h2>
          {errorTodosContraTodos && <div className="form-error">{errorTodosContraTodos}</div>}

          {torneo.estado === "finalizado" && torneo.campeon_participant_id && (
            <p className="form-success">
              🏆 Campeón:{" "}
              {participantes.find((p) => p.id === torneo.campeon_participant_id)?.nombre ??
                "Jugador de RemorApp"}
            </p>
          )}

          {torneo.estado === "abierto" && (
            <>
              {puedeAbrirCheckIn && (
                <div className="detail-register-box">
                  {errorCheckIn && <div className="form-error">{errorCheckIn}</div>}
                  <p className="tournament-card-meta">
                    Antes de armar los partidos, pedile a los inscritos que confirmen que van a
                    jugar -- así el fixture sale solo con quienes de verdad van a participar.
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

              {/* Sin esto, un participante (no organizador) no veía
                  nada acá mientras el check-in seguía cerrado -- un
                  espacio en blanco sin ninguna pista de qué estaba
                  esperando. */}
              {!esOrganizador && !torneo.check_in_abierto && (
                <p className="tournament-card-meta">
                  Esperando a que el organizador abra el check-in para poder confirmar tu
                  asistencia.
                </p>
              )}

              {torneo.check_in_abierto && (
                <div className="detail-register-box">
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
                      disabled={iniciandoTodosContraTodos}
                      onClick={handleIniciarTodosContraTodos}
                    >
                      {iniciandoTodosContraTodos ? "Generando..." : "Cerrar check-in y armar los partidos"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {torneo.estado !== "abierto" && (
            <>
              <GroupStage
                grupos={grupos}
                partidas={partidasGrupo}
                posiciones={posiciones}
                nombresPorParticipante={Object.fromEntries(
                  participantes.map((p) => [p.id, p.nombre ?? "Jugador de RemorApp"])
                )}
                puedeReportarPorParticipante={puedeReportarPorParticipante}
                userId={user?.id ?? null}
                organizadorId={torneo.creador_id}
                onCambio={cargarTorneo}
                permiteAutoreporte={torneo.permite_autoreporte}
                mostrarPosiciones={torneo.mostrar_posiciones}
                agruparPorJornada
                estiloRanking
                miEquipoTag={miEquipo?.teamTag ?? null}
                miParticipantId={participantes.find((p) => p.teamId === miEquipo?.team_id)?.id ?? null}
              />

              {esOrganizador && torneo.estado === "en_curso" && (
                <div className="detail-register-box">
                  {partidasGrupo.some((m) => m.status !== "jugado") ? (
                    <p className="tournament-card-meta">Todavía faltan partidos por jugarse.</p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      disabled={finalizandoTodosContraTodos}
                      onClick={handleFinalizarTodosContraTodos}
                    >
                      {finalizandoTodosContraTodos ? "Finalizando..." : "Finalizar torneo"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Tabla de posiciones / Leaderboard (migración 069): sin
          cuadro ni partidos -- el organizador carga el puntaje de
          cada inscrito directo. */}
      {torneo.modo === "tabla_posiciones" && (
        <>
          <h2 className="detail-subtitle">Tabla de posiciones</h2>
          {errorLeaderboard && <div className="form-error">{errorLeaderboard}</div>}

          {torneo.estado === "finalizado" && torneo.campeon_participant_id && (
            <p className="form-success">
              🏆 Campeón:{" "}
              {participantes.find((p) => p.id === torneo.campeon_participant_id)?.nombre ??
                "Jugador de RemorApp"}
            </p>
          )}

          <table className="group-standings-table ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Participante</th>
                <th>Puntos</th>
                {esOrganizador && torneo.estado !== "finalizado" && <th></th>}
              </tr>
            </thead>
            <tbody>
              {[...participantes]
                .sort((a, b) => (b.puntosLeaderboard ?? 0) - (a.puntosLeaderboard ?? 0))
                .map((p, indice) => (
                  <tr key={p.id}>
                    <td>{indice + 1}</td>
                    <td>{p.nombre ?? "Jugador de RemorApp"}</td>
                    <td>
                      {esOrganizador && torneo.estado !== "finalizado" ? (
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: "6rem" }}
                          value={puntosEditados[p.id] ?? String(p.puntosLeaderboard ?? 0)}
                          onChange={(e) =>
                            setPuntosEditados((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                        />
                      ) : (
                        p.puntosLeaderboard ?? 0
                      )}
                    </td>
                    {esOrganizador && torneo.estado !== "finalizado" && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={guardandoPuntosId === p.id}
                          onClick={() => handleGuardarPuntosLeaderboard(p.id)}
                        >
                          {guardandoPuntosId === p.id ? "Guardando..." : "Guardar"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>

          {esOrganizador && torneo.estado !== "finalizado" && participantes.length > 0 && (
            <div className="detail-register-box">
              <div className="form-group">
                <label className="form-label" htmlFor="leaderboard-campeon">
                  Finalizar torneo -- elegir campeón
                </label>
                <select
                  id="leaderboard-campeon"
                  className="form-select"
                  value={campeonElegido}
                  onChange={(e) => setCampeonElegido(e.target.value)}
                >
                  <option value="">Selecciona un participante</option>
                  {participantes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre ?? "Jugador de RemorApp"}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={finalizandoLeaderboard || !campeonElegido}
                onClick={handleFinalizarLeaderboard}
              >
                {finalizandoLeaderboard ? "Finalizando..." : "Finalizar torneo"}
              </button>
            </div>
          )}
        </>
      )}

      {/* El organizador ya tiene su propio panel de control más abajo
          (check-in, generar llave, etc.) -- mostrarle además la caja de
          autoinscripción confundía: parecía que la app no lo reconocía
          como organizador de su propio torneo. */}
      {!esOrganizador && (
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

            {/* Torneo de liga (migración 079): la inscripción libre
                queda deshabilitada -- solo se entra por invitación del
                organizador o pidiendo el ingreso (que el organizador
                aprueba o rechaza). */}
            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros >= minimoMiembros &&
              torneo.estado === "abierto" &&
              cuposDisponibles > 0 &&
              torneo.liga_id && (
                <>
                  {errorSolicitud && <div className="form-error">{errorSolicitud}</div>}
                  {!miSolicitud && (
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      disabled={enviandoSolicitud}
                      onClick={handleSolicitarIngreso}
                    >
                      {enviandoSolicitud ? "Enviando..." : `Solicitar ingreso de ${miEquipo.teamTag}`}
                    </button>
                  )}
                  {miSolicitud?.status === "pendiente" && (
                    <p className="tournament-card-meta">
                      Ya pediste el ingreso de {miEquipo.teamTag} -- esperando que el organizador
                      responda.
                    </p>
                  )}
                  {miSolicitud?.status === "rechazada" && (
                    <p className="tournament-card-meta">El organizador rechazó tu solicitud de ingreso.</p>
                  )}
                </>
              )}

            {!cargandoMiEquipo &&
              !yaInscrito &&
              !profile?.suspendido &&
              miEquipo &&
              soyOwnerDeMiEquipo &&
              miEquipoMiembros >= minimoMiembros &&
              torneo.estado === "abierto" &&
              cuposDisponibles > 0 &&
              !torneo.liga_id && (
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
      )}

      {/* Solicitudes de ingreso recibidas (migración 079): exclusivo
          del organizador, solo en torneos de liga. */}
      {esOrganizador && torneo.liga_id && solicitudesRecibidas.length > 0 && (
        <div className="detail-register-box">
          <h3 className="detail-subtitle">Solicitudes de ingreso</h3>
          <div className="detail-participant-list">
            {solicitudesRecibidas.map((s) => (
              <div key={s.id} className="detail-participant-item">
                {s.equipoNombre}
                <div className="invitation-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={respondiendoSolicitudId === s.id}
                    onClick={() => handleResponderSolicitud(s.id, true)}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={respondiendoSolicitudId === s.id}
                    onClick={() => handleResponderSolicitud(s.id, false)}
                  >
                    Rechazar
                  </button>
                </div>
                {erroresResponderSolicitud[s.id] && (
                  <div className="form-error">{erroresResponderSolicitud[s.id]}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
