import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { recortarImagenCuadrada, recortarImagenConProporcion } from "../lib/teams";
import { formatFecha } from "../lib/formatters";
import { SC2_REGION_OPTIONS } from "../types/profile";
import type { AvatarForma } from "../types/profile";
import { CLAN_WAR_MOTIVO_RECHAZO_OPTIONS, CLAN_WAR_REPORTE_MOTIVO_OPTIONS, TEMAS_EQUIPO } from "../types/teams";
import type { ClanWarMotivoRechazo, ClanWarReporteMotivo, ClanWarStatus, TeamRow, TemaEquipo } from "../types/teams";
import { NICK_REGEX, validarNick } from "../lib/nickValidation";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";
import { datetimeLocalAIso, dentroDeVentanaCheckIn, formatearHoraCet, formatearHoraLocal } from "../lib/clanWars";
import type { InvestigacionJugador } from "../types/investigacion";
import Avatar from "../components/Avatar";
import LigaBadge from "../components/LigaBadge";
import MmrProgressBar from "../components/MmrProgressBar";
import PercentBar from "../components/PercentBar";
import InvestigacionJugadorPanel from "../components/InvestigacionJugadorPanel";
import TitulosActivosList from "../components/TitulosActivosList";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BANNER_MAX_BYTES = 3 * 1024 * 1024;

interface MiembroConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
  // Liga autodeclarada por el jugador en /perfil (independiente del
  // MMR calculado, ver types/profile.ts) -- se muestra aparte.
  liga: string | null;
  // MMR/liga de equipos (migración 020): el rating personal de este
  // jugador jugando en formato de equipo, no su MMR de 1v1.
  mmrEquipos: number;
  ligaEquipos: string;
  bancaRota: boolean;
  // Valentía y Responsabilidad -- Fase 1 (migración 024).
  valentiaJugador: number;
  responsabilidadCw: number;
  pocoConfiable: boolean;
  roles: string[];
  // Perfil de juego de StarCraft II (migración 034) -- opcional, puede
  // no existir todavía para este jugador.
  razaPrincipal: RazaSc2 | null;
  razaSecundaria: RazaSc2 | null;
}

interface JugadorEncontrado {
  id: string;
  nick: string;
  uniqueId: string;
  avatarUrl: string | null;
  avatarForma: AvatarForma;
}

interface ExpulsadoConNombre {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  kickedAt: string;
}

interface ClanWarConNombres {
  id: string;
  challengerTeamId: string;
  challengerNombre: string;
  challengedTeamId: string;
  challengedNombre: string;
  fechaHoraCet: string;
  status: ClanWarStatus;
  motivoRechazo: ClanWarMotivoRechazo | null;
  motivoDetalle: string | null;
  // Fase 2 (migración 022, check-in).
  challengerConfirmado: boolean;
  challengedConfirmado: boolean;
  casterNombre: string | null;
  casterLink: string | null;
  tieneDelay: boolean | null;
  // Fase 3 (migración 023, resultado).
  challengerCierreConfirmado: boolean;
  challengedCierreConfirmado: boolean;
  ganadorTeamId: string | null;
}

interface MiembroRoster {
  userId: string;
  nick: string | null;
  uniqueId: string | null;
  sc2Id: string | null;
  razaPrincipal: RazaSc2 | null;
  razaSecundaria: RazaSc2 | null;
}

interface ReporteConNombres {
  id: string;
  reportadoPorNombre: string;
  jugadorAfectadoId: string;
  jugadorAfectadoNombre: string;
  motivo: ClanWarReporteMotivo;
  createdAt: string;
}

interface PartidaConNombres {
  id: string;
  jugadorChallengerId: string;
  jugadorChallengerNombre: string;
  jugadorChallengedId: string;
  jugadorChallengedNombre: string;
  ganadorId: string | null;
  status: "pendiente" | "jugado";
}

interface SolicitudHistoricaConNombre {
  id: string;
  torneoNombre: string;
}

interface TituloConNombre {
  id: string;
  retadorId: string;
  retadorNombre: string;
  retadoId: string;
  retadoNombre: string;
  duracionDias: number;
  aceptado: boolean;
}

interface TempPlayerConNombre {
  id: string;
  nickTemporal: string;
  reemplazadoPorId: string | null;
  reemplazadoPorNick: string | null;
  reemplazadoPorUniqueId: string | null;
  reemplazadoPorAvatarUrl: string | null;
  reemplazadoPorAvatarForma: AvatarForma;
}

interface TorneoParticipadoConResultado {
  id: string;
  nombre: string;
  fechaInicio: string;
  resultado: string;
}

// Las secciones del Panel de control (más el acceso directo a Hall of
// Fame, que no es una sección con contenido propio, solo un link).
// null = se ve el menú con las tarjetas, no una sección puntual.
type SeccionPanel = "configuracion" | "editar-equipo" | "eventos" | "logros" | "reportar";

// team_kicks_log.user_id apunta a profiles.id, igual que
// team_members.user_id -- mismo patrón de extracción.
function extraerPerfilBasico(profiles: unknown): { nick: string | null; unique_id: string | null } {
  const perfil = Array.isArray(profiles) ? profiles[0] : profiles;
  return {
    nick: (perfil as { nick?: string } | undefined)?.nick ?? null,
    unique_id: (perfil as { unique_id?: string } | undefined)?.unique_id ?? null,
  };
}

// team_members.user_id apunta a profiles.id (no a auth.users como
// tournament_participants), así que acá sí hay join automático de
// PostgREST -- no hace falta una segunda consulta aparte.
function extraerPerfil(profiles: unknown): {
  nick: string | null;
  unique_id: string | null;
  avatar_url: string | null;
  avatar_forma: AvatarForma;
  liga: string | null;
  mmr_equipos: number;
  liga_equipos: string;
  banca_rota: boolean;
  valentia_jugador: number;
  responsabilidad_cw: number;
  poco_confiable: boolean;
} {
  const perfil = Array.isArray(profiles) ? profiles[0] : profiles;
  return {
    nick: (perfil as { nick?: string } | undefined)?.nick ?? null,
    unique_id: (perfil as { unique_id?: string } | undefined)?.unique_id ?? null,
    avatar_url: (perfil as { avatar_url?: string } | undefined)?.avatar_url ?? null,
    avatar_forma: (perfil as { avatar_forma?: AvatarForma } | undefined)?.avatar_forma ?? "cuadrado",
    liga: (perfil as { liga?: string } | undefined)?.liga ?? null,
    mmr_equipos: (perfil as { mmr_equipos?: number } | undefined)?.mmr_equipos ?? 1000,
    liga_equipos: (perfil as { liga_equipos?: string } | undefined)?.liga_equipos ?? "Bronce 3",
    banca_rota: (perfil as { banca_rota?: boolean } | undefined)?.banca_rota ?? false,
    valentia_jugador: (perfil as { valentia_jugador?: number } | undefined)?.valentia_jugador ?? 50,
    responsabilidad_cw: (perfil as { responsabilidad_cw?: number } | undefined)?.responsabilidad_cw ?? 100,
    poco_confiable: (perfil as { poco_confiable?: boolean } | undefined)?.poco_confiable ?? false,
  };
}

