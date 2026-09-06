import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatFecha } from "../lib/formatters";
import { COUNTRY_OPTIONS, PERFIL_TIPO_OPTIONS } from "../types/profile";
import type { PerfilTipo } from "../types/profile";
import type { AdminUserRow } from "../types/admin";
import type { TournamentRow } from "../types/tournaments";
import type { BracketMatchRow } from "../types/bracket";

type Tab = "torneos" | "usuarios" | "equipos" | "clanwars" | "disputas" | "reportes" | "alianzas" | "pruebas";

// Resultado de generar_escenario_prueba_lineup() (migración 053).
interface EscenarioPruebaGenerado {
  team_a_id: string;
  team_a_tag: string;
  team_b_id: string;
  team_b_tag: string;
  clan_war_id: string;
}

interface ResultadoLimpieza {
  equipos: number;
  retos: number;
  cuentas: number;
}

interface ReporteConNombre {
  id: string;
  asunto: string;
  descripcion: string;
  createdAt: string;
  reportadoPorNombre: string;
}

interface EquipoEncontrado {
  id: string;
  name: string;
  tag: string;
  disuelto: boolean;
}

// Migración 062: gestión de Clan War para el dueño de la plataforma.
interface ClanWarAdminRow {
  id: string;
  challengerTeamId: string;
  challengerNombre: string;
  challengedTeamId: string;
  challengedNombre: string;
  status: string;
  fechaHoraCet: string;
  formato: "simple" | "wtl";
  lineupVistoBuenoChallenger: boolean;
  lineupVistoBuenoChallenged: boolean;
  intervenidoPorAdmin: boolean;
}

interface LineupEntryAdmin {
  id: string;
  jugadorId: string | null;
  nombre: string;
  posicion: number | null;
}

interface RosterElegibleAdmin {
  jugadorId: string;
  nombre: string;
}

interface DisputaConNombres extends BracketMatchRow {
  tournamentNombre: string;
  p1Nombre: string;
  p2Nombre: string;
  reportedP1Nombre: string | null;
  reportedP2Nombre: string | null;
}

// Alianzas pendientes de aprobación (migración 047).
interface AlianzaPendienteConNombres {
  id: string;
  equipoANombre: string;
  equipoBNombre: string;
  temporadaNombre: string;
  createdAt: string;
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
  // Motivo escrito para cada fila, antes de confirmar "Suspender" --
  // es obligatorio, admin_suspender_usuario() lo exige.
  const [motivosSuspension, setMotivosSuspension] = useState<Record<string, string>>({});
  const [erroresSuspender, setErroresSuspender] = useState<Record<string, string>>({});

  // --- Equipos: buscar por tag y eliminar definitivamente ---
  const [busquedaTagEquipo, setBusquedaTagEquipo] = useState("");
  const [buscandoEquipo, setBuscandoEquipo] = useState(false);
  const [errorBusquedaEquipo, setErrorBusquedaEquipo] = useState<string | null>(null);
  const [equipoEncontrado, setEquipoEncontrado] = useState<EquipoEncontrado | null>(null);
  const [eliminandoEquipo, setEliminandoEquipo] = useState(false);

  // --- Torneos: buscar por nombre y eliminar cualquiera (migración 062) ---
  const [busquedaNombreTorneo, setBusquedaNombreTorneo] = useState("");
  const [buscandoTorneos, setBuscandoTorneos] = useState(false);
  const [errorBusquedaTorneo, setErrorBusquedaTorneo] = useState<string | null>(null);
  const [torneosEncontrados, setTorneosEncontrados] = useState<TournamentRow[]>([]);
  const [eliminandoTorneo, setEliminandoTorneo] = useState<string | null>(null);

  // --- Usuarios: dar de baja cuenta (migración 062) ---
  const [motivosBaja, setMotivosBaja] = useState<Record<string, string>>({});
  const [dandoDeBaja, setDandoDeBaja] = useState<string | null>(null);
  const [erroresBaja, setErroresBaja] = useState<Record<string, string>>({});

  // --- Gestión de Clan War (migración 062): visible para cualquier
  // admin (RLS extendida), pero solo el dueño de la plataforma puede
  // intervenir de verdad (armar_lineup_cw/confirmar_lineup_cw exigen
  // es_dueno_plataforma() cuando se manda p_team_id_como_admin). ---
  const [clanWarsAdmin, setClanWarsAdmin] = useState<ClanWarAdminRow[]>([]);
  const [cargandoClanWarsAdmin, setCargandoClanWarsAdmin] = useState(true);
  const [errorClanWarsAdmin, setErrorClanWarsAdmin] = useState<string | null>(null);
  const [clanWarSeleccionada, setClanWarSeleccionada] = useState<string | null>(null);
  const [equipoActuarComo, setEquipoActuarComo] = useState<string | null>(null);
  const [lineupIntervencion, setLineupIntervencion] = useState<LineupEntryAdmin[]>([]);
  const [rosterIntervencion, setRosterIntervencion] = useState<RosterElegibleAdmin[]>([]);
  const [cargandoLineupIntervencion, setCargandoLineupIntervencion] = useState(false);
  const [jugadorNuevoIntervencion, setJugadorNuevoIntervencion] = useState("");
  const [posicionNuevoIntervencion, setPosicionNuevoIntervencion] = useState("");
  const [interviniendo, setInterviniendo] = useState(false);
  const [errorIntervencion, setErrorIntervencion] = useState<string | null>(null);

  // --- Disputas de bracket ---
  const [disputas, setDisputas] = useState<DisputaConNombres[]>([]);
  const [cargandoDisputas, setCargandoDisputas] = useState(true);
  const [errorDisputas, setErrorDisputas] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [erroresResolver, setErroresResolver] = useState<Record<string, string>>({});

  // --- Reportes de problemas (migración 033) ---
  const [reportes, setReportes] = useState<ReporteConNombre[]>([]);
  const [cargandoReportes, setCargandoReportes] = useState(true);
  const [errorReportes, setErrorReportes] = useState<string | null>(null);

  // --- Alianzas pendientes de aprobación (migración 047) ---
  const [alianzas, setAlianzas] = useState<AlianzaPendienteConNombres[]>([]);
  const [cargandoAlianzas, setCargandoAlianzas] = useState(true);
  const [errorAlianzas, setErrorAlianzas] = useState<string | null>(null);
  const [resolviendoAlianza, setResolviendoAlianza] = useState<string | null>(null);
  const [erroresAlianza, setErroresAlianza] = useState<Record<string, string>>({});

  // --- Pruebas (migración 053): exclusivo del dueño de la plataforma
  // -- la columna cruda es_dueno_plataforma no es legible desde el
  // cliente (ver el revoke en profiles), así que el único modo de
  // saberlo es llamando a la función. ---
  const [esDuenoPlataforma, setEsDuenoPlataforma] = useState(false);
  const [cargandoDueno, setCargandoDueno] = useState(true);
  const [generandoEscenario, setGenerandoEscenario] = useState(false);
  const [errorEscenario, setErrorEscenario] = useState<string | null>(null);
  const [escenarioGenerado, setEscenarioGenerado] = useState<EscenarioPruebaGenerado | null>(null);
  const [limpiando, setLimpiando] = useState(false);
  const [errorLimpieza, setErrorLimpieza] = useState<string | null>(null);
  const [resultadoLimpieza, setResultadoLimpieza] = useState<ResultadoLimpieza | null>(null);

  useEffect(() => {
    if (!user) {
      setCargandoDueno(false);
      return;
    }
    supabase.rpc("es_dueno_plataforma").then(({ data }) => {
      setEsDuenoPlataforma(!!data);
      setCargandoDueno(false);
    });
  }, [user]);

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

    const cargarReportes = async () => {
      const { data, error } = await supabase
        .from("reportes_staff")
        .select("id, asunto, descripcion, created_at, profiles!reportado_por(nombre, nick, unique_id)")
        .order("created_at", { ascending: false });

      if (error) {
        setErrorReportes(error.message);
        setCargandoReportes(false);
        return;
      }

      setReportes(
        (data ?? []).map((r) => {
          const perfil = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
          const p = perfil as { nombre: string | null; nick: string | null; unique_id: string | null } | null;
          return {
            id: r.id,
            asunto: r.asunto,
            descripcion: r.descripcion,
            createdAt: r.created_at,
            reportadoPorNombre: p?.nick ? `${p.nick}#${p.unique_id}` : p?.nombre ?? "Jugador de RemorApp",
          };
        })
      );
      setCargandoReportes(false);
    };

    cargarReportes();