export default function TeamDetailPage() {
  const { tag } = useParams<{ tag: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [equipo, setEquipo] = useState<TeamRow | null>(null);
  const [miembros, setMiembros] = useState<MiembroConNombre[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // --- Panel de líder: editar descripción/logo/banner ---
  const [descEquipo, setDescEquipo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardandoEquipo, setGuardandoEquipo] = useState(false);
  const [errorEquipo, setErrorEquipo] = useState<string | null>(null);
  const [equipoGuardado, setEquipoGuardado] = useState(false);

  // --- Panel de control: código de invitación y quitar miembros ---
  const [codigoCopiado, setCodigoCopiado] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null);
  // El panel entero vive colapsado atrás de un botón -- nada de esto
  // se ve desperdigado en la página, solo cuando el dueño lo abre.
  // Adentro, el panel es un menú de 5 secciones (más "configuracion");
  // seccionPanel === null muestra el menú, no una sección puntual.
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [seccionPanel, setSeccionPanel] = useState<SeccionPanel | null>(null);

  // --- Salir del equipo (cualquier miembro que no sea el dueño, o el
  // dueño cuando es el único miembro que queda) ---
  const [saliendo, setSaliendo] = useState(false);
  const [errorSalir, setErrorSalir] = useState<string | null>(null);

  // --- Equipo disuelto: eliminarlo definitivamente (migración 028) ---
  const [eliminandoEquipoDefinitivo, setEliminandoEquipoDefinitivo] = useState(false);
  const [errorEliminarEquipo, setErrorEliminarEquipo] = useState<string | null>(null);

  // --- Panel de control: transferir liderazgo ---
  const [nuevoLiderId, setNuevoLiderId] = useState("");
  const [transfiriendo, setTransfiriendo] = useState(false);
  const [errorTransferir, setErrorTransferir] = useState<string | null>(null);

  // --- Panel de control: buscar e invitar por Nick#ID ---
  const [busquedaNick, setBusquedaNick] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [resultadoBusqueda, setResultadoBusqueda] = useState<JugadorEncontrado | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [invitacionEnviada, setInvitacionEnviada] = useState(false);

  // --- Panel de control: investigar jugador (solo para líderes de
  // clan o administradores -- el chequeo real vive en la base). ---
  const [investigando, setInvestigando] = useState(false);
  const [errorInvestigacion, setErrorInvestigacion] = useState<string | null>(null);
  const [investigacion, setInvestigacion] = useState<InvestigacionJugador | null>(null);

  // --- Panel de control: jugadores expulsados ---
  const [expulsados, setExpulsados] = useState<ExpulsadoConNombre[]>([]);

  // --- Panel de control: Clan Wars ---
  const [retosPendientesResponder, setRetosPendientesResponder] = useState<ClanWarConNombres[]>([]);
  const [retosPropuestosPorMi, setRetosPropuestosPorMi] = useState<ClanWarConNombres[]>([]);
  const [historialRetos, setHistorialRetos] = useState<ClanWarConNombres[]>([]);

  const [tagRivalReto, setTagRivalReto] = useState("");
  const [fechaHoraReto, setFechaHoraReto] = useState("");
  const [proponiendoReto, setProponiendoReto] = useState(false);
  const [errorReto, setErrorReto] = useState<string | null>(null);
  const [retoEnviado, setRetoEnviado] = useState(false);

  const [respondiendoReto, setRespondiendoReto] = useState<string | null>(null);
  const [erroresResponderReto, setErroresResponderReto] = useState<Record<string, string>>({});
  const [motivoRechazoPorReto, setMotivoRechazoPorReto] = useState<Record<string, ClanWarMotivoRechazo | "">>({});
  const [detalleRechazoPorReto, setDetalleRechazoPorReto] = useState<Record<string, string>>({});

  // --- Panel de control: Clan Wars, retos activos (aceptados o en
  // curso) -- check-in, roster de ambos equipos, reportes, datos de
  // transmisión, partidas individuales y cierre ---
  const [retosActivos, setRetosActivos] = useState<ClanWarConNombres[]>([]);
  // Por team_id (no por reto): un reto en curso necesita el roster de
  // los DOS equipos -- el rival para el check-in, y los dos para
  // elegir jugadores al agregar una partida.
  const [rosterPorTeamId, setRosterPorTeamId] = useState<Record<string, MiembroRoster[]>>({});
  const [reportesPorReto, setReportesPorReto] = useState<Record<string, ReporteConNombres[]>>({});
  const [partidasPorReto, setPartidasPorReto] = useState<Record<string, PartidaConNombres[]>>({});
  // Se recalcula cada 30 segundos -- así la ventana de check-in
  // aparece sola cuando corresponde, sin que haga falta recargar la
  // página a mano.
  const [ahora, setAhora] = useState(Date.now());

  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erroresConfirmar, setErroresConfirmar] = useState<Record<string, string>>({});

  const [jugadorReportadoPorReto, setJugadorReportadoPorReto] = useState<Record<string, string>>({});
  const [motivoReportePorReto, setMotivoReportePorReto] = useState<Record<string, ClanWarReporteMotivo | "">>({});
  const [reportando, setReportando] = useState<string | null>(null);
  const [erroresReportar, setErroresReportar] = useState<Record<string, string>>({});

  const [casterNombrePorReto, setCasterNombrePorReto] = useState<Record<string, string>>({});
  const [casterLinkPorReto, setCasterLinkPorReto] = useState<Record<string, string>>({});
  const [tieneDelayPorReto, setTieneDelayPorReto] = useState<Record<string, string>>({});
  const [guardandoTransmision, setGuardandoTransmision] = useState<string | null>(null);
  const [erroresTransmision, setErroresTransmision] = useState<Record<string, string>>({});

  // --- Panel de control: Clan Wars, partidas individuales y cierre ---
  const [jugadorChallengerPorReto, setJugadorChallengerPorReto] = useState<Record<string, string>>({});
  const [jugadorChallengedPorReto, setJugadorChallengedPorReto] = useState<Record<string, string>>({});
  const [agregandoPartida, setAgregandoPartida] = useState<string | null>(null);
  const [erroresAgregarPartida, setErroresAgregarPartida] = useState<Record<string, string>>({});

  const [reportandoPartida, setReportandoPartida] = useState<string | null>(null);
  const [erroresReportarPartida, setErroresReportarPartida] = useState<Record<string, string>>({});

  const [cerrando, setCerrando] = useState<string | null>(null);
  const [erroresCerrar, setErroresCerrar] = useState<Record<string, string>>({});

  // --- Panel de control: Títulos Padre/Hijo entre clanes ---
  const [titulosPendientesResponder, setTitulosPendientesResponder] = useState<TituloConNombre[]>([]);
  const [titulosPropuestosPorMi, setTitulosPropuestosPorMi] = useState<TituloConNombre[]>([]);
  const [tagRivalTitulo, setTagRivalTitulo] = useState("");
  const [duracionTitulo, setDuracionTitulo] = useState("30");
  const [proponiendoTitulo, setProponiendoTitulo] = useState(false);
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const [tituloEnviado, setTituloEnviado] = useState(false);
  const [respondiendoTitulo, setRespondiendoTitulo] = useState<string | null>(null);
  const [erroresResponderTitulo, setErroresResponderTitulo] = useState<Record<string, string>>({});

  // --- Panel de control: Torneos Históricos, consentimiento pendiente ---
  const [solicitudesHistoricas, setSolicitudesHistoricas] = useState<SolicitudHistoricaConNombre[]>([]);
  const [respondiendoHistorico, setRespondiendoHistorico] = useState<string | null>(null);
  const [erroresResponderHistorico, setErroresResponderHistorico] = useState<Record<string, string>>({});

  // --- Mi historial de eventos: torneos (dentro de la plataforma) en
  // los que participó este equipo, ya finalizados, con su resultado ---
  const [torneosParticipados, setTorneosParticipados] = useState<TorneoParticipadoConResultado[]>([]);

  // --- Apariencia del equipo: 7 paletas fijas (migración 033) ---
  const [guardandoTema, setGuardandoTema] = useState(false);
  const [errorTema, setErrorTema] = useState<string | null>(null);

  // --- Jugador temporal (migración 033) ---
  const [jugadoresTemporales, setJugadoresTemporales] = useState<TempPlayerConNombre[]>([]);
  const [nickTemporalNuevo, setNickTemporalNuevo] = useState("");
  const [creandoTemporal, setCreandoTemporal] = useState(false);
  const [errorTemporal, setErrorTemporal] = useState<string | null>(null);
  const [busquedaReemplazoPorTemp, setBusquedaReemplazoPorTemp] = useState<Record<string, string>>({});
  const [reemplazandoTemp, setReemplazandoTemp] = useState<string | null>(null);
  const [erroresReemplazoPorTemp, setErroresReemplazoPorTemp] = useState<Record<string, string>>({});

  // --- Logros y Recompensas: solo vitrina, sin catálogo real todavía
  // (ver el comentario largo en migration_033_tema_temporal_logros_ayuda.sql) ---
  const [vistaLogros, setVistaLogros] = useState<"desbloqueados" | "compradas">("desbloqueados");

  // --- Reportar un problema al staff ---
  const [asuntoReporte, setAsuntoReporte] = useState("");
  const [descripcionReporte, setDescripcionReporte] = useState("");
  const [enviandoReporte, setEnviandoReporte] = useState(false);
  const [errorReporte, setErrorReporte] = useState<string | null>(null);
  const [reporteEnviado, setReporteEnviado] = useState(false);

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(intervalo);
  }, []);

  const cargar = async () => {
    if (!tag) return;

    const { data: equipoData, error } = await supabase
      .from("teams")
      .select("*")
      .eq("tag", tag.toUpperCase())
      .maybeSingle();

    if (error || !equipoData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Se evalúa acá, cada vez que se entra a la página del equipo --
    // si este equipo lleva 30 días en banca rota sin actividad, lo
    // restaura a 1000 MMR antes de mostrar sus datos. Mismo patrón
    // que restaurar_banca_rota_perfil() en AuthContext: no hace falta
    // un cron, la función no hace nada si todavía no corresponde.
    // Solo tiene sentido si hay sesión (la función es authenticated).
    if (user) {
      await supabase.rpc("restaurar_banca_rota_equipo", { p_team_id: equipoData.id });
      // Títulos Padre/Hijo (migración 026): mismo patrón, se evalúa al
      // toque, sin cron -- un título vencido deja de mostrarse como
      // activo. Barrido global, no depende de este equipo puntual.
      await supabase.rpc("expirar_titulos_vencidos");
      const { data: equipoActualizado } = await supabase
        .from("teams")
        .select("*")
        .eq("id", equipoData.id)
        .single();
      if (equipoActualizado) Object.assign(equipoData, equipoActualizado);
    }

    setEquipo(equipoData as TeamRow);
    setDescEquipo(equipoData.description ?? "");

    const { data: miembrosData } = await supabase
      .from("team_members")
      .select(
        "user_id, roles, profiles(nick, unique_id, avatar_url, avatar_forma, liga, mmr_equipos, liga_equipos, banca_rota, valentia_jugador, responsabilidad_cw, poco_confiable)"
      )
      .eq("team_id", equipoData.id)
      .order("joined_at", { ascending: true });

    const miembrosBase: MiembroConNombre[] = (miembrosData ?? []).map((m) => {
      const perfil = extraerPerfil(m.profiles);
      return {
        userId: m.user_id,
        nick: perfil.nick,
        uniqueId: perfil.unique_id,
        avatarUrl: perfil.avatar_url,
        avatarForma: perfil.avatar_forma,
        liga: perfil.liga,
        mmrEquipos: perfil.mmr_equipos,
        ligaEquipos: perfil.liga_equipos,
        bancaRota: perfil.banca_rota,
        valentiaJugador: perfil.valentia_jugador,
        responsabilidadCw: perfil.responsabilidad_cw,
        pocoConfiable: perfil.poco_confiable,
        roles: m.roles as string[],
        razaPrincipal: null,
        razaSecundaria: null,
      };
    });

    // Raza de StarCraft II (migración 034): opcional para cada
    // miembro -- se resuelve el juego_id una vez y se completa acá,
    // en vez de embeber perfiles_juego en la consulta de arriba.
    const idSc2 = await obtenerJuegoIdSc2();
    if (idSc2 && miembrosBase.length > 0) {
      const { data: razasData } = await supabase
        .from("perfiles_juego")
        .select("user_id, datos")
        .eq("juego_id", idSc2)
        .in(
          "user_id",
          miembrosBase.map((m) => m.userId)
        );

      const razaPorUserId: Record<string, DatosSc2> = Object.fromEntries(
        (razasData ?? []).map((r) => [r.user_id, r.datos as DatosSc2])
      );

      for (const m of miembrosBase) {
        const datos = razaPorUserId[m.userId];
        m.razaPrincipal = datos?.raza_principal ?? null;
        m.razaSecundaria = datos?.raza_secundaria ?? null;
      }
    }

    setMiembros(miembrosBase);

    // Jugadores temporales (migración 033): públicos, igual que el
    // resto del roster -- si ya fueron reemplazados, se resuelve acá
    // el perfil real de una vez, para no repreguntar en el render.
    const { data: temporalesData } = await supabase
      .from("team_temp_players")
      .select("id, nick_temporal, reemplazado_por, profiles!reemplazado_por(nick, unique_id, avatar_url, avatar_forma)")
      .eq("team_id", equipoData.id)
      .order("created_at", { ascending: true });

    setJugadoresTemporales(
      (temporalesData ?? []).map((t) => {
        const perfil = t.reemplazado_por
          ? (Array.isArray(t.profiles) ? t.profiles[0] : t.profiles)
          : null;
        const p = perfil as
          | { nick: string | null; unique_id: string | null; avatar_url: string | null; avatar_forma: AvatarForma }
          | null;
        return {
          id: t.id,
          nickTemporal: t.nick_temporal,
          reemplazadoPorId: t.reemplazado_por,
          reemplazadoPorNick: p?.nick ?? null,
          reemplazadoPorUniqueId: p?.unique_id ?? null,
          reemplazadoPorAvatarUrl: p?.avatar_url ?? null,
          reemplazadoPorAvatarForma: p?.avatar_forma ?? "cuadrado",
        };
      })
    );

    // Solo el dueño ve el historial de expulsados (la RLS de
    // team_kicks_log ya lo exige igual, esto es solo para no pedirlo
    // de más cuando no hace falta).
    if (user && equipoData.owner_id === user.id) {
      const { data: expulsadosData } = await supabase
        .from("team_kicks_log")
        .select("user_id, kicked_at, profiles!user_id(nick, unique_id)")
        .eq("team_id", equipoData.id)
        .order("kicked_at", { ascending: false });

      setExpulsados(
        (expulsadosData ?? []).map((e) => {
          const perfil = extraerPerfilBasico(e.profiles);
          return {
            userId: e.user_id,
            nick: perfil.nick,
            uniqueId: perfil.unique_id,
            kickedAt: e.kicked_at,
          };
        })
      );

      // Clan Wars: tanto los retos que le propusieron a este equipo
      // como los que este equipo propuso -- la RLS de clan_wars ya
      // exige ser dueño de uno de los dos equipos involucrados, esto
      // de acá es solo para no pedirlo de más cuando no hace falta.
      const { data: retosData } = await supabase
        .from("clan_wars")
        .select("*")
        .or(`challenger_team_id.eq.${equipoData.id},challenged_team_id.eq.${equipoData.id}`)
        .order("created_at", { ascending: false });

      const teamIdsRetos = [
        ...new Set((retosData ?? []).flatMap((r) => [r.challenger_team_id, r.challenged_team_id])),
      ];
      let nombrePorTeamIdReto: Record<string, string> = {};
      if (teamIdsRetos.length > 0) {
        const { data: equiposRetoData } = await supabase
          .from("teams")
          .select("id, name, tag")
          .in("id", teamIdsRetos);
        nombrePorTeamIdReto = Object.fromEntries(
          (equiposRetoData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`])
        );
      }

      const retosResueltos: ClanWarConNombres[] = (retosData ?? []).map((r) => ({
        id: r.id,
        challengerTeamId: r.challenger_team_id,
        challengerNombre: nombrePorTeamIdReto[r.challenger_team_id] ?? "Equipo",
        challengedTeamId: r.challenged_team_id,
        challengedNombre: nombrePorTeamIdReto[r.challenged_team_id] ?? "Equipo",
        fechaHoraCet: r.fecha_hora_cet,
        status: r.status,
        motivoRechazo: r.motivo_rechazo,
        motivoDetalle: r.motivo_detalle,
        challengerConfirmado: r.challenger_confirmado,
        challengedConfirmado: r.challenged_confirmado,
        casterNombre: r.caster_nombre,
        casterLink: r.caster_link,
        tieneDelay: r.tiene_delay,
        challengerCierreConfirmado: r.challenger_cierre_confirmado,
        challengedCierreConfirmado: r.challenged_cierre_confirmado,
        ganadorTeamId: r.ganador_team_id,
      }));

      setRetosPendientesResponder(
        retosResueltos.filter((r) => r.status === "pendiente" && r.challengedTeamId === equipoData.id)
      );
      setRetosPropuestosPorMi(
        retosResueltos.filter((r) => r.status === "pendiente" && r.challengerTeamId === equipoData.id)
      );

      const activos = retosResueltos.filter((r) => r.status === "aceptada" || r.status === "en_curso");
      setRetosActivos(activos);
      setHistorialRetos(
        retosResueltos.filter(
          (r) => r.status === "rechazada" || r.status === "cancelada" || r.status === "finalizada" || r.status === "empatada"
        )
      );

      // Roster de los DOS equipos de cada reto activo (no solo el
      // rival): hace falta el propio también para elegir jugadores al
      // agregar una partida (Fase 3). Se traen todos de una, la
      // ventana de check-in solo decide qué se muestra, no qué se pide.
      if (activos.length > 0) {
        const teamIdsInvolucrados = [
          ...new Set(activos.flatMap((r) => [r.challengerTeamId, r.challengedTeamId])),
        ];

        const { data: rosterData } = await supabase
          .from("team_members")
          .select("team_id, user_id, profiles(nick, unique_id, sc2_id)")
          .in("team_id", teamIdsInvolucrados);

        // Raza de StarCraft II (migración 034) para cada jugador del
        // roster -- el capitán la necesita a mano en el check-in, para
        // decidir el line-up real contra un rival específico.
        const idSc2ParaRoster = await obtenerJuegoIdSc2();
        let razaPorUserIdRoster: Record<string, DatosSc2> = {};
        if (idSc2ParaRoster) {
          const userIdsRoster = [...new Set((rosterData ?? []).map((f) => f.user_id))];
          const { data: razasRosterData } = await supabase
            .from("perfiles_juego")
            .select("user_id, datos")
            .eq("juego_id", idSc2ParaRoster)
            .in("user_id", userIdsRoster);
          razaPorUserIdRoster = Object.fromEntries(
            (razasRosterData ?? []).map((r) => [r.user_id, r.datos as DatosSc2])
          );
        }

        const rosterPorTeamIdTmp: Record<string, MiembroRoster[]> = {};
        for (const fila of rosterData ?? []) {
          const perfil = fila.profiles as unknown as
            | { nick: string | null; unique_id: string | null; sc2_id: string | null }
            | { nick: string | null; unique_id: string | null; sc2_id: string | null }[]
            | null;
          const p = Array.isArray(perfil) ? perfil[0] : perfil;
          const razaDeFila = razaPorUserIdRoster[fila.user_id];
          const lista = rosterPorTeamIdTmp[fila.team_id] ?? [];
          lista.push({
            userId: fila.user_id,
            nick: p?.nick ?? null,
            uniqueId: p?.unique_id ?? null,
            sc2Id: p?.sc2_id ?? null,
            razaPrincipal: razaDeFila?.raza_principal ?? null,
            razaSecundaria: razaDeFila?.raza_secundaria ?? null,
          });
          rosterPorTeamIdTmp[fila.team_id] = lista;
        }
        setRosterPorTeamId(rosterPorTeamIdTmp);

        const nombrePorUserId: Record<string, string> = {};
        for (const lista of Object.values(rosterPorTeamIdTmp)) {
          for (const m of lista) {
            nombrePorUserId[m.userId] = m.nick
              ? `${m.nick}${m.uniqueId ? `#${m.uniqueId}` : ""}`
              : "Jugador de RemorApp";
          }
        }

        const retoIds = activos.map((r) => r.id);
        const { data: reportesData } = await supabase
          .from("clan_war_reportes")
          .select("id, clan_war_id, reportado_por, jugador_afectado_id, motivo, created_at, profiles!jugador_afectado_id(nick, unique_id)")
          .in("clan_war_id", retoIds)
          .order("created_at", { ascending: false });

        const reportesPorRetoTmp: Record<string, ReporteConNombres[]> = {};
        for (const rep of reportesData ?? []) {
          const perfil = extraerPerfilBasico(rep.profiles);
          const nombreJugador = perfil.nick
            ? `${perfil.nick}${perfil.unique_id ? `#${perfil.unique_id}` : ""}`
            : "Jugador de RemorApp";
          const equipoReportante = nombrePorTeamIdReto[rep.reportado_por] ?? "Equipo";
          const lista = reportesPorRetoTmp[rep.clan_war_id] ?? [];
          lista.push({
            id: rep.id,
            reportadoPorNombre: equipoReportante,
            jugadorAfectadoId: rep.jugador_afectado_id,
            jugadorAfectadoNombre: nombreJugador,
            motivo: rep.motivo,
            createdAt: rep.created_at,
          });
          reportesPorRetoTmp[rep.clan_war_id] = lista;
        }
        setReportesPorReto(reportesPorRetoTmp);

        const { data: partidasData } = await supabase
          .from("clan_war_matches")
          .select("*")
          .in("clan_war_id", retoIds)
          .order("created_at", { ascending: true });

        const partidasPorRetoTmp: Record<string, PartidaConNombres[]> = {};
        for (const p of partidasData ?? []) {
          const lista = partidasPorRetoTmp[p.clan_war_id] ?? [];
          lista.push({
            id: p.id,
            jugadorChallengerId: p.jugador_challenger_id,
            jugadorChallengerNombre: nombrePorUserId[p.jugador_challenger_id] ?? "Jugador de RemorApp",
            jugadorChallengedId: p.jugador_challenged_id,
            jugadorChallengedNombre: nombrePorUserId[p.jugador_challenged_id] ?? "Jugador de RemorApp",
            ganadorId: p.ganador_id,
            status: p.status,
          });
          partidasPorRetoTmp[p.clan_war_id] = lista;
        }
        setPartidasPorReto(partidasPorRetoTmp);
      } else {
        setRosterPorTeamId({});
        setReportesPorReto({});
        setPartidasPorReto({});
      }

      // Títulos Padre/Hijo entre clanes: propuestas pendientes de
      // responder y las mías propias, esperando respuesta -- los
      // títulos ACTIVOS se muestran aparte, públicamente, con
      // TitulosActivosList (no hace falta ser dueño para verlos).
      const { data: titulosData } = await supabase
        .from("titulos_padre_hijo")
        .select("*")
        .eq("tipo", "clan")
        .eq("status", "pendiente")
        .or(`retador_id.eq.${equipoData.id},retado_id.eq.${equipoData.id}`)
        .order("created_at", { ascending: false });

      const teamIdsTitulos = [
        ...new Set((titulosData ?? []).flatMap((t) => [t.retador_id, t.retado_id])),
      ];
      let nombrePorTeamIdTitulo: Record<string, string> = {};
      if (teamIdsTitulos.length > 0) {
        const { data: equiposTituloData } = await supabase
          .from("teams")
          .select("id, name, tag")
          .in("id", teamIdsTitulos);
        nombrePorTeamIdTitulo = Object.fromEntries(
          (equiposTituloData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`])
        );
      }

      const titulosResueltos: TituloConNombre[] = (titulosData ?? []).map((t) => ({
        id: t.id,
        retadorId: t.retador_id,
        retadorNombre: nombrePorTeamIdTitulo[t.retador_id] ?? "Equipo",
        retadoId: t.retado_id,
        retadoNombre: nombrePorTeamIdTitulo[t.retado_id] ?? "Equipo",
        duracionDias: t.duracion_dias,
        aceptado: t.aceptado,
      }));

      setTitulosPendientesResponder(
        titulosResueltos.filter((t) => !t.aceptado && t.retadoId === equipoData.id)
      );
      setTitulosPropuestosPorMi(
        titulosResueltos.filter((t) => t.retadorId === equipoData.id)
      );

      // Torneos Históricos (migración 029): solicitudes de
      // consentimiento pendientes -- "este torneo dice que
      // participaste, ¿aceptas que sea público?".
      const { data: solicitudesData } = await supabase
        .from("historical_tournament_participants")
        .select("id, historical_tournament_id, historical_tournaments(nombre)")
        .eq("team_id", equipoData.id)
        .is("consentimiento", null);

      setSolicitudesHistoricas(
        (solicitudesData ?? []).map((s) => {
          const torneo = Array.isArray(s.historical_tournaments)
            ? s.historical_tournaments[0]
            : s.historical_tournaments;
          return {
            id: s.id,
            torneoNombre: (torneo as { nombre?: string } | undefined)?.nombre ?? "Torneo histórico",
          };
        })
      );

      // Mi historial de eventos: torneos DENTRO de la plataforma en
      // los que participó este equipo, ya finalizados. Solo hace
      // falta el resultado de LA PROPIA fila de participación -- el
      // ranking completo de cada torneo ya se ve en /tournaments/:id.
      const { data: participacionesData } = await supabase
        .from("tournament_participants")
        .select("id, tournaments(id, nombre, fecha_inicio, estado, modo, campeon_participant_id)")
        .eq("team_id", equipoData.id);

      const finalizadas = (participacionesData ?? [])
        .map((p) => {
          const torneo = Array.isArray(p.tournaments) ? p.tournaments[0] : p.tournaments;
          return {
            participantId: p.id as string,
            torneo: torneo as
              | { id: string; nombre: string; fecha_inicio: string; estado: string; modo: string; campeon_participant_id: string | null }
              | undefined,
          };
        })
        .filter((p) => p.torneo?.estado === "finalizado");

      const torneosResueltos: TorneoParticipadoConResultado[] = [];
      for (const { participantId, torneo } of finalizadas) {
        if (!torneo) continue;
        let resultado = "Participó";
        if (torneo.modo === "eliminacion_simple") {
          resultado = torneo.campeon_participant_id === participantId ? "Campeón 🏆" : "Participó";
        } else {
          const { data: resultadosData } = await supabase
            .from("tournament_results")
            .select("gano")
            .eq("tournament_id", torneo.id)
            .eq("participant_id", participantId);
          if (resultadosData && resultadosData.length > 0) {
            resultado = resultadosData.some((r) => r.gano) ? "Ganó" : "Perdió";
          }
        }
        torneosResueltos.push({
          id: torneo.id,
          nombre: torneo.nombre,
          fechaInicio: torneo.fecha_inicio,
          resultado,
        });
      }
      torneosResueltos.sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
      setTorneosParticipados(torneosResueltos);
    } else {
      setExpulsados([]);
      setRetosPendientesResponder([]);
      setRetosPropuestosPorMi([]);
      setRetosActivos([]);
      setRosterPorTeamId({});
      setReportesPorReto({});
      setPartidasPorReto({});
      setHistorialRetos([]);
      setTitulosPendientesResponder([]);
      setTitulosPropuestosPorMi([]);
      setSolicitudesHistoricas([]);
      setTorneosParticipados([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, user?.id]);

  if (loading) {
    return (
      <section className="section section-page">
        <p className="tournament-card-meta">Cargando equipo...</p>
      </section>
    );
  }

  if (notFound || !equipo) {
    return (
      <section className="page-placeholder">
        <h1>Equipo no encontrado</h1>
        <p>
          <Link to="/equipos" className="btn-link">
            Volver a equipos
          </Link>
        </p>
      </section>
    );
  }

  const esDueño = !!user && equipo.owner_id === user.id;

  const handleEliminarEquipoDefinitivo = async () => {
    if (
      !window.confirm(
        "¿Confirmas que quieres eliminar este equipo definitivamente? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }

    setEliminandoEquipoDefinitivo(true);
    setErrorEliminarEquipo(null);

    const { error } = await supabase.rpc("eliminar_equipo_definitivo", { p_team_id: equipo.id });

    setEliminandoEquipoDefinitivo(false);

    if (error) {
      setErrorEliminarEquipo(error.message);
      return;
    }

    navigate("/equipos");
  };

  // Diagnóstico (migración 028): un equipo disuelto seguía mostrando
  // la página completa, con Panel de control y todo, porque
  // owner_id nunca se limpia al disolverse -- acá se corta antes de
  // llegar a esa UI. Para el ex-dueño, ofrece eliminarlo de verdad;
  // para cualquier otro, es como si el equipo no existiera más.
  if (equipo.disuelto) {
    if (esDueño) {
      return (
        <section className="page-placeholder">
          <h1>Equipo disuelto</h1>
          <p>Este equipo fue disuelto y ya no tiene miembros ni aparece en el buscador público.</p>
          {errorEliminarEquipo && <div className="form-error">{errorEliminarEquipo}</div>}
          <button
            type="button"
            className="btn btn-primary"
            disabled={eliminandoEquipoDefinitivo}
            onClick={handleEliminarEquipoDefinitivo}
          >
            {eliminandoEquipoDefinitivo ? "Eliminando..." : "Eliminar equipo definitivamente"}
          </button>
          <p>
            <Link to="/equipos" className="btn-link">
              Volver a equipos
            </Link>
          </p>
        </section>
      );
    }

    return (
      <section className="page-placeholder">
        <h1>Este equipo ya no existe</h1>
        <p>
          <Link to="/equipos" className="btn-link">
            Volver a equipos
          </Link>
        </p>
      </section>
    );
  }

  const miMembresia = miembros.find((m) => m.userId === user?.id);
  const esMiembroNoOwner = !!miMembresia && !miMembresia.roles.includes("owner");

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorEquipo(null);

    if (!archivo) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }

    if (archivo.size > LOGO_MAX_BYTES) {
      setErrorEquipo("El logo no puede pesar más de 2MB.");
      event.target.value = "";
      return;
    }

    setLogoFile(archivo);
    setLogoPreview(URL.createObjectURL(archivo));
  };

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorEquipo(null);

    if (!archivo) {
      setBannerFile(null);
      setBannerPreview(null);
      return;
    }

    if (archivo.size > BANNER_MAX_BYTES) {
      setErrorEquipo("El banner no puede pesar más de 3MB.");
      event.target.value = "";
      return;
    }

    setBannerFile(archivo);
    setBannerPreview(URL.createObjectURL(archivo));
  };

  const handleGuardarEquipo = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardandoEquipo(true);
    setErrorEquipo(null);
    setEquipoGuardado(false);

    const cambios: { description: string | null; logo_url?: string; banner_url?: string } = {
      description: descEquipo.trim() || null,
    };

    try {
      if (logoFile) {
        const recorte = await recortarImagenCuadrada(logoFile);
        const extension = logoFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-logo.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("team-logos")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorEquipo("No se pudo subir el logo: " + uploadError.message);
          setGuardandoEquipo(false);
          return;
        }

        cambios.logo_url = supabase.storage.from("team-logos").getPublicUrl(ruta).data.publicUrl;
      }

      if (bannerFile) {
        const recorte = await recortarImagenConProporcion(bannerFile, 4);
        const extension = bannerFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("team-banners")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorEquipo("No se pudo subir el banner: " + uploadError.message);
          setGuardandoEquipo(false);
          return;
        }

        cambios.banner_url = supabase.storage.from("team-banners").getPublicUrl(ruta).data.publicUrl;
      }
    } catch {
      setErrorEquipo("No se pudo procesar alguna de las imágenes, prueba con otra.");
      setGuardandoEquipo(false);
      return;
    }

    const { error: updateError } = await supabase.from("teams").update(cambios).eq("id", equipo.id);

    setGuardandoEquipo(false);

    if (updateError) {
      setErrorEquipo(updateError.message);
      return;
    }

    setLogoFile(null);
    setLogoPreview(null);
    setBannerFile(null);
    setBannerPreview(null);
    setEquipoGuardado(true);
    await cargar();
  };

  const handleCambiarTema = async (nuevoTema: TemaEquipo) => {
    if (!user || !equipo || nuevoTema === equipo.tema_equipo) return;

    setGuardandoTema(true);
    setErrorTema(null);

    const { error } = await supabase.from("teams").update({ tema_equipo: nuevoTema }).eq("id", equipo.id);

    setGuardandoTema(false);

    if (error) {
      setErrorTema(error.message);
      return;
    }

    await cargar();
  };

  const handleCopiarCodigo = async () => {
    await navigator.clipboard.writeText(equipo.invite_code);
    setCodigoCopiado(true);
    setTimeout(() => setCodigoCopiado(false), 2000);
  };

  const handleQuitarMiembro = async (userId: string) => {
    if (!window.confirm("¿Seguro que quieres sacar a este jugador del equipo?")) return;

    setQuitando(userId);
    setErrorQuitar(null);

    const { error } = await supabase.rpc("quitar_miembro", {
      p_team_id: equipo.id,
      p_user_id: userId,
    });

    setQuitando(null);

    if (error) {
      setErrorQuitar(error.message);
      return;
    }

    // Recarga en vez de solo filtrar en memoria: quitar_miembro() ahora
    // también deja registro en team_kicks_log, y "Jugadores expulsados"
    // tiene que verlo reflejado al toque.
    await cargar();
  };

  const handleSalirEquipo = async () => {
    const soyUnicoMiembro = miembros.length === 1;
    const mensaje = soyUnicoMiembro
      ? "¿Seguro que quieres salir? Como eres el único miembro, el equipo quedará disuelto y dejará de aparecer en el buscador."
      : "¿Seguro que quieres salir del equipo?";
    if (!window.confirm(mensaje)) return;

    setSaliendo(true);
    setErrorSalir(null);

    // salir_equipo() (en la base) es la que de verdad decide si esto
    // es una salida normal o, si sos el único miembro, una disolución
    // del equipo -- acá solo se manda la orden y se navega afuera.
    const { error } = await supabase.rpc("salir_equipo");

    setSaliendo(false);

    if (error) {
      setErrorSalir(error.message);
      return;
    }

    navigate("/equipos");
  };

  const handleTransferirLiderazgo = async (event: FormEvent) => {
    event.preventDefault();
    if (!nuevoLiderId) return;
    if (!window.confirm("¿Confirmas que quieres transferir el liderazgo de este equipo?")) return;

    setTransfiriendo(true);
    setErrorTransferir(null);

    const { error } = await supabase.rpc("transferir_liderazgo", {
      p_nuevo_owner_id: nuevoLiderId,
    });

    setTransfiriendo(false);

    if (error) {
      setErrorTransferir(error.message);
      return;
    }

    setNuevoLiderId("");
    await cargar();
  };

  const handleProponerReto = async (event: FormEvent) => {
    event.preventDefault();
    setErrorReto(null);
    setRetoEnviado(false);

    const tagRival = tagRivalReto.trim().toUpperCase();
    if (!tagRival) {
      setErrorReto("Escribe el tag del equipo rival.");
      return;
    }
    if (!fechaHoraReto) {
      setErrorReto("Elige la fecha y hora del reto.");
      return;
    }

    setProponiendoReto(true);

    const { data: equipoRival, error: buscarError } = await supabase
      .from("teams")
      .select("id")
      .eq("tag", tagRival)
      .maybeSingle();

    if (buscarError || !equipoRival) {
      setErrorReto("No encontré ningún equipo con ese tag.");
      setProponiendoReto(false);
      return;
    }

    // Toda la validación real (dueño, banca rota, equipo disuelto,
    // que la fecha sea futura, el cooldown de 7 días) vive en
    // proponer_clan_war() en la base -- esto de acá es solo el
    // formulario.
    const { error } = await supabase.rpc("proponer_clan_war", {
      p_challenged_team_id: equipoRival.id,
      p_fecha_hora_cet: datetimeLocalAIso(fechaHoraReto),
    });

    setProponiendoReto(false);

    if (error) {
      setErrorReto(error.message);
      return;
    }

    setRetoEnviado(true);
    setTagRivalReto("");
    setFechaHoraReto("");
    await cargar();
  };

  const handleResponderReto = async (retoId: string, aceptar: boolean) => {
    setRespondiendoReto(retoId);
    setErroresResponderReto((prev) => ({ ...prev, [retoId]: "" }));

    let motivo: ClanWarMotivoRechazo | undefined;
    let detalle: string | undefined;

    if (!aceptar) {
      const motivoElegido = motivoRechazoPorReto[retoId];
      if (!motivoElegido) {
        setErroresResponderReto((prev) => ({ ...prev, [retoId]: "Elige un motivo para rechazar el reto." }));
        setRespondiendoReto(null);
        return;
      }
      if (motivoElegido === "Otro" && !detalleRechazoPorReto[retoId]?.trim()) {
        setErroresResponderReto((prev) => ({
          ...prev,
          [retoId]: 'Escribe el detalle cuando el motivo es "Otro".',
        }));
        setRespondiendoReto(null);
        return;
      }
      motivo = motivoElegido;
      detalle = motivoElegido === "Otro" ? detalleRechazoPorReto[retoId] : undefined;
    }

    const { error } = await supabase.rpc("responder_clan_war", {
      p_clan_war_id: retoId,
      p_aceptar: aceptar,
      p_motivo_rechazo: motivo ?? null,
      p_motivo_detalle: detalle ?? null,
    });

    setRespondiendoReto(null);

    if (error) {
      setErroresResponderReto((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleConfirmarAlineacion = async (retoId: string) => {
    setConfirmando(retoId);
    setErroresConfirmar((prev) => ({ ...prev, [retoId]: "" }));

    // confirmar_alineacion() (en la base) es la que de verdad exige
    // estar dentro de la ventana de check-in -- esto de acá es solo
    // para no mostrar el botón de más cuando no corresponde.
    const { error } = await supabase.rpc("confirmar_alineacion", { p_clan_war_id: retoId });

    setConfirmando(null);

    if (error) {
      setErroresConfirmar((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleReportarProblema = async (retoId: string) => {
    setReportando(retoId);
    setErroresReportar((prev) => ({ ...prev, [retoId]: "" }));

    const jugadorId = jugadorReportadoPorReto[retoId];
    const motivo = motivoReportePorReto[retoId];

    if (!jugadorId) {
      setErroresReportar((prev) => ({ ...prev, [retoId]: "Elige el jugador sobre el que quieres reportar." }));
      setReportando(null);
      return;
    }
    if (!motivo) {
      setErroresReportar((prev) => ({ ...prev, [retoId]: "Elige un motivo para el reporte." }));
      setReportando(null);
      return;
    }

    const { error } = await supabase.rpc("reportar_problema", {
      p_clan_war_id: retoId,
      p_jugador_afectado_id: jugadorId,
      p_motivo: motivo,
    });

    setReportando(null);

    if (error) {
      setErroresReportar((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    setJugadorReportadoPorReto((prev) => ({ ...prev, [retoId]: "" }));
    setMotivoReportePorReto((prev) => ({ ...prev, [retoId]: "" }));
    await cargar();
  };

  const handleCompletarTransmision = async (event: FormEvent, retoId: string) => {
    event.preventDefault();
    setGuardandoTransmision(retoId);
    setErroresTransmision((prev) => ({ ...prev, [retoId]: "" }));

    const tieneDelayTexto = tieneDelayPorReto[retoId];
    if (tieneDelayTexto !== "si" && tieneDelayTexto !== "no") {
      setErroresTransmision((prev) => ({
        ...prev,
        [retoId]: "Tienes que definir si la transmisión tiene delay o no.",
      }));
      setGuardandoTransmision(null);
      return;
    }

    const { error } = await supabase.rpc("completar_datos_transmision", {
      p_clan_war_id: retoId,
      p_caster_nombre: casterNombrePorReto[retoId] ?? null,
      p_caster_link: casterLinkPorReto[retoId] ?? null,
      p_tiene_delay: tieneDelayTexto === "si",
    });

    setGuardandoTransmision(null);

    if (error) {
      setErroresTransmision((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleAgregarPartida = async (retoId: string) => {
    setAgregandoPartida(retoId);
    setErroresAgregarPartida((prev) => ({ ...prev, [retoId]: "" }));

    const jugadorChallenger = jugadorChallengerPorReto[retoId];
    const jugadorChallenged = jugadorChallengedPorReto[retoId];

    if (!jugadorChallenger || !jugadorChallenged) {
      setErroresAgregarPartida((prev) => ({
        ...prev,
        [retoId]: "Elige un jugador de cada equipo para agregar la partida.",
      }));
      setAgregandoPartida(null);
      return;
    }

    const { error } = await supabase.rpc("agregar_partida_cw", {
      p_clan_war_id: retoId,
      p_jugador_challenger_id: jugadorChallenger,
      p_jugador_challenged_id: jugadorChallenged,
    });

    setAgregandoPartida(null);

    if (error) {
      setErroresAgregarPartida((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    setJugadorChallengerPorReto((prev) => ({ ...prev, [retoId]: "" }));
    setJugadorChallengedPorReto((prev) => ({ ...prev, [retoId]: "" }));
    await cargar();
  };

  const handleReportarPartida = async (matchId: string, ganadorId: string) => {
    setReportandoPartida(matchId);
    setErroresReportarPartida((prev) => ({ ...prev, [matchId]: "" }));

    // calcular_ajuste_mmr() (en la base) es la que de verdad decide
    // cuánto sube y baja el mmr_equipos de cada jugador, según la
    // tabla exacta de MMR apostado -- esto de acá solo manda el
    // resultado.
    const { error } = await supabase.rpc("reportar_partida_cw", {
      p_match_id: matchId,
      p_ganador_id: ganadorId,
    });

    setReportandoPartida(null);

    if (error) {
      setErroresReportarPartida((prev) => ({ ...prev, [matchId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleCerrarClanWar = async (retoId: string) => {
    if (
      !window.confirm(
        "¿Confirmas que quieres cerrar esta Clan War? El equipo con más partidas ganadas se lleva el ajuste de MMR de clan. Hace falta que los dos capitanes confirmen el cierre."
      )
    ) {
      return;
    }

    setCerrando(retoId);
    setErroresCerrar((prev) => ({ ...prev, [retoId]: "" }));

    const { error } = await supabase.rpc("cerrar_clan_war", { p_clan_war_id: retoId });

    setCerrando(null);

    if (error) {
      setErroresCerrar((prev) => ({ ...prev, [retoId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleProponerTitulo = async (event: FormEvent) => {
    event.preventDefault();
    setErrorTitulo(null);
    setTituloEnviado(false);

    const tagRival = tagRivalTitulo.trim().toUpperCase();
    const duracion = Number(duracionTitulo);

    if (!tagRival) {
      setErrorTitulo("Escribe el tag del equipo rival.");
      return;
    }
    if (!duracion || duracion < 7 || duracion > 90) {
      setErrorTitulo("La duración tiene que ser entre 7 y 90 días.");
      return;
    }

    setProponiendoTitulo(true);

    const { data: equipoRival, error: buscarError } = await supabase
      .from("teams")
      .select("id")
      .eq("tag", tagRival)
      .maybeSingle();

    if (buscarError || !equipoRival) {
      setErrorTitulo("No encontré ningún equipo con ese tag.");
      setProponiendoTitulo(false);
      return;
    }

    // proponer_titulo_padre_hijo() (en la base) es la que de verdad
    // chequea que seas dueño y valida la duración -- esto de acá es
    // solo el formulario.
    const { error } = await supabase.rpc("proponer_titulo_padre_hijo", {
      p_tipo: "clan",
      p_retado_id: equipoRival.id,
      p_duracion_dias: duracion,
    });

    setProponiendoTitulo(false);

    if (error) {
      setErrorTitulo(error.message);
      return;
    }

    setTituloEnviado(true);
    setTagRivalTitulo("");
    await cargar();
  };

  const handleResponderTitulo = async (tituloId: string, aceptar: boolean) => {
    setRespondiendoTitulo(tituloId);
    setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: "" }));

    const { error } = await supabase.rpc("responder_titulo_padre_hijo", {
      p_titulo_id: tituloId,
      p_aceptar: aceptar,
    });

    setRespondiendoTitulo(null);

    if (error) {
      setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleResponderHistorico = async (participantId: string, aceptar: boolean) => {
    setRespondiendoHistorico(participantId);
    setErroresResponderHistorico((prev) => ({ ...prev, [participantId]: "" }));

    const { error } = await supabase.rpc("responder_consentimiento_historico", {
      p_participant_id: participantId,
      p_acepta: aceptar,
    });

    setRespondiendoHistorico(null);

    if (error) {
      setErroresResponderHistorico((prev) => ({ ...prev, [participantId]: error.message }));
      return;
    }

    await cargar();
  };

  const handleEnviarReporte = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (!asuntoReporte.trim() || !descripcionReporte.trim()) {
      setErrorReporte("Completa el asunto y la descripción.");
      return;
    }

    setEnviandoReporte(true);
    setErrorReporte(null);
    setReporteEnviado(false);

    const { error } = await supabase.from("reportes_staff").insert({
      reportado_por: user.id,
      asunto: asuntoReporte.trim(),
      descripcion: descripcionReporte.trim(),
    });

    setEnviandoReporte(false);

    if (error) {
      setErrorReporte(error.message);
      return;
    }

    setAsuntoReporte("");
    setDescripcionReporte("");
    setReporteEnviado(true);
  };

  const handleBuscarJugador = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusqueda(null);
    setResultadoBusqueda(null);
    setInvitacionEnviada(false);

    const partes = busquedaNick.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorBusqueda("Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.");
      return;
    }
    const [nickBuscado, uniqueIdBuscado] = partes;

    setBuscando(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nick, unique_id, avatar_url, avatar_forma")
      .eq("nick", nickBuscado)
      .eq("unique_id", uniqueIdBuscado)
      .maybeSingle();
    setBuscando(false);

    if (error || !data) {
      setErrorBusqueda("No encontré a nadie con ese Nick#ID.");
      return;
    }

    setResultadoBusqueda({
      id: data.id,
      nick: data.nick ?? nickBuscado,
      uniqueId: data.unique_id,
      avatarUrl: data.avatar_url,
      avatarForma: data.avatar_forma,
    });
  };

  const handleInvitar = async () => {
    if (!resultadoBusqueda) return;

    setInvitando(true);
    setErrorBusqueda(null);

    // invitar_jugador() (en la base) es la que de verdad chequea que
    // seas el dueño, que el jugador no tenga equipo, y que no haya ya
    // una invitación pendiente -- esto de acá es solo el formulario.
    const { error } = await supabase.rpc("invitar_jugador", {
      p_team_id: equipo.id,
      p_invited_user_id: resultadoBusqueda.id,
    });

    setInvitando(false);

    if (error) {
      setErrorBusqueda(error.message);
      return;
    }

    setInvitacionEnviada(true);
    setResultadoBusqueda(null);
    setBusquedaNick("");
  };

  const handleCrearTemporal = async (event: FormEvent) => {
    event.preventDefault();
    if (!equipo) return;

    const errorNick = validarNick(nickTemporalNuevo);
    if (errorNick) {
      setErrorTemporal(errorNick);
      return;
    }

    setCreandoTemporal(true);
    setErrorTemporal(null);

    const { error } = await supabase.rpc("crear_jugador_temporal", {
      p_team_id: equipo.id,
      p_nick_temporal: nickTemporalNuevo,
    });

    setCreandoTemporal(false);

    if (error) {
      setErrorTemporal(error.message);
      return;
    }

    setNickTemporalNuevo("");
    await cargar();
  };

  const handleReemplazarTemporal = async (tempId: string) => {
    const busqueda = (busquedaReemplazoPorTemp[tempId] ?? "").trim();
    const partes = busqueda.split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErroresReemplazoPorTemp((prev) => ({
        ...prev,
        [tempId]: "Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.",
      }));
      return;
    }

    setReemplazandoTemp(tempId);
    setErroresReemplazoPorTemp((prev) => ({ ...prev, [tempId]: "" }));

    const { error } = await supabase.rpc("reemplazar_jugador_temporal", {
      p_temp_id: tempId,
      p_nick: partes[0],
      p_unique_id: partes[1],
    });

    setReemplazandoTemp(null);

    if (error) {
      setErroresReemplazoPorTemp((prev) => ({ ...prev, [tempId]: error.message }));
      return;
    }

    setBusquedaReemplazoPorTemp((prev) => ({ ...prev, [tempId]: "" }));
    await cargar();
  };

  const handleInvestigar = async (userId: string) => {
    setInvestigando(true);
    setErrorInvestigacion(null);
    setInvestigacion(null);

    // investigar_jugador() (en la base) es la que de verdad chequea
    // que seas dueño de algún equipo o admin -- esto de acá no es la
    // única barrera, solo abre el panel con lo que devuelve.
    const { data, error } = await supabase.rpc("investigar_jugador", { p_user_id: userId });

    setInvestigando(false);

    if (error) {
      setErrorInvestigacion(error.message);
      return;
    }

    setInvestigacion(data as InvestigacionJugador);
  };

  const renderMiembro = (m: MiembroConNombre, conControles: boolean) => (
    <div key={m.userId} className="detail-participant-item">
      <Avatar url={m.avatarUrl} nombre={m.nick} className="detail-participant-avatar" forma={m.avatarForma} />
      {m.nick ?? "Jugador de RemorApp"}
      {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
      {m.liga && <span className="liga-badge">{m.liga}</span>}
      {m.razaPrincipal && (
        <span className="liga-badge">
          {m.razaPrincipal}
          {m.razaSecundaria && ` / ${m.razaSecundaria}`}
        </span>
      )}
      <LigaBadge liga={m.ligaEquipos} mmr={m.mmrEquipos} bancaRota={m.bancaRota} />
      <span className="liga-badge">Valentía {m.valentiaJugador}%</span>
      <span className="liga-badge">Responsabilidad {m.responsabilidadCw}%</span>
      {m.pocoConfiable && <span className="nivel-badge nivel-badge-banca-rota">Poco Responsable</span>}
      {m.roles.includes("owner") && <span className="team-owner-badge">Dueño</span>}
      {conControles && !m.roles.includes("owner") && (
        <button
          type="button"
          className="btn btn-ghost team-kick-btn"
          disabled={quitando === m.userId}
          onClick={() => handleQuitarMiembro(m.userId)}
        >
          {quitando === m.userId ? "Quitando..." : "Quitar del equipo"}
        </button>
      )}
    </div>
  );

  return (
    <section className="section section-page" data-tema-equipo={equipo.tema_equipo}>
      <div className="team-detail-banner-wrap">
        {equipo.banner_url ? (
          <img src={equipo.banner_url} alt="" className="team-detail-banner" />
        ) : (
          <div className="team-detail-banner team-detail-banner-placeholder" />
        )}
        <div className="team-detail-logo-overlap">
          {equipo.logo_url ? (
            <img src={equipo.logo_url} alt={equipo.name} className="team-detail-logo" />
          ) : (
            <div className="team-detail-logo team-card-logo-placeholder">{equipo.tag.charAt(0)}</div>
          )}
        </div>
      </div>

      {/* La descripción va inmediatamente debajo del banner, antes de
          cualquier otra cosa -- a propósito, no es un detalle menor
          en la página. */}
      {equipo.description && <p className="team-detail-description">{equipo.description}</p>}

      <MmrProgressBar mmr={equipo.mmr} liga={equipo.liga} bancaRota={equipo.banca_rota} />
      <PercentBar label="Valentía del clan" value={equipo.valentia} />
      <TitulosActivosList tipo="clan" id={equipo.id} className="detail-map-list" />

      <div className="team-detail-header">
        <div>
          <h1 className="section-title">
            {equipo.name}
            <LigaBadge
              liga={equipo.liga}
              mmr={equipo.mmr}
              bancaRota={equipo.banca_rota}
              className="nivel-badge-grande"
            />
          </h1>
          <p className="tournament-card-meta">
            [{equipo.tag}] · {miembros.length} {miembros.length === 1 ? "miembro" : "miembros"}
          </p>
        </div>
      </div>

      {/* El código de invitación queda a mano en la página principal,
          fuera del Panel de control -- no hace falta abrir ningún
          submenú para encontrarlo. Solo lo ve el dueño, igual que
          antes. */}
      {esDueño && (
        <div className="team-leader-invite">
          <span className="team-leader-invite-code">{equipo.invite_code}</span>
          <button type="button" className="btn btn-ghost" onClick={handleCopiarCodigo}>
            {codigoCopiado ? "¡Copiado!" : "Copiar código"}
          </button>
        </div>
      )}

      {/* Acceso adicional a /equipos, no un reemplazo: "Mi equipo" en
          el abanico sigue llevando directo acá cuando ya tienes clan,
          así que sin esto no había ninguna forma de volver al
          buscador general una vez que perteneces a un equipo. */}
      <p className="tournament-card-meta">
        <Link to="/equipos" className="btn-link">
          Explorar otros equipos
        </Link>
      </p>

      <div className="detail-map-list">
        {equipo.sc2_regions.map((region) => (
          <span key={region} className="badge badge-format">
            {SC2_REGION_OPTIONS.find((o) => o.value === region)?.label ?? region}
          </span>
        ))}
      </div>

      <h2 className="detail-subtitle">Miembros</h2>
      <div className="detail-participant-list">
        {miembros.map((m) => renderMiembro(m, false))}
        {jugadoresTemporales.map((t) =>
          t.reemplazadoPorId ? (
            <div key={t.id} className="detail-participant-item">
              <Avatar
                url={t.reemplazadoPorAvatarUrl}
                nombre={t.reemplazadoPorNick}
                className="detail-participant-avatar"
                forma={t.reemplazadoPorAvatarForma}
              />
              {t.reemplazadoPorNick ?? "Jugador de RemorApp"}
              {t.reemplazadoPorUniqueId && <span className="profile-nick-id">#{t.reemplazadoPorUniqueId}</span>}
            </div>
          ) : (
            <div key={t.id} className="detail-participant-item">
              {t.nickTemporal}
              <span className="team-temp-badge">Temporal</span>
            </div>
          )
        )}
      </div>

      {esMiembroNoOwner && (
        <div className="detail-register-box">
          {errorSalir && <div className="form-error">{errorSalir}</div>}
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={saliendo}
            onClick={handleSalirEquipo}
          >
            {saliendo ? "Saliendo..." : "Salir del equipo"}
          </button>
        </div>
      )}

      {esDueño && (
        <div className="team-control-panel-wrap">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              setPanelAbierto((abierto) => !abierto);
              setSeccionPanel(null);
            }}
          >
            {panelAbierto ? "Cerrar panel de control" : "Panel de control"}
          </button>

          {panelAbierto && (
            <div className="team-leader-panel">
              {seccionPanel === null ? (
                <div className="team-panel-menu">
                  <button
                    type="button"
                    className="team-panel-menu-item"
                    onClick={() => setSeccionPanel("configuracion")}
                  >
                    <span className="team-panel-menu-item-title">Configuración</span>
                    <span className="team-panel-menu-item-desc">
                      Logo, banner, título Padre/Hijo activo y eliminar equipo
                    </span>
                  </button>
                  <button
                    type="button"
                    className="team-panel-menu-item"
                    onClick={() => setSeccionPanel("editar-equipo")}
                  >
                    <span className="team-panel-menu-item-title">Editar equipo</span>
                    <span className="team-panel-menu-item-desc">
                      Lista de jugadores, invitar, quitar e investigar jugador
                    </span>
                  </button>
                  <button type="button" className="team-panel-menu-item" onClick={() => setSeccionPanel("eventos")}>
                    <span className="team-panel-menu-item-title">Gestor de eventos</span>
                    <span className="team-panel-menu-item-desc">
                      Solicitudes de Clan War, retos y su historial
                    </span>
                  </button>
                  <button type="button" className="team-panel-menu-item" onClick={() => setSeccionPanel("logros")}>
                    <span className="team-panel-menu-item-title">Logros y Recompensas</span>
                    <span className="team-panel-menu-item-desc">
                      Skins desbloqueadas por nivel y elementos comprados
                    </span>
                  </button>
                  <button
                    type="button"
                    className="team-panel-menu-item"
                    onClick={() => setSeccionPanel("reportar")}
                  >
                    <span className="team-panel-menu-item-title">Reportar un problema</span>
                    <span className="team-panel-menu-item-desc">Avisa al staff sobre algo puntual</span>
                  </button>
                  <Link to={`/sala-de-la-fama?clan=${equipo.tag}`} className="team-panel-menu-item">
                    <span className="team-panel-menu-item-title">Hall of Fame</span>
                    <span className="team-panel-menu-item-desc">Ver este equipo en la Sala de la Fama</span>
                  </Link>
                </div>
              ) : (
                <div className="team-panel-section">
                  <div className="team-panel-section-header">
                    <button type="button" className="team-panel-back" onClick={() => setSeccionPanel(null)}>
                      ← Volver al panel
                    </button>
                  </div>

              {/* El dueño no puede simplemente "salir": si hay más
                  miembros, primero tiene que transferir el liderazgo.
                  Recién cuando queda como único miembro, salir del
                  equipo disuelve el equipo en vez de dejarlo sin
                  dueño. */}
              {seccionPanel === "editar-equipo" && (miembros.length > 1 ? (
                <>
                  <h3 className="detail-subtitle">Transferir liderazgo</h3>
                  {errorTransferir && <div className="form-error">{errorTransferir}</div>}
                  <form className="auth-form" onSubmit={handleTransferirLiderazgo}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-nuevo-lider">
                        Nuevo dueño del equipo
                      </label>
                      <select
                        id="team-nuevo-lider"
                        className="form-input"
                        value={nuevoLiderId}
                        onChange={(e) => setNuevoLiderId(e.target.value)}
                      >
                        <option value="">Selecciona un miembro</option>
                        {miembros
                          .filter((m) => !m.roles.includes("owner"))
                          .map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.nick ?? "Jugador de RemorApp"}
                              {m.uniqueId ? `#${m.uniqueId}` : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="btn btn-ghost btn-block"
                      disabled={transfiriendo || !nuevoLiderId}
                    >
                      {transfiriendo ? "Transfiriendo..." : "Transferir liderazgo"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h3 className="detail-subtitle">Salir del equipo</h3>
                  <p className="tournament-card-meta">
                    Eres el único miembro. Si sales, el equipo quedará disuelto y dejará de
                    aparecer en el buscador público.
                  </p>
                  {errorSalir && <div className="form-error">{errorSalir}</div>}
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    disabled={saliendo}
                    onClick={handleSalirEquipo}
                  >
                    {saliendo ? "Saliendo..." : "Salir del equipo"}
                  </button>
                </>
              ))}

              {seccionPanel === "configuracion" && (
                <>
                  <h3 className="detail-subtitle">Apariencia</h3>
                  {errorTema && <div className="form-error">{errorTema}</div>}
                  <div className="team-tema-options">
                    {TEMAS_EQUIPO.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={`team-tema-option ${equipo.tema_equipo === t.value ? "selected" : ""}`}
                        disabled={guardandoTema}
                        onClick={() => handleCambiarTema(t.value)}
                      >
                        <span className="team-tema-swatch" style={{ background: t.color }} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {seccionPanel === "configuracion" && (
              <form className="auth-form" onSubmit={handleGuardarEquipo}>
            {errorEquipo && <div className="form-error">{errorEquipo}</div>}
            {equipoGuardado && <div className="form-success">Los cambios del equipo se guardaron.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-descripcion">
                Descripción
              </label>
              <textarea
                id="team-edit-descripcion"
                className="form-textarea"
                maxLength={280}
                value={descEquipo}
                onChange={(e) => setDescEquipo(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-logo">
                Logo (opcional, máx. 2MB, se recorta a 1:1)
              </label>
              <input
                id="team-edit-logo"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoChange}
              />
              {(logoPreview ?? equipo.logo_url) && (
                <img
                  src={logoPreview ?? equipo.logo_url ?? ""}
                  alt="Vista previa del logo"
                  className="team-logo-preview"
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="team-edit-banner">
                Banner (opcional, máx. 3MB, se recorta a 4:1)
              </label>
              <input
                id="team-edit-banner"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerChange}
              />
              {(bannerPreview ?? equipo.banner_url) && (
                <img
                  src={bannerPreview ?? equipo.banner_url ?? ""}
                  alt="Vista previa del banner"
                  className="team-banner-preview"
                />
              )}
            </div>

            <p className="form-hint">
              El nombre y el tag del equipo no se pueden cambiar por ahora.
            </p>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardandoEquipo}>
              {guardandoEquipo ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>
              )}

              {seccionPanel === "configuracion" && (
                <>
                  <h3 className="detail-subtitle">Título Padre/Hijo activo</h3>
                  <TitulosActivosList tipo="clan" id={equipo.id} className="detail-map-list" />
                </>
              )}

              {seccionPanel === "editar-equipo" && (
              <>
              <h3 className="detail-subtitle">Invitar jugador</h3>
              <form className="auth-form" onSubmit={handleBuscarJugador}>
                {errorBusqueda && <div className="form-error">{errorBusqueda}</div>}
                {invitacionEnviada && <div className="form-success">¡Invitación enviada!</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="team-invitar-nick">
                    Nick#ID del jugador
                  </label>
                  <input
                    id="team-invitar-nick"
                    className="form-input"
                    type="text"
                    placeholder="CarpeDiem#12345"
                    value={busquedaNick}
                    onChange={(e) => setBusquedaNick(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-ghost btn-block" disabled={buscando}>
                  {buscando ? "Buscando..." : "Buscar"}
                </button>
              </form>

              {resultadoBusqueda && (
                <div className="detail-participant-item">
                  <Avatar
                    url={resultadoBusqueda.avatarUrl}
                    nombre={resultadoBusqueda.nick}
                    className="detail-participant-avatar"
                    forma={resultadoBusqueda.avatarForma}
                  />
                  {resultadoBusqueda.nick}
                  <span className="profile-nick-id">#{resultadoBusqueda.uniqueId}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={invitando}
                    onClick={handleInvitar}
                  >
                    {invitando ? "Invitando..." : "Invitar"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={investigando}
                    onClick={() => handleInvestigar(resultadoBusqueda.id)}
                  >
                    {investigando ? "Investigando..." : "Investigar jugador"}
                  </button>
                </div>
              )}

              {errorInvestigacion && <div className="form-error">{errorInvestigacion}</div>}
              {investigacion && <InvestigacionJugadorPanel investigacion={investigacion} />}

              <h3 className="detail-subtitle">Miembros del equipo</h3>
              {errorQuitar && <div className="form-error">{errorQuitar}</div>}
              <div className="detail-participant-list">{miembros.map((m) => renderMiembro(m, true))}</div>

              <h3 className="detail-subtitle">Jugador temporal</h3>
              <p className="tournament-card-meta">
                Para el line-up cuando todavía no tienes la cuenta real del jugador. Sin Nick#ID, sin
                MMR y sin historial hasta que lo reemplaces por una cuenta real.
              </p>
              {errorTemporal && <div className="form-error">{errorTemporal}</div>}
              <form className="auth-form" onSubmit={handleCrearTemporal}>
                <div className="form-group">
                  <label className="form-label" htmlFor="team-nick-temporal">
                    Nick temporal
                  </label>
                  <input
                    id="team-nick-temporal"
                    className="form-input"
                    type="text"
                    pattern={NICK_REGEX.source}
                    value={nickTemporalNuevo}
                    onChange={(e) => setNickTemporalNuevo(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-ghost btn-block" disabled={creandoTemporal}>
                  {creandoTemporal ? "Creando..." : "Crear jugador temporal"}
                </button>
              </form>

              {jugadoresTemporales.filter((t) => !t.reemplazadoPorId).length > 0 && (
                <div className="detail-participant-list">
                  {jugadoresTemporales
                    .filter((t) => !t.reemplazadoPorId)
                    .map((t) => (
                      <div key={t.id} className="reto-item">
                        <p className="reto-desc">
                          {t.nickTemporal}
                          <span className="team-temp-badge">Temporal</span>
                        </p>
                        {erroresReemplazoPorTemp[t.id] && (
                          <div className="form-error">{erroresReemplazoPorTemp[t.id]}</div>
                        )}
                        <div className="form-group">
                          <label className="form-label" htmlFor={`temp-reemplazo-${t.id}`}>
                            Nick#ID de la cuenta real
                          </label>
                          <input
                            id={`temp-reemplazo-${t.id}`}
                            className="form-input"
                            type="text"
                            placeholder="CarpeDiem#12345"
                            value={busquedaReemplazoPorTemp[t.id] ?? ""}
                            onChange={(e) =>
                              setBusquedaReemplazoPorTemp((prev) => ({ ...prev, [t.id]: e.target.value }))
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={reemplazandoTemp === t.id}
                          onClick={() => handleReemplazarTemporal(t.id)}
                        >
                          {reemplazandoTemp === t.id ? "Reemplazando..." : "Reemplazar por cuenta real"}
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <h3 className="detail-subtitle">Jugadores expulsados</h3>
              {expulsados.length === 0 ? (
                <p className="detail-empty">Todavía no expulsaste a nadie.</p>
              ) : (
                <div className="detail-participant-list">
                  {expulsados.map((e) => (
                    <div key={e.userId + e.kickedAt} className="detail-participant-item">
                      {e.nick ?? "Jugador de RemorApp"}
                      {e.uniqueId && <span className="profile-nick-id">#{e.uniqueId}</span>}
                      <span className="tournament-card-meta">{formatFecha(e.kickedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
              </>
              )}

              {seccionPanel === "eventos" && (
              <>
              {solicitudesHistoricas.length > 0 && (
                <>
                  <h3 className="detail-subtitle">Torneos Históricos: consentimiento pendiente</h3>
                  <div className="detail-participant-list">
                    {solicitudesHistoricas.map((s) => (
                      <div key={s.id} className="reto-item">
                        <p className="reto-desc">
                          "{s.torneoNombre}" dice que tu equipo participó -- ¿aceptas que sea público?
                        </p>
                        {erroresResponderHistorico[s.id] && (
                          <div className="form-error">{erroresResponderHistorico[s.id]}</div>
                        )}
                        <div className="invitation-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={respondiendoHistorico === s.id}
                            onClick={() => handleResponderHistorico(s.id, true)}
                          >
                            Aceptar
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={respondiendoHistorico === s.id}
                            onClick={() => handleResponderHistorico(s.id, false)}
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h3 className="detail-subtitle">Clan Wars</h3>

              <h4 className="detail-subtitle">Retos pendientes de responder</h4>
              {retosPendientesResponder.length === 0 ? (
                <p className="detail-empty">No tienes retos pendientes de responder.</p>
              ) : (
                <div className="detail-participant-list">
                  {retosPendientesResponder.map((r) => (
                    <div key={r.id} className="reto-item">
                      <p className="reto-desc">Te reta {r.challengerNombre}</p>
                      <p className="reto-fecha">
                        Tu hora local: {formatearHoraLocal(r.fechaHoraCet)} · Hora CET:{" "}
                        {formatearHoraCet(r.fechaHoraCet)}
                      </p>
                      {erroresResponderReto[r.id] && (
                        <div className="form-error">{erroresResponderReto[r.id]}</div>
                      )}
                      <div className="invitation-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={respondiendoReto === r.id}
                          onClick={() => handleResponderReto(r.id, true)}
                        >
                          Aceptar
                        </button>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor={`reto-motivo-${r.id}`}>
                          Rechazar con motivo
                        </label>
                        <select
                          id={`reto-motivo-${r.id}`}
                          className="form-select"
                          value={motivoRechazoPorReto[r.id] ?? ""}
                          onChange={(e) =>
                            setMotivoRechazoPorReto((prev) => ({
                              ...prev,
                              [r.id]: e.target.value as ClanWarMotivoRechazo,
                            }))
                          }
                        >
                          <option value="">Selecciona un motivo</option>
                          {CLAN_WAR_MOTIVO_RECHAZO_OPTIONS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                      {motivoRechazoPorReto[r.id] === "Otro" && (
                        <div className="form-group">
                          <label className="form-label" htmlFor={`reto-detalle-${r.id}`}>
                            Detalle
                          </label>
                          <input
                            id={`reto-detalle-${r.id}`}
                            className="form-input"
                            type="text"
                            value={detalleRechazoPorReto[r.id] ?? ""}
                            onChange={(e) =>
                              setDetalleRechazoPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={respondiendoReto === r.id}
                        onClick={() => handleResponderReto(r.id, false)}
                      >
                        {respondiendoReto === r.id ? "Enviando..." : "Rechazar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="detail-subtitle">Retos propuestos por mí</h4>
              {retosPropuestosPorMi.length === 0 ? (
                <p className="detail-empty">No tienes retos esperando respuesta.</p>
              ) : (
                <div className="detail-participant-list">
                  {retosPropuestosPorMi.map((r) => (
                    <div key={r.id} className="reto-item">
                      <p className="reto-desc">
                        Reto a {r.challengedNombre}
                        <span className="reto-status">Pendiente</span>
                      </p>
                      <p className="reto-fecha">
                        Tu hora local: {formatearHoraLocal(r.fechaHoraCet)} · Hora CET:{" "}
                        {formatearHoraCet(r.fechaHoraCet)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="detail-subtitle">Guerras en preparación</h4>
              {retosActivos.length === 0 ? (
                <p className="detail-empty">No tienes ninguna guerra en preparación.</p>
              ) : (
                <div className="detail-participant-list">
                  {retosActivos.map((r) => {
                    const soyChallenger = r.challengerTeamId === equipo.id;
                    const rivalTeamId = soyChallenger ? r.challengedTeamId : r.challengerTeamId;
                    const rivalNombre = soyChallenger ? r.challengedNombre : r.challengerNombre;
                    const miConfirmacion = soyChallenger ? r.challengerConfirmado : r.challengedConfirmado;
                    const confirmacionRival = soyChallenger ? r.challengedConfirmado : r.challengerConfirmado;
                    const miCierreConfirmado = soyChallenger
                      ? r.challengerCierreConfirmado
                      : r.challengedCierreConfirmado;
                    const cierreRivalConfirmado = soyChallenger
                      ? r.challengedCierreConfirmado
                      : r.challengerCierreConfirmado;
                    const dentroVentana = dentroDeVentanaCheckIn(r.fechaHoraCet, ahora);
                    const roster = rosterPorTeamId[rivalTeamId] ?? [];
                    const rosterChallenger = rosterPorTeamId[r.challengerTeamId] ?? [];
                    const rosterChallenged = rosterPorTeamId[r.challengedTeamId] ?? [];
                    const reportes = reportesPorReto[r.id] ?? [];
                    const partidas = partidasPorReto[r.id] ?? [];
                    const ganadasChallenger = partidas.filter(
                      (p) => p.status === "jugado" && p.ganadorId === p.jugadorChallengerId
                    ).length;
                    const ganadasChallenged = partidas.filter(
                      (p) => p.status === "jugado" && p.ganadorId === p.jugadorChallengedId
                    ).length;

                    return (
                      <div key={r.id} className="reto-item">
                        <p className="reto-desc">
                          vs {rivalNombre}
                          <span className="reto-status">{r.status === "en_curso" ? "En curso" : "Aceptada"}</span>
                        </p>
                        <p className="reto-fecha">
                          Tu hora local: {formatearHoraLocal(r.fechaHoraCet)} · Hora CET:{" "}
                          {formatearHoraCet(r.fechaHoraCet)}
                        </p>

                        {!dentroVentana && (
                          <p className="tournament-card-meta">
                            El check-in se abre 15 minutos antes de la hora del reto.
                          </p>
                        )}

                        {dentroVentana && (
                          <>
                            <h5 className="detail-subtitle">Roster de {rivalNombre}</h5>
                            {roster.length === 0 ? (
                              <p className="detail-empty">Este equipo todavía no tiene miembros.</p>
                            ) : (
                              <div className="detail-participant-list">
                                {roster.map((m) => (
                                  <div key={m.userId} className="detail-participant-item">
                                    {m.nick ?? "Jugador de RemorApp"}
                                    {m.uniqueId && <span className="profile-nick-id">#{m.uniqueId}</span>}
                                    {m.razaPrincipal && (
                                      <span className="liga-badge">
                                        {m.razaPrincipal}
                                        {m.razaSecundaria && ` / ${m.razaSecundaria}`}
                                      </span>
                                    )}
                                    <span className="tournament-card-meta">
                                      SC2: {m.sc2Id ?? "sin declarar"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <p className="tournament-card-meta">
                              Tu confirmación: {miConfirmacion ? "Confirmado" : "Pendiente"} · Confirmación de{" "}
                              {rivalNombre}: {confirmacionRival ? "Confirmado" : "Pendiente"}
                            </p>

                            {erroresConfirmar[r.id] && <div className="form-error">{erroresConfirmar[r.id]}</div>}
                            {!miConfirmacion && (
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={confirmando === r.id}
                                onClick={() => handleConfirmarAlineacion(r.id)}
                              >
                                {confirmando === r.id
                                  ? "Confirmando..."
                                  : "Confirmo que la alineación es correcta"}
                              </button>
                            )}

                            <h5 className="detail-subtitle">Reportar un problema</h5>
                            {erroresReportar[r.id] && <div className="form-error">{erroresReportar[r.id]}</div>}
                            <div className="form-group">
                              <label className="form-label" htmlFor={`reporte-jugador-${r.id}`}>
                                Jugador del roster rival
                              </label>
                              <select
                                id={`reporte-jugador-${r.id}`}
                                className="form-select"
                                value={jugadorReportadoPorReto[r.id] ?? ""}
                                onChange={(e) =>
                                  setJugadorReportadoPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                }
                              >
                                <option value="">Selecciona un jugador</option>
                                {roster.map((m) => (
                                  <option key={m.userId} value={m.userId}>
                                    {m.nick ?? "Jugador de RemorApp"}
                                    {m.uniqueId ? `#${m.uniqueId}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor={`reporte-motivo-${r.id}`}>
                                Motivo
                              </label>
                              <select
                                id={`reporte-motivo-${r.id}`}
                                className="form-select"
                                value={motivoReportePorReto[r.id] ?? ""}
                                onChange={(e) =>
                                  setMotivoReportePorReto((prev) => ({
                                    ...prev,
                                    [r.id]: e.target.value as ClanWarReporteMotivo,
                                  }))
                                }
                              >
                                <option value="">Selecciona un motivo</option>
                                {CLAN_WAR_REPORTE_MOTIVO_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={reportando === r.id}
                              onClick={() => handleReportarProblema(r.id)}
                            >
                              {reportando === r.id ? "Reportando..." : "Reportar problema"}
                            </button>

                            {reportes.length > 0 && (
                              <>
                                <h5 className="detail-subtitle">Reportes de este reto</h5>
                                <div className="detail-participant-list">
                                  {reportes.map((rep) => (
                                    <div key={rep.id} className="reto-item">
                                      <p className="reto-motivo">
                                        {rep.reportadoPorNombre} reportó a {rep.jugadorAfectadoNombre}:{" "}
                                        {CLAN_WAR_REPORTE_MOTIVO_OPTIONS.find((o) => o.value === rep.motivo)
                                          ?.label ?? rep.motivo}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        )}

                        {soyChallenger && r.status === "aceptada" && (
                          <>
                            <h5 className="detail-subtitle">Datos de transmisión</h5>
                            {erroresTransmision[r.id] && (
                              <div className="form-error">{erroresTransmision[r.id]}</div>
                            )}
                            <form className="auth-form" onSubmit={(e) => handleCompletarTransmision(e, r.id)}>
                              <div className="form-group">
                                <label className="form-label" htmlFor={`caster-nombre-${r.id}`}>
                                  Nombre del caster (opcional)
                                </label>
                                <input
                                  id={`caster-nombre-${r.id}`}
                                  className="form-input"
                                  type="text"
                                  value={casterNombrePorReto[r.id] ?? r.casterNombre ?? ""}
                                  onChange={(e) =>
                                    setCasterNombrePorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                />
                              </div>
                              <div className="form-group">
                                <label className="form-label" htmlFor={`caster-link-${r.id}`}>
                                  Link de la transmisión (opcional)
                                </label>
                                <input
                                  id={`caster-link-${r.id}`}
                                  className="form-input"
                                  type="text"
                                  value={casterLinkPorReto[r.id] ?? r.casterLink ?? ""}
                                  onChange={(e) =>
                                    setCasterLinkPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                />
                              </div>
                              <div className="form-group">
                                <label className="form-label" htmlFor={`tiene-delay-${r.id}`}>
                                  ¿Tiene delay?
                                </label>
                                <select
                                  id={`tiene-delay-${r.id}`}
                                  className="form-select"
                                  value={
                                    tieneDelayPorReto[r.id] ??
                                    (r.tieneDelay === null ? "" : r.tieneDelay ? "si" : "no")
                                  }
                                  onChange={(e) =>
                                    setTieneDelayPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                >
                                  <option value="">Selecciona una opción</option>
                                  <option value="si">Sí</option>
                                  <option value="no">No</option>
                                </select>
                              </div>
                              <button
                                type="submit"
                                className="btn btn-ghost btn-block"
                                disabled={guardandoTransmision === r.id}
                              >
                                {guardandoTransmision === r.id ? "Guardando..." : "Guardar datos de transmisión"}
                              </button>
                            </form>
                          </>
                        )}

                        {!soyChallenger && (r.casterNombre || r.casterLink || r.tieneDelay !== null) && (
                          <p className="tournament-card-meta">
                            {r.casterNombre && <>Caster: {r.casterNombre} </>}
                            {r.casterLink && <>({r.casterLink}) </>}
                            {r.tieneDelay !== null && <>· {r.tieneDelay ? "Con delay" : "Sin delay"}</>}
                          </p>
                        )}

                        {r.status === "en_curso" && (
                          <>
                            <p className="form-success">La guerra está en curso.</p>

                            <h5 className="detail-subtitle">
                              Partidas ({ganadasChallenger} - {ganadasChallenged})
                            </h5>
                            {partidas.length === 0 ? (
                              <p className="detail-empty">Todavía no se agregó ninguna partida.</p>
                            ) : (
                              <div className="detail-participant-list">
                                {partidas.map((p) => (
                                  <div key={p.id} className="reto-item">
                                    <p className="reto-desc">
                                      {p.jugadorChallengerNombre} vs {p.jugadorChallengedNombre}
                                      <span className="reto-status">
                                        {p.status === "jugado" ? "Jugada" : "Pendiente"}
                                      </span>
                                    </p>
                                    {p.status === "jugado" ? (
                                      <p className="tournament-card-meta">
                                        Ganó{" "}
                                        {p.ganadorId === p.jugadorChallengerId
                                          ? p.jugadorChallengerNombre
                                          : p.jugadorChallengedNombre}
                                      </p>
                                    ) : (
                                      <>
                                        {erroresReportarPartida[p.id] && (
                                          <div className="form-error">{erroresReportarPartida[p.id]}</div>
                                        )}
                                        <div className="bracket-report">
                                          <button
                                            type="button"
                                            className="btn btn-ghost"
                                            disabled={reportandoPartida === p.id}
                                            onClick={() => handleReportarPartida(p.id, p.jugadorChallengerId)}
                                          >
                                            Ganó {p.jugadorChallengerNombre}
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-ghost"
                                            disabled={reportandoPartida === p.id}
                                            onClick={() => handleReportarPartida(p.id, p.jugadorChallengedId)}
                                          >
                                            Ganó {p.jugadorChallengedNombre}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <h5 className="detail-subtitle">Agregar partida</h5>
                            {erroresAgregarPartida[r.id] && (
                              <div className="form-error">{erroresAgregarPartida[r.id]}</div>
                            )}
                            <div className="form-group">
                              <label className="form-label" htmlFor={`partida-challenger-${r.id}`}>
                                Jugador de {r.challengerNombre}
                              </label>
                              <select
                                id={`partida-challenger-${r.id}`}
                                className="form-select"
                                value={jugadorChallengerPorReto[r.id] ?? ""}
                                onChange={(e) =>
                                  setJugadorChallengerPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                }
                              >
                                <option value="">Selecciona un jugador</option>
                                {rosterChallenger.map((m) => (
                                  <option key={m.userId} value={m.userId}>
                                    {m.nick ?? "Jugador de RemorApp"}
                                    {m.uniqueId ? `#${m.uniqueId}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor={`partida-challenged-${r.id}`}>
                                Jugador de {r.challengedNombre}
                              </label>
                              <select
                                id={`partida-challenged-${r.id}`}
                                className="form-select"
                                value={jugadorChallengedPorReto[r.id] ?? ""}
                                onChange={(e) =>
                                  setJugadorChallengedPorReto((prev) => ({ ...prev, [r.id]: e.target.value }))
                                }
                              >
                                <option value="">Selecciona un jugador</option>
                                {rosterChallenged.map((m) => (
                                  <option key={m.userId} value={m.userId}>
                                    {m.nick ?? "Jugador de RemorApp"}
                                    {m.uniqueId ? `#${m.uniqueId}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={agregandoPartida === r.id}
                              onClick={() => handleAgregarPartida(r.id)}
                            >
                              {agregandoPartida === r.id ? "Agregando..." : "Agregar partida"}
                            </button>

                            <h5 className="detail-subtitle">Cerrar Clan War</h5>
                            <p className="tournament-card-meta">
                              Tu confirmación de cierre: {miCierreConfirmado ? "Confirmado" : "Pendiente"} ·
                              Confirmación de {rivalNombre}: {cierreRivalConfirmado ? "Confirmado" : "Pendiente"}
                            </p>
                            {erroresCerrar[r.id] && <div className="form-error">{erroresCerrar[r.id]}</div>}
                            {!miCierreConfirmado && (
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={cerrando === r.id}
                                onClick={() => handleCerrarClanWar(r.id)}
                              >
                                {cerrando === r.id ? "Cerrando..." : "Cerrar Clan War"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <h4 className="detail-subtitle">Proponer un reto</h4>
              <form className="auth-form" onSubmit={handleProponerReto}>
                {errorReto && <div className="form-error">{errorReto}</div>}
                {retoEnviado && <div className="form-success">¡Reto propuesto!</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="reto-tag">
                    Tag del equipo rival
                  </label>
                  <input
                    id="reto-tag"
                    className="form-input"
                    type="text"
                    placeholder="QSQD"
                    value={tagRivalReto}
                    onChange={(e) => setTagRivalReto(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reto-fecha-hora">
                    Fecha y hora (tu hora local)
                  </label>
                  <input
                    id="reto-fecha-hora"
                    className="form-input"
                    type="datetime-local"
                    value={fechaHoraReto}
                    onChange={(e) => setFechaHoraReto(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-ghost btn-block" disabled={proponiendoReto}>
                  {proponiendoReto ? "Proponiendo..." : "Proponer reto"}
                </button>
              </form>
              </>
              )}

              {seccionPanel === "eventos" && (
              <>
              <h4 className="detail-subtitle">Historial de retos</h4>
              {historialRetos.length === 0 ? (
                <p className="detail-empty">Todavía no hay retos resueltos.</p>
              ) : (
                <div className="detail-participant-list">
                  {historialRetos.map((r) => (
                    <div key={r.id} className="reto-item">
                      <p className="reto-desc">
                        {r.challengerNombre} vs {r.challengedNombre}
                        <span className="reto-status">{r.status}</span>
                      </p>
                      <p className="reto-fecha">Hora CET: {formatearHoraCet(r.fechaHoraCet)}</p>
                      {r.status === "rechazada" && r.motivoRechazo && (
                        <p className="reto-motivo">
                          Motivo: {r.motivoRechazo}
                          {r.motivoRechazo === "Otro" && r.motivoDetalle ? ` — ${r.motivoDetalle}` : ""}
                        </p>
                      )}
                      {r.status === "finalizada" && (
                        <p className="tournament-card-meta">
                          Ganó{" "}
                          {r.ganadorTeamId === r.challengerTeamId ? r.challengerNombre : r.challengedNombre}
                        </p>
                      )}
                      {r.status === "empatada" && (
                        <p className="tournament-card-meta">
                          Empate en partidas ganadas -- sin ajuste de MMR de clan.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <h4 className="detail-subtitle">Torneos jugados</h4>
              {torneosParticipados.length === 0 ? (
                <p className="detail-empty">Todavía no participaste en ningún torneo finalizado.</p>
              ) : (
                <div className="detail-participant-list">
                  {torneosParticipados.map((t) => (
                    <div key={t.id} className="reto-item">
                      <p className="reto-desc">
                        {t.nombre}
                        <span className="reto-status">{t.resultado}</span>
                      </p>
                      <p className="reto-fecha">{formatFecha(t.fechaInicio)}</p>
                      <Link to={`/tournaments/${t.id}`} className="btn-link">
                        Ver torneo
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              </>
              )}

              {seccionPanel === "configuracion" && (
              <>
              <h3 className="detail-subtitle">Títulos Padre/Hijo</h3>
              <p className="tournament-card-meta">
                Se resuelven solos cuando se cierra una Clan War real entre los dos equipos.
              </p>

              <h4 className="detail-subtitle">Pendientes de responder</h4>
              {titulosPendientesResponder.length === 0 ? (
                <p className="detail-empty">No tienes propuestas de título pendientes de responder.</p>
              ) : (
                <div className="detail-participant-list">
                  {titulosPendientesResponder.map((t) => (
                    <div key={t.id} className="reto-item">
                      <p className="reto-desc">
                        {t.retadorNombre} te reta a un título ({t.duracionDias} días)
                      </p>
                      {erroresResponderTitulo[t.id] && (
                        <div className="form-error">{erroresResponderTitulo[t.id]}</div>
                      )}
                      <div className="invitation-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={respondiendoTitulo === t.id}
                          onClick={() => handleResponderTitulo(t.id, true)}
                        >
                          Aceptar
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={respondiendoTitulo === t.id}
                          onClick={() => handleResponderTitulo(t.id, false)}
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="detail-subtitle">Propuestos por mí</h4>
              {titulosPropuestosPorMi.length === 0 ? (
                <p className="detail-empty">No propusiste ningún título.</p>
              ) : (
                <div className="detail-participant-list">
                  {titulosPropuestosPorMi.map((t) => (
                    <div key={t.id} className="reto-item">
                      <p className="reto-desc">
                        Título contra {t.retadoNombre} ({t.duracionDias} días)
                        <span className="reto-status">
                          {t.aceptado ? "Acordado, esperando la CW" : "Esperando respuesta"}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="detail-subtitle">Proponer un título</h4>
              <form className="auth-form" onSubmit={handleProponerTitulo}>
                {errorTitulo && <div className="form-error">{errorTitulo}</div>}
                {tituloEnviado && <div className="form-success">¡Título propuesto!</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="titulo-tag">
                    Tag del equipo rival
                  </label>
                  <input
                    id="titulo-tag"
                    className="form-input"
                    type="text"
                    placeholder="QSQD"
                    value={tagRivalTitulo}
                    onChange={(e) => setTagRivalTitulo(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="titulo-duracion">
                    Duración (entre 7 y 90 días)
                  </label>
                  <input
                    id="titulo-duracion"
                    className="form-input"
                    type="number"
                    min={7}
                    max={90}
                    value={duracionTitulo}
                    onChange={(e) => setDuracionTitulo(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-ghost btn-block" disabled={proponiendoTitulo}>
                  {proponiendoTitulo ? "Proponiendo..." : "Proponer título"}
                </button>
              </form>

              <div className="team-panel-danger-zone">
                <h3 className="detail-subtitle">Zona de peligro</h3>
                <p className="tournament-card-meta">
                  Eliminar el equipo es una acción irreversible. Solo se puede hacer si no tiene otros
                  miembros y no tiene historial de Clan Wars ni de torneos.
                </p>
                {errorEliminarEquipo && <div className="form-error">{errorEliminarEquipo}</div>}
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  disabled={eliminandoEquipoDefinitivo}
                  onClick={handleEliminarEquipoDefinitivo}
                >
                  {eliminandoEquipoDefinitivo ? "Eliminando..." : "Eliminar equipo"}
                </button>
              </div>
              </>
              )}

              {seccionPanel === "logros" && (
                <>
                  <h3 className="detail-subtitle">Desbloqueadas por nivel</h3>
                  <p className="detail-empty">
                    Todavía no existe un catálogo de skins o recompensas por nivel -- esta vitrina va a
                    mostrarlas acá en cuanto ese catálogo esté listo.
                  </p>

                  <div className="team-panel-menu">
                    <button
                      type="button"
                      className="team-panel-menu-item"
                      onClick={() => setVistaLogros(vistaLogros === "compradas" ? "desbloqueados" : "compradas")}
                    >
                      <span className="team-panel-menu-item-title">Adquiridas por compra</span>
                      <span className="team-panel-menu-item-desc">Elementos comprados en la Tienda</span>
                    </button>
                  </div>

                  {vistaLogros === "compradas" && (
                    <p className="detail-empty">
                      Aún no tienes elementos comprados -- la Tienda estará disponible próximamente.
                    </p>
                  )}
                </>
              )}

              {seccionPanel === "reportar" && (
                <>
                  <h3 className="detail-subtitle">Reportar un problema</h3>
                  <p className="tournament-card-meta">
                    Se envía directo al staff, no es público ni lo ve el resto del equipo.
                  </p>
                  {errorReporte && <div className="form-error">{errorReporte}</div>}
                  {reporteEnviado && <div className="form-success">Reporte enviado. Gracias.</div>}
                  <form className="auth-form" onSubmit={handleEnviarReporte}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="reporte-asunto">
                        Asunto
                      </label>
                      <input
                        id="reporte-asunto"
                        className="form-input"
                        type="text"
                        maxLength={150}
                        value={asuntoReporte}
                        onChange={(e) => setAsuntoReporte(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="reporte-descripcion">
                        Descripción
                      </label>
                      <textarea
                        id="reporte-descripcion"
                        className="form-textarea"
                        maxLength={2000}
                        value={descripcionReporte}
                        onChange={(e) => setDescripcionReporte(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary btn-block" disabled={enviandoReporte}>
                      {enviandoReporte ? "Enviando..." : "Enviar reporte"}
                    </button>
                  </form>
                </>
              )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