    const cargarAlianzas = async () => {
      // Solo las que el equipo B ya confirmó -- sin esa confirmación,
      // aprobar_alianza() las rechaza igual, así que ni tiene sentido
      // ofrecerlas acá.
      const { data, error } = await supabase
        .from("team_alianzas")
        .select("id, team_a_id, team_b_id, created_at, temporadas(nombre)")
        .eq("status", "pendiente")
        .eq("aprobado_por_equipo_b", true)
        .order("created_at", { ascending: true });

      if (error) {
        setErrorAlianzas(error.message);
        setCargandoAlianzas(false);
        return;
      }

      const filas = data ?? [];
      if (filas.length === 0) {
        setAlianzas([]);
        setCargandoAlianzas(false);
        return;
      }

      const teamIds = [...new Set(filas.flatMap((a) => [a.team_a_id, a.team_b_id]))];
      const { data: equiposData } = await supabase.from("teams").select("id, name, tag").in("id", teamIds);
      const nombrePorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`]));

      setAlianzas(
        filas.map((a) => {
          const temporada = Array.isArray(a.temporadas) ? a.temporadas[0] : a.temporadas;
          return {
            id: a.id,
            equipoANombre: nombrePorTeamId[a.team_a_id] ?? "Equipo",
            equipoBNombre: nombrePorTeamId[a.team_b_id] ?? "Equipo",
            temporadaNombre: (temporada as { nombre?: string } | null)?.nombre ?? "Temporada",
            createdAt: a.created_at,
          };
        })
      );
      setCargandoAlianzas(false);
    };

    cargarAlianzas();

    const cargarClanWarsAdmin = async () => {
      // Gracias a la RLS extendida (migración 062), un admin ve
      // cualquier Clan War, no solo las de equipos propios.
      const { data, error } = await supabase
        .from("clan_wars")
        .select("*")
        .in("status", ["aceptada", "en_curso"])
        .order("fecha_hora_cet", { ascending: true });

      if (error) {
        setErrorClanWarsAdmin(error.message);
        setCargandoClanWarsAdmin(false);
        return;
      }

      const filas = data ?? [];
      const teamIds = [...new Set(filas.flatMap((r) => [r.challenger_team_id, r.challenged_team_id]))];
      let nombrePorTeamId: Record<string, string> = {};
      if (teamIds.length > 0) {
        const { data: equiposData } = await supabase.from("teams").select("id, name, tag").in("id", teamIds);
        nombrePorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`]));
      }

      setClanWarsAdmin(
        filas.map((r) => ({
          id: r.id,
          challengerTeamId: r.challenger_team_id,
          challengerNombre: nombrePorTeamId[r.challenger_team_id] ?? "Equipo",
          challengedTeamId: r.challenged_team_id,
          challengedNombre: nombrePorTeamId[r.challenged_team_id] ?? "Equipo",
          status: r.status,
          fechaHoraCet: r.fecha_hora_cet,
          formato: r.formato,
          lineupVistoBuenoChallenger: r.lineup_visto_bueno_challenger,
          lineupVistoBuenoChallenged: r.lineup_visto_bueno_challenged,
          intervenidoPorAdmin: r.intervenido_por_admin,
        }))
      );
      setCargandoClanWarsAdmin(false);
    };

    cargarClanWarsAdmin();
  }, [esAdmin]);

  // Orden importa: primero la sesión, después el perfil (llega por una
  // consulta aparte, después de la sesión) y recién ahí se puede saber
  // si es admin. Mostrar "nada" mientras cualquiera de los dos está
  // cargando, para no mandar a Inicio a un admin real por apurarse.
  if (loading || cargandoDueno) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!profile) return null;
  if (!profile.es_admin && !esDuenoPlataforma) return <Navigate to="/" replace />;

  const handleGenerarEscenario = async () => {
    setGenerandoEscenario(true);
    setErrorEscenario(null);
    setEscenarioGenerado(null);

    const { data, error } = await supabase.rpc("generar_escenario_prueba_lineup");

    setGenerandoEscenario(false);

    if (error) {
      setErrorEscenario(error.message);
      return;
    }

    setEscenarioGenerado(data as EscenarioPruebaGenerado);
  };

  const handleLimpiarEscenarios = async () => {
    setLimpiando(true);
    setErrorLimpieza(null);
    setResultadoLimpieza(null);

    const { data, error } = await supabase.rpc("limpiar_escenarios_prueba");

    setLimpiando(false);

    if (error) {
      setErrorLimpieza(error.message);
      return;
    }

    setResultadoLimpieza(data as ResultadoLimpieza);
    setEscenarioGenerado(null);
  };

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
    const { error } = await supabase.rpc("admin_cambiar_perfil_tipo", {
      p_usuario_id: usuarioId,
      p_nuevo_rol: nuevoRol,
    });
    setGuardandoUsuario(null);

    if (!error) {
      setUsuarios((prev) =>
        prev.map((u) => (u.id === usuarioId ? { ...u, perfil_tipo: nuevoRol } : u))
      );
    }
  };

  const handleSuspender = async (usuarioId: string, suspenderA: boolean) => {
    setErroresSuspender((prev) => ({ ...prev, [usuarioId]: "" }));

    const motivo = motivosSuspension[usuarioId]?.trim();
    if (suspenderA && !motivo) {
      setErroresSuspender((prev) => ({ ...prev, [usuarioId]: "Tienes que escribir un motivo para suspender." }));
      return;
    }

    setGuardandoUsuario(usuarioId);
    // admin_suspender_usuario() (en la base) es la que de verdad exige
    // el motivo y guarda quién y cuándo -- suspendido ya no se puede
    // tocar con un update directo (migración 028).
    const { error } = await supabase.rpc("admin_suspender_usuario", {
      p_usuario_id: usuarioId,
      p_suspender: suspenderA,
      p_motivo: suspenderA ? motivo : null,
    });
    setGuardandoUsuario(null);

    if (error) {
      setErroresSuspender((prev) => ({ ...prev, [usuarioId]: error.message }));
      return;
    }

    setMotivosSuspension((prev) => ({ ...prev, [usuarioId]: "" }));

    // Se recarga la lista completa en vez de parchear en memoria: hace
    // falta traer suspendido_por_nick/motivo/en actualizados, que
    // solo devuelve admin_listar_usuarios().
    const { data } = await supabase.rpc("admin_listar_usuarios");
    setUsuarios((data ?? []) as AdminUserRow[]);
  };

  const handleDarDeBaja = async (usuarioId: string, correo: string | null) => {
    setErroresBaja((prev) => ({ ...prev, [usuarioId]: "" }));

    if (
      !window.confirm(
        `¿Confirmas dar de baja la cuenta ${correo ?? "sin correo"}? Se borran sus datos personales, ` +
          "se le quita de sus equipos, y su correo queda bloqueado para registrarse de nuevo. Esta acción no se puede deshacer."
      )
    ) {
      return;
    }

    setDandoDeBaja(usuarioId);
    const { data, error } = await supabase.rpc("admin_dar_de_baja_cuenta", {
      p_user_id: usuarioId,
      p_motivo: motivosBaja[usuarioId]?.trim() || null,
    });
    setDandoDeBaja(null);

    if (error) {
      setErroresBaja((prev) => ({ ...prev, [usuarioId]: error.message }));
      return;
    }

    window.alert(
      data
        ? "Cuenta dada de baja. También se eliminó la cuenta de acceso (auth.users)."
        : "Cuenta dada de baja y correo bloqueado. La cuenta de acceso (auth.users) no se pudo eliminar -- revísala manualmente desde el dashboard de Supabase si hace falta."
    );

    const { data: listaActualizada } = await supabase.rpc("admin_listar_usuarios");
    setUsuarios((listaActualizada ?? []) as AdminUserRow[]);
  };

  const handleBuscarEquipo = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusquedaEquipo(null);
    setEquipoEncontrado(null);

    const tag = busquedaTagEquipo.trim().toUpperCase();
    if (!tag) {
      setErrorBusquedaEquipo("Escribe el tag del equipo.");
      return;
    }

    setBuscandoEquipo(true);
    const { data, error } = await supabase
      .from("teams")
      .select("id, name, tag, disuelto")
      .eq("tag", tag)
      .maybeSingle();
    setBuscandoEquipo(false);

    if (error || !data) {
      setErrorBusquedaEquipo("No encontré ningún equipo con ese tag.");
      return;
    }

    setEquipoEncontrado(data);
  };

  const handleEliminarEquipo = async () => {
    if (!equipoEncontrado) return;
    if (
      !window.confirm(
        `¿Confirmas que quieres eliminar definitivamente a ${equipoEncontrado.name} [${equipoEncontrado.tag}]? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    setEliminandoEquipo(true);
    setErrorBusquedaEquipo(null);

    // eliminar_equipo_definitivo() (en la base) es la que de verdad
    // verifica is_admin() y bloquea el borrado si el equipo tiene
    // historial de Clan Wars o de torneos -- esto de acá solo pide
    // confirmación y manda la orden.
    const { error } = await supabase.rpc("eliminar_equipo_definitivo", {
      p_team_id: equipoEncontrado.id,
    });

    setEliminandoEquipo(false);

    if (error) {
      setErrorBusquedaEquipo(error.message);
      return;
    }

    setEquipoEncontrado(null);
    setBusquedaTagEquipo("");
  };

  // --- Torneos: buscar por nombre y eliminar cualquiera (migración 062) ---
  const handleBuscarTorneos = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusquedaTorneo(null);
    setTorneosEncontrados([]);

    const termino = busquedaNombreTorneo.trim();
    if (!termino) {
      setErrorBusquedaTorneo("Escribe (al menos parte de) el nombre del torneo.");
      return;
    }

    setBuscandoTorneos(true);
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .ilike("nombre", `%${termino}%`)
      .order("creado_en", { ascending: false })
      .limit(20);
    setBuscandoTorneos(false);

    if (error) {
      setErrorBusquedaTorneo(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorBusquedaTorneo("No encontré ningún torneo con ese nombre.");
      return;
    }

    setTorneosEncontrados(data);
  };

  const handleEliminarTorneo = async (torneo: TournamentRow) => {
    if (
      !window.confirm(
        `¿Confirmas que quieres eliminar definitivamente el torneo "${torneo.nombre}" (${torneo.cupos_ocupados} inscritos)? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    setEliminandoTorneo(torneo.id);
    // admin_eliminar_torneo() (en la base) es la que de verdad verifica
    // is_admin() -- a diferencia de eliminar_equipo_definitivo(), no
    // bloquea el borrado aunque el torneo tenga participantes.
    const { error } = await supabase.rpc("admin_eliminar_torneo", { p_tournament_id: torneo.id });
    setEliminandoTorneo(null);

    if (error) {
      setErrorBusquedaTorneo(error.message);
      return;
    }

    setTorneosEncontrados((prev) => prev.filter((t) => t.id !== torneo.id));
  };

  // --- Gestión de Clan War (migración 062) ---
  const handleSeleccionarClanWar = (clanWarId: string) => {
    setClanWarSeleccionada((actual) => (actual === clanWarId ? null : clanWarId));
    setEquipoActuarComo(null);
    setLineupIntervencion([]);
    setRosterIntervencion([]);
    setErrorIntervencion(null);
  };

  const handleElegirEquipoActuarComo = async (clanWar: ClanWarAdminRow, teamId: string) => {
    setEquipoActuarComo(teamId);
    setErrorIntervencion(null);
    setCargandoLineupIntervencion(true);

    const [{ data: lineupData }, { data: rosterData }] = await Promise.all([
      supabase
        .from("clan_war_lineup")
        .select("id, jugador_id, jugador_temporal_id, posicion")
        .eq("clan_war_id", clanWar.id)
        .eq("team_id", teamId),
      supabase.rpc("roster_elegible_cw", { p_team_id: teamId, p_temporada_id: null }),
    ]);

    const jugadorIds = [
      ...new Set([
        ...((lineupData ?? []).map((l) => l.jugador_id).filter((id): id is string => id !== null)),
        ...((rosterData ?? []).map((r: { jugador_id: string }) => r.jugador_id)),
      ]),
    ];

    let nombrePorJugadorId: Record<string, string> = {};
    if (jugadorIds.length > 0) {
      const { data: perfilesData } = await supabase
        .from("profiles")
        .select("id, nick, unique_id")
        .in("id", jugadorIds);
      nombrePorJugadorId = Object.fromEntries(
        (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
      );
    }

    setLineupIntervencion(
      (lineupData ?? []).map((l) => ({
        id: l.id,
        jugadorId: l.jugador_id,
        nombre: l.jugador_id ? nombrePorJugadorId[l.jugador_id] ?? "Jugador de RemorApp" : "Jugador temporal",
        posicion: l.posicion,
      }))
    );
    setRosterIntervencion(
      ((rosterData ?? []) as { jugador_id: string }[]).map((r) => ({
        jugadorId: r.jugador_id,
        nombre: nombrePorJugadorId[r.jugador_id] ?? "Jugador de RemorApp",
      }))
    );
    setCargandoLineupIntervencion(false);
  };

  const handleAgregarLineupIntervencion = async (clanWar: ClanWarAdminRow) => {
    if (!equipoActuarComo || !jugadorNuevoIntervencion) return;
    setErrorIntervencion(null);
    setInterviniendo(true);

    const { error } = await supabase.rpc("armar_lineup_cw", {
      p_clan_war_id: clanWar.id,
      p_accion: "agregar",
      p_jugador_id: jugadorNuevoIntervencion,
      p_posicion: clanWar.formato === "wtl" ? Number(posicionNuevoIntervencion) || null : null,
      p_team_id_como_admin: equipoActuarComo,
    });

    setInterviniendo(false);

    if (error) {
      setErrorIntervencion(error.message);
      return;
    }

    setJugadorNuevoIntervencion("");
    setPosicionNuevoIntervencion("");
    await handleElegirEquipoActuarComo(clanWar, equipoActuarComo);
    await recargarClanWarAdminPuntual(clanWar.id);
  };

  const handleQuitarLineupIntervencion = async (clanWar: ClanWarAdminRow, lineupId: string) => {
    if (!equipoActuarComo) return;
    setErrorIntervencion(null);
    setInterviniendo(true);

    const { error } = await supabase.rpc("armar_lineup_cw", {
      p_clan_war_id: clanWar.id,
      p_accion: "quitar",
      p_lineup_id: lineupId,
      p_team_id_como_admin: equipoActuarComo,
    });

    setInterviniendo(false);

    if (error) {
      setErrorIntervencion(error.message);
      return;
    }

    await handleElegirEquipoActuarComo(clanWar, equipoActuarComo);
    await recargarClanWarAdminPuntual(clanWar.id);
  };

  const handleConfirmarVistoBuenoIntervencion = async (clanWar: ClanWarAdminRow) => {
    if (!equipoActuarComo) return;
    setErrorIntervencion(null);
    setInterviniendo(true);

    const { error } = await supabase.rpc("confirmar_lineup_cw", {
      p_clan_war_id: clanWar.id,
      p_team_id_como_admin: equipoActuarComo,
    });

    setInterviniendo(false);

    if (error) {
      setErrorIntervencion(error.message);
      return;
    }

    await recargarClanWarAdminPuntual(clanWar.id);
  };

  // Actualiza solo la fila de la Clan War puntual en la lista (visto
  // bueno + intervenido_por_admin), sin recargar el listado completo.
  const recargarClanWarAdminPuntual = async (clanWarId: string) => {
    const { data } = await supabase
      .from("clan_wars")
      .select("lineup_visto_bueno_challenger, lineup_visto_bueno_challenged, intervenido_por_admin")
      .eq("id", clanWarId)
      .maybeSingle();

    if (!data) return;

    setClanWarsAdmin((prev) =>
      prev.map((cw) =>
        cw.id === clanWarId
          ? {
              ...cw,
              lineupVistoBuenoChallenger: data.lineup_visto_bueno_challenger,
              lineupVistoBuenoChallenged: data.lineup_visto_bueno_challenged,
              intervenidoPorAdmin: data.intervenido_por_admin,
            }
          : cw
      )
    );
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

  const handleResolverAlianza = async (alianzaId: string, aprobar: boolean) => {
    setResolviendoAlianza(alianzaId);
    setErroresAlianza((prev) => ({ ...prev, [alianzaId]: "" }));

    const { error } = await supabase.rpc("aprobar_alianza", {
      p_alianza_id: alianzaId,
      p_aprobar: aprobar,
    });

    setResolviendoAlianza(null);

    if (error) {
      setErroresAlianza((prev) => ({ ...prev, [alianzaId]: error.message }));
      return;
    }

    setAlianzas((prev) => prev.filter((a) => a.id !== alianzaId));
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
          className={`admin-tab ${tab === "equipos" ? "active" : ""}`}
          onClick={() => setTab("equipos")}
        >
          Equipos
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "clanwars" ? "active" : ""}`}
          onClick={() => setTab("clanwars")}
        >
          Clan Wars
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "disputas" ? "active" : ""}`}
          onClick={() => setTab("disputas")}
        >
          Disputas
          {disputas.length > 0 && ` (${disputas.length})`}
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "reportes" ? "active" : ""}`}
          onClick={() => setTab("reportes")}
        >
          Reportes
          {reportes.length > 0 && ` (${reportes.length})`}
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "alianzas" ? "active" : ""}`}
          onClick={() => setTab("alianzas")}
        >
          Alianzas
          {alianzas.length > 0 && ` (${alianzas.length})`}
        </button>
        {/* Pruebas (migración 053): exclusiva del dueño de la
            plataforma -- ni el botón existe para un admin común. */}
        {esDuenoPlataforma && (
          <button
            type="button"
            className={`admin-tab ${tab === "pruebas" ? "active" : ""}`}
            onClick={() => setTab("pruebas")}
          >
            Pruebas
          </button>
        )}
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

          {/* Eliminar cualquier torneo de forma permanente (migración
              062): a diferencia de la lista de arriba (torneos públicos
              sin confirmar), esto busca entre TODOS los torneos, tengan
              o no participantes. */}
          <h3 className="detail-subtitle">Eliminar un torneo</h3>
          <form className="auth-form" onSubmit={handleBuscarTorneos}>
            {errorBusquedaTorneo && <div className="form-error">{errorBusquedaTorneo}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="admin-torneo-nombre">
                Nombre del torneo
              </label>
              <input
                id="admin-torneo-nombre"
                className="form-input"
                type="text"
                value={busquedaNombreTorneo}
                onChange={(e) => setBusquedaNombreTorneo(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-ghost btn-block" disabled={buscandoTorneos}>
              {buscandoTorneos ? "Buscando..." : "Buscar"}
            </button>
          </form>

          {torneosEncontrados.length > 0 && (
            <div className="admin-list">
              {torneosEncontrados.map((t) => (
                <div key={t.id} className="admin-row">
                  <div className="admin-row-info">
                    <p className="admin-row-title">{t.nombre}</p>
                    <p className="admin-row-meta">
                      {t.formato} · {t.modo} · {t.cupos_ocupados}/{t.cupos_totales} inscritos · {t.estado}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={eliminandoTorneo === t.id}
                    onClick={() => handleEliminarTorneo(t)}
                  >
                    {eliminandoTorneo === t.id ? "Eliminando..." : "Eliminar definitivamente"}
                  </button>
                </div>
              ))}
            </div>
          )}
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
                  {usuario.suspendido && (
                    <p className="admin-row-meta">
                      Suspendido por {usuario.suspendido_por_nick ?? "un administrador"}
                      {usuario.suspendido_en && ` el ${formatFecha(usuario.suspendido_en)}`}
                      {usuario.suspendido_motivo && ` -- Motivo: ${usuario.suspendido_motivo}`}
                    </p>
                  )}
                  {erroresSuspender[usuario.id] && (
                    <div className="form-error">{erroresSuspender[usuario.id]}</div>
                  )}
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
                  {!usuario.suspendido && (
                    <input
                      className="form-input"
                      type="text"
                      placeholder="Motivo de la suspensión"
                      value={motivosSuspension[usuario.id] ?? ""}
                      onChange={(e) =>
                        setMotivosSuspension((prev) => ({ ...prev, [usuario.id]: e.target.value }))
                      }
                    />
                  )}
                  <button
                    type="button"
                    className={`btn ${usuario.suspendido ? "btn-primary" : "btn-ghost"}`}
                    disabled={guardandoUsuario === usuario.id}
                    onClick={() => handleSuspender(usuario.id, !usuario.suspendido)}
                  >
                    {usuario.suspendido ? "Reactivar" : "Suspender"}
                  </button>

                  {/* Dar de baja cuenta (migración 062): borra los datos
                      personales, la saca de sus equipos y bloquea su
                      correo para que no pueda volver a registrarse --
                      distinto de "Suspender" (reversible, no borra nada). */}
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Motivo de la baja (opcional)"
                    value={motivosBaja[usuario.id] ?? ""}
                    onChange={(e) => setMotivosBaja((prev) => ({ ...prev, [usuario.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={dandoDeBaja === usuario.id}
                    onClick={() => handleDarDeBaja(usuario.id, usuario.email)}
                  >
                    {dandoDeBaja === usuario.id ? "Dando de baja..." : "Dar de baja cuenta"}
                  </button>
                  {erroresBaja[usuario.id] && <div className="form-error">{erroresBaja[usuario.id]}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "equipos" && (
        <div className="admin-panel">
          <form className="auth-form" onSubmit={handleBuscarEquipo}>
            {errorBusquedaEquipo && <div className="form-error">{errorBusquedaEquipo}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="admin-equipo-tag">
                Tag del equipo
              </label>
              <input
                id="admin-equipo-tag"
                className="form-input"
                type="text"
                placeholder="QSQD"
                value={busquedaTagEquipo}
                onChange={(e) => setBusquedaTagEquipo(e.target.value.toUpperCase())}
              />
            </div>
            <button type="submit" className="btn btn-ghost btn-block" disabled={buscandoEquipo}>
              {buscandoEquipo ? "Buscando..." : "Buscar"}
            </button>
          </form>

          {equipoEncontrado && (
            <div className="admin-row">
              <div className="admin-row-info">
                <p className="admin-row-title">
                  {equipoEncontrado.name} <span className="profile-nick-id">[{equipoEncontrado.tag}]</span>
                </p>
                <p className="admin-row-meta">{equipoEncontrado.disuelto ? "Disuelto" : "Activo"}</p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={eliminandoEquipo}
                onClick={handleEliminarEquipo}
              >
                {eliminandoEquipo ? "Eliminando..." : "Eliminar definitivamente"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "clanwars" && (
        <div className="admin-panel">
          <p className="tournament-card-meta">
            Clan Wars confirmadas o en curso. {esDuenoPlataforma
              ? "Elige una para entrar a su lineup y actuar en nombre de cualquiera de los dos equipos."
              : "Solo el dueño de la plataforma puede intervenir un lineup -- acá se puede ver el listado y qué Clan Wars ya fueron intervenidas."}
          </p>
          {errorClanWarsAdmin && <div className="form-error">{errorClanWarsAdmin}</div>}
          {cargandoClanWarsAdmin && <p className="tournament-card-meta">Cargando Clan Wars...</p>}
          {!cargandoClanWarsAdmin && clanWarsAdmin.length === 0 && (
            <p className="tournament-card-meta">No hay ninguna Clan War confirmada o en curso.</p>
          )}

          <div className="admin-list">
            {clanWarsAdmin.map((cw) => (
              <div key={cw.id} className="admin-row admin-row-clanwar">
                <div className="admin-row-info" onClick={() => handleSeleccionarClanWar(cw.id)} style={{ cursor: "pointer" }}>
                  <p className="admin-row-title">
                    {cw.challengerNombre} vs {cw.challengedNombre}
                  </p>
                  <p className="admin-row-meta">
                    {cw.status} · {cw.formato === "wtl" ? "WTL" : "Simple"} · {formatFecha(cw.fechaHoraCet)}
                  </p>
                  <p className="admin-row-meta">
                    Visto bueno: {cw.challengerNombre} {cw.lineupVistoBuenoChallenger ? "✓" : "✗"} ·{" "}
                    {cw.challengedNombre} {cw.lineupVistoBuenoChallenged ? "✓" : "✗"}
                  </p>
                  {cw.intervenidoPorAdmin && (
                    <p className="clan-war-intervenido-aviso">Intervenido por administración de la plataforma</p>
                  )}
                </div>

                {esDuenoPlataforma && clanWarSeleccionada === cw.id && (
                  <div className="admin-row-info">
                    {errorIntervencion && <div className="form-error">{errorIntervencion}</div>}

                    <div className="pill-radio-group">
                      <label className={`pill-radio-option ${equipoActuarComo === cw.challengerTeamId ? "selected" : ""}`}>
                        <input
                          type="radio"
                          className="sr-only"
                          name={`actuar-como-${cw.id}`}
                          checked={equipoActuarComo === cw.challengerTeamId}
                          onChange={() => handleElegirEquipoActuarComo(cw, cw.challengerTeamId)}
                        />
                        Actuar como {cw.challengerNombre}
                      </label>
                      <label className={`pill-radio-option ${equipoActuarComo === cw.challengedTeamId ? "selected" : ""}`}>
                        <input
                          type="radio"
                          className="sr-only"
                          name={`actuar-como-${cw.id}`}
                          checked={equipoActuarComo === cw.challengedTeamId}
                          onChange={() => handleElegirEquipoActuarComo(cw, cw.challengedTeamId)}
                        />
                        Actuar como {cw.challengedNombre}
                      </label>
                    </div>

                    {equipoActuarComo && (
                      <>
                        {cargandoLineupIntervencion ? (
                          <p className="tournament-card-meta">Cargando lineup...</p>
                        ) : (
                          <>
                            {lineupIntervencion.length === 0 ? (
                              <p className="detail-empty">Todavía no hay jugadores en el lineup de este equipo.</p>
                            ) : (
                              <div className="detail-participant-list">
                                {lineupIntervencion.map((entry) => (
                                  <div key={entry.id} className="detail-participant-item">
                                    {entry.nombre}
                                    {entry.posicion && ` (posición ${entry.posicion})`}
                                    <button
                                      type="button"
                                      className="btn btn-ghost"
                                      disabled={interviniendo}
                                      onClick={() => handleQuitarLineupIntervencion(cw, entry.id)}
                                    >
                                      Quitar
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="form-group">
                              <label className="form-label" htmlFor={`admin-lineup-jugador-${cw.id}`}>
                                Agregar jugador
                              </label>
                              <select
                                id={`admin-lineup-jugador-${cw.id}`}
                                className="form-select"
                                value={jugadorNuevoIntervencion}
                                onChange={(e) => setJugadorNuevoIntervencion(e.target.value)}
                              >
                                <option value="">Selecciona un jugador</option>
                                {rosterIntervencion.map((r) => (
                                  <option key={r.jugadorId} value={r.jugadorId}>
                                    {r.nombre}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {cw.formato === "wtl" && (
                              <div className="form-group">
                                <label className="form-label" htmlFor={`admin-lineup-posicion-${cw.id}`}>
                                  Posición (1, 2 o 3)
                                </label>
                                <select
                                  id={`admin-lineup-posicion-${cw.id}`}
                                  className="form-select"
                                  value={posicionNuevoIntervencion}
                                  onChange={(e) => setPosicionNuevoIntervencion(e.target.value)}
                                >
                                  <option value="">Selecciona la posición</option>
                                  <option value="1">Posición 1</option>
                                  <option value="2">Posición 2</option>
                                  <option value="3">Posición 3</option>
                                </select>
                              </div>
                            )}
                            <div className="admin-row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={interviniendo || !jugadorNuevoIntervencion}
                                onClick={() => handleAgregarLineupIntervencion(cw)}
                              >
                                Agregar al lineup
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={interviniendo}
                                onClick={() => handleConfirmarVistoBuenoIntervencion(cw)}
                              >
                                Confirmar visto bueno
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
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
        </div>
      )}

      {tab === "reportes" && (
        <div className="admin-panel">
          {errorReportes && <div className="form-error">{errorReportes}</div>}
          {cargandoReportes && <p className="tournament-card-meta">Cargando reportes...</p>}
          {!cargandoReportes && reportes.length === 0 && (
            <p className="tournament-card-meta">No hay reportes.</p>
          )}
          <div className="admin-list">
            {reportes.map((r) => (
              <div key={r.id} className="admin-row">
                <div className="admin-row-info">
                  <p className="admin-row-title">{r.asunto}</p>
                  <p className="admin-row-meta">
                    {r.reportadoPorNombre} · {formatFecha(r.createdAt)}
                  </p>
                  <p className="admin-row-meta">{r.descripcion}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "alianzas" && (
        <div className="admin-panel">
          {errorAlianzas && <div className="form-error">{errorAlianzas}</div>}
          {cargandoAlianzas && <p className="tournament-card-meta">Cargando alianzas...</p>}
          {!cargandoAlianzas && alianzas.length === 0 && (
            <p className="tournament-card-meta">No hay ninguna alianza pendiente de aprobación.</p>
          )}
          <div className="admin-list">
            {alianzas.map((a) => (
              <div key={a.id} className="admin-row">
                <div className="admin-row-info">
                  <p className="admin-row-title">
                    {a.equipoANombre} + {a.equipoBNombre}
                  </p>
                  <p className="admin-row-meta">
                    {a.temporadaNombre} · Propuesta el {formatFecha(a.createdAt)}
                  </p>
                  {erroresAlianza[a.id] && <div className="form-error">{erroresAlianza[a.id]}</div>}
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={resolviendoAlianza === a.id}
                    onClick={() => handleResolverAlianza(a.id, true)}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resolviendoAlianza === a.id}
                    onClick={() => handleResolverAlianza(a.id, false)}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "pruebas" && esDuenoPlataforma && (
        <div className="admin-panel">
          <h3 className="detail-subtitle">Salas de lineup</h3>
          <p className="tournament-card-meta">
            Genera un escenario de Clan War de prueba (2 equipos ficticios, 4 jugadores cada uno) para
            observar la sala de lineup -- armado, check-in y fondo -- sin ser parte de ninguno de los dos
            equipos. Ver esta sala no genera ningún registro ni notificación: es una consulta de solo
            lectura, no existe ningún mecanismo en la base que registre quién mira un reto.
          </p>

          {errorEscenario && <div className="form-error">{errorEscenario}</div>}

          <div className="admin-row-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={generandoEscenario}
              onClick={handleGenerarEscenario}
            >
              {generandoEscenario ? "Generando..." : "Generar escenario de prueba"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={limpiando}
              onClick={handleLimpiarEscenarios}
            >
              {limpiando ? "Limpiando..." : "Limpiar escenarios de prueba"}
            </button>
          </div>

          {escenarioGenerado && (
            <div className="admin-row">
              <div className="admin-row-info">
                <p className="admin-row-title">
                  {escenarioGenerado.team_a_tag} vs {escenarioGenerado.team_b_tag} -- reto ya aceptado
                </p>
                <p className="admin-row-meta">
                  Ventana de check-in ya abierta. Entra a observar la sala de lineup:
                </p>
                <Link
                  className="btn-link"
                  to={`/pruebas/lineup/${escenarioGenerado.clan_war_id}`}
                >
                  Ver sala de lineup
                </Link>
              </div>
            </div>
          )}

          {errorLimpieza && <div className="form-error">{errorLimpieza}</div>}

          {resultadoLimpieza && (
            <p className="tournament-card-meta">
              Se borraron {resultadoLimpieza.equipos} equipo(s), {resultadoLimpieza.retos} reto(s) de
              Clan War y {resultadoLimpieza.cuentas} cuenta(s) ficticia(s). No queda ningún rastro del
              escenario de prueba.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
