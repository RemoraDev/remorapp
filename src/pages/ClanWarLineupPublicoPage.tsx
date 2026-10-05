import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Pencil, Share2 } from "lucide-react";
import confetti from "canvas-confetti";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { compartirImagenDeNodo, descargarImagenDeNodo } from "../lib/compartirImagen";
import { formatFecha } from "../lib/formatters";
import { datetimeLocalAIso, formatearHoraCet, formatearHoraLocal, vencioPlazoEdicionLineup } from "../lib/clanWars";
import TarjetaLineupClanWar, { StreamerBanner } from "../components/TarjetaLineupClanWar";
import { formatearCuentaRegresiva, useAhora } from "../components/ProximasClanWars";
import LineupFondoPicker from "../components/LineupFondoPicker";
import EstructuraLineupPicker from "../components/EstructuraLineupPicker";
import AspectoLineupPicker from "../components/AspectoLineupPicker";
import type { LineupEditorClanWar, LineupPublicoClanWar } from "../types/clanWars";

// Vista pública del lineup de una Clan War (migración 066, con la
// tarjeta visual de la migración 067): a la que lleva la tarjeta de
// "Clan Wars próximas" en Inicio, una vez que lineup_revelado es true.
// Usa lineup_publico_clan_war() -- un solo jsonb armado en la base
// (mismo espíritu que overlay_clan_war()), sin exponer clan_war_lineup
// en crudo a nadie no involucrado. Si alguien llega acá con el link
// directo antes de que se revele, la función igual responde (con
// revelado: false y los lineups en null), así que esta vista solo
// tiene que mostrar el aviso de espera en ese caso.
//
// Migración 123: además, si quien mira es capitán/dueño de alguno de
// los dos equipos, lineup_editor_clan_war() trae todo lo necesario
// para gestionar acá mismo el fondo, la cantidad de jugadores por
// lado, el armado del lineup propio y el visto bueno -- antes vivía
// en "Panel de control -> Eventos" de la ficha del equipo.
export default function ClanWarLineupPublicoPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [datos, setDatos] = useState<LineupPublicoClanWar | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<LineupEditorClanWar | null>(null);
  // Migración 134: "Look" (apariencia), "Agregar y quitar" (jugadores,
  // delay, streamer) y "Solicitud" (cambiar fecha) son pestañas que se
  // excluyen entre sí -- corrección: antes eran 3 toggles
  // independientes que se apilaban uno debajo del otro; ahora abrir uno
  // cierra el que estuviera abierto, como cualquier grupo de pestañas.
  const [panelActivo, setPanelActivo] = useState<"look" | "agregar_quitar" | "solicitud" | null>(null);
  // "Look" (migraciones 127 y 129): sub-pestañas de apariencia dentro
  // del panel -- Fondo (ya existía), Estructura (maqueta de la
  // tarjeta) y Dimensión (relación de aspecto), las tres separadas del
  // resto de la gestión (lineup, stream, visto bueno).
  const [seccionLook, setSeccionLook] = useState<"fondo" | "estructura" | "dimension">("fondo");
  // "Agregar y quitar" (migración 134): Jugadores (roster + cantidad
  // por lado, ya existían, antes sueltos debajo de "Tu stream"), Delay
  // y Streamer (los dos nuevos, ver más abajo).
  const [seccionAgregarQuitar, setSeccionAgregarQuitar] = useState<"jugadores" | "delay" | "streamer">("jugadores");

  const [jugadoresPorSetEditado, setJugadoresPorSetEditado] = useState("");
  const [guardandoJugadoresPorSet, setGuardandoJugadoresPorSet] = useState(false);
  const [errorJugadoresPorSet, setErrorJugadoresPorSet] = useState<string | null>(null);

  // Buscador de jugador con autocompletado (migración 126): jugadorNuevo
  // guarda la selección real ("real:<id>" o "temp:<id>", mismo formato
  // de siempre para armar_lineup_cw()); busquedaJugador es solo el
  // texto que se ve en el input mientras se escribe/filtra.
  const [busquedaJugador, setBusquedaJugador] = useState("");
  const [jugadorNuevo, setJugadorNuevo] = useState("");
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const [creandoTemporal, setCreandoTemporal] = useState(false);
  const [errorTemporal, setErrorTemporal] = useState<string | null>(null);
  const buscadorJugadorRef = useRef<HTMLDivElement | null>(null);
  const [posicionNueva, setPosicionNueva] = useState("");
  const [linkNuevo, setLinkNuevo] = useState("");
  const [esSuplenteNuevo, setEsSuplenteNuevo] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [errorAgregar, setErrorAgregar] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);

  // Compartir/descargar la tarjeta de lineup ya revelada (mismo par de
  // herramientas que el marcador de Race War y el bracket de torneos):
  // captura el nodo tal cual se ve en pantalla (con la maqueta,
  // dimensión y fondo que haya elegido el capitán/caster en "Look"),
  // sin armar una versión aparte -- folder distinto al de Race War,
  // que si necesitaba una tarjeta vertical propia porque el marcador
  // real es horizontal y no entra en formato historia.
  const tarjetaLineupRef = useRef<HTMLDivElement>(null);
  const [compartiendoLineup, setCompartiendoLineup] = useState(false);
  const [descargandoLineup, setDescargandoLineup] = useState(false);

  const nombreArchivoLineup = () =>
    `lineup-${datos ? `${datos.challenger.tag}-vs-${datos.challenged.tag}` : "clan-war"}`
      .replace(/[^a-z0-9-]+/gi, "-")
      .toLowerCase() + ".png";

  const handleDescargarLineup = async () => {
    if (!tarjetaLineupRef.current || descargandoLineup) return;
    setDescargandoLineup(true);
    await descargarImagenDeNodo(tarjetaLineupRef.current, nombreArchivoLineup());
    setDescargandoLineup(false);
  };

  const handleCompartirLineup = async () => {
    if (!tarjetaLineupRef.current || compartiendoLineup) return;
    setCompartiendoLineup(true);
    const texto = datos
      ? `${datos.challenger.tag} vs ${datos.challenged.tag} -- lineup en RemorApp`
      : "Lineup en RemorApp";
    await compartirImagenDeNodo(tarjetaLineupRef.current, nombreArchivoLineup(), texto);
    setCompartiendoLineup(false);
  };

  // Stream propio de cada equipo (migración 125): se inicializa una
  // sola vez con lo que ya tenía cargado, para no pisar lo que el
  // usuario está tipeando en cada refresco de recargarTodo(). Migración
  // 133: suma nombre del streamer y delay en segundos -- viven en el
  // mismo estado porque actualizar_stream_equipo_cw() guarda los tres
  // juntos (las sub-pestañas Delay/Streamer solo muestran una parte
  // cada una, pero comparten el mismo "Guardar").
  const [streamLinkEditado, setStreamLinkEditado] = useState("");
  const [streamerNombreEditado, setStreamerNombreEditado] = useState("");
  const [delaySegundosEditado, setDelaySegundosEditado] = useState("0");
  const [streamInicializado, setStreamInicializado] = useState(false);
  const [guardandoStream, setGuardandoStream] = useState(false);
  const [errorStream, setErrorStream] = useState<string | null>(null);
  const [mostrarSugerenciasStreamer, setMostrarSugerenciasStreamer] = useState(false);
  const streamerBuscadorRef = useRef<HTMLDivElement | null>(null);

  // Reprogramación (migración 045, ahora también accesible desde acá --
  // antes solo vivía en el Panel de control de la ficha del equipo).
  const [reprogramacion, setReprogramacion] = useState<{
    id: string;
    propuestoPor: string;
    nuevaFechaHoraCet: string;
    motivo: string | null;
  } | null>(null);
  const [nuevaFechaReprogramacion, setNuevaFechaReprogramacion] = useState("");
  const [motivoReprogramacion, setMotivoReprogramacion] = useState("");
  const [solicitandoReprogramacion, setSolicitandoReprogramacion] = useState(false);
  const [respondiendoReprogramacion, setRespondiendoReprogramacion] = useState(false);
  const [errorReprogramacion, setErrorReprogramacion] = useState<string | null>(null);

  // Cooldown de la Clan War "en curso" (migración 132): si nadie la
  // cierra a mano, se cierra sola al llegar en_curso_vence_en --
  // extenderPlazo suma 1 hora más (solo habilitado en los últimos 10
  // minutos), cerrarClanWar computa el resultado con cerrar_clan_war(),
  // que ya existía (antes solo vivía en la ficha del equipo).
  const [extendiendoPlazo, setExtendiendoPlazo] = useState(false);
  const [errorExtenderPlazo, setErrorExtenderPlazo] = useState<string | null>(null);
  const [cerrandoClanWar, setCerrandoClanWar] = useState(false);
  const [errorCerrarClanWar, setErrorCerrarClanWar] = useState<string | null>(null);

  const cargarPublico = useCallback(async () => {
    if (!id) return;
    const { data, error: rpcError } = await supabase.rpc("lineup_publico_clan_war", { p_clan_war_id: id });
    setCargando(false);
    if (rpcError || !data) {
      setError("No se pudo cargar esta Clan War.");
      return;
    }
    setDatos(data as LineupPublicoClanWar);
  }, [id]);

  // Se intenta siempre que haya sesión -- si quien mira no es capitán
  // ni dueño de ninguno de los dos equipos, lineup_editor_clan_war()
  // devuelve un error (esperado) y el botón "Editar" simplemente no
  // aparece, sin mostrar ningún mensaje de error al espectador.
  const cargarEditor = useCallback(async () => {
    if (!id || !user) {
      setEditor(null);
      return;
    }
    // Antes de leer, intenta cerrar sola la Clan War si el plazo de
    // "en curso" ya venció y nadie la cerró a mano -- mismo espíritu
    // que intentar_iniciar_clan_war(), pero disparado por esta visita
    // en vez de por otra mutación (no hace falta un cron).
    await supabase.rpc("intentar_cancelar_clan_war_vencida", { p_clan_war_id: id });
    const { data, error: rpcError } = await supabase.rpc("lineup_editor_clan_war", { p_clan_war_id: id });
    if (rpcError || !data) {
      setEditor(null);
      return;
    }
    setEditor(data as LineupEditorClanWar);
  }, [id, user]);

  // Reprogramación (migración 045): solo la solicitud pendiente, si
  // hay una -- mismo criterio que TeamDetailPage.tsx (solo puede haber
  // una a la vez, ver solicitar_reprogramacion_cw()).
  const cargarReprogramacion = useCallback(async () => {
    if (!id || !user) {
      setReprogramacion(null);
      return;
    }
    const { data } = await supabase
      .from("clan_war_reschedules")
      .select("id, clan_war_id, propuesto_por, nueva_fecha_hora_cet, motivo")
      .eq("clan_war_id", id)
      .eq("status", "pendiente")
      .maybeSingle();
    setReprogramacion(
      data
        ? {
            id: data.id,
            propuestoPor: data.propuesto_por,
            nuevaFechaHoraCet: data.nueva_fecha_hora_cet,
            motivo: data.motivo,
          }
        : null
    );
  }, [id, user]);

  useEffect(() => {
    cargarPublico();
  }, [cargarPublico]);

  useEffect(() => {
    cargarEditor();
  }, [cargarEditor]);

  useEffect(() => {
    cargarReprogramacion();
  }, [cargarReprogramacion]);

  useEffect(() => {
    if (editor && !streamInicializado) {
      setStreamLinkEditado(editor.mi_stream_link ?? "");
      setStreamerNombreEditado(editor.mi_streamer_nombre ?? "");
      setDelaySegundosEditado(String(editor.mi_stream_delay ?? 0));
      setStreamInicializado(true);
    }
  }, [editor, streamInicializado]);

  useEffect(() => {
    if (!mostrarSugerenciasStreamer) return;
    const handleClickFuera = (e: MouseEvent) => {
      if (streamerBuscadorRef.current && !streamerBuscadorRef.current.contains(e.target as Node)) {
        setMostrarSugerenciasStreamer(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [mostrarSugerenciasStreamer]);

  useEffect(() => {
    if (!mostrarSugerencias) return;
    const handleClickFuera = (e: MouseEvent) => {
      if (buscadorJugadorRef.current && !buscadorJugadorRef.current.contains(e.target as Node)) {
        setMostrarSugerencias(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [mostrarSugerencias]);

  const recargarTodo = async () => {
    await Promise.all([cargarPublico(), cargarEditor(), cargarReprogramacion()]);
  };

  const handleGuardarJugadoresPorSet = async () => {
    const valor = Number(jugadoresPorSetEditado);
    if (!valor || valor < 1) {
      setErrorJugadoresPorSet("Tiene que ser al menos 1.");
      return;
    }
    setGuardandoJugadoresPorSet(true);
    setErrorJugadoresPorSet(null);

    const { error: rpcError } = await supabase.rpc("cambiar_jugadores_por_set_cw", {
      p_clan_war_id: id,
      p_jugadores_por_set: valor,
    });

    setGuardandoJugadoresPorSet(false);

    if (rpcError) {
      setErrorJugadoresPorSet(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  const handleAgregar = async () => {
    if (!jugadorNuevo) {
      setErrorAgregar("Selecciona un jugador.");
      return;
    }
    const [tipo, jugadorId] = jugadorNuevo.split(":");

    setAgregando(true);
    setErrorAgregar(null);

    const { error: rpcError } = await supabase.rpc("armar_lineup_cw", {
      p_clan_war_id: id,
      p_accion: "agregar",
      p_jugador_id: tipo === "real" ? jugadorId : null,
      p_jugador_temporal_id: tipo === "temp" ? jugadorId : null,
      p_link_verificacion: linkNuevo.trim() || null,
      p_posicion: posicionNueva ? Number(posicionNueva) : null,
      p_es_suplente: esSuplenteNuevo,
    });

    setAgregando(false);

    if (rpcError) {
      setErrorAgregar(rpcError.message);
      return;
    }

    setJugadorNuevo("");
    setBusquedaJugador("");
    setLinkNuevo("");
    setPosicionNueva("");
    setEsSuplenteNuevo(false);
    await recargarTodo();
  };

  // Migración 126: si lo que se escribió no matchea a nadie del
  // roster, se puede crear un jugador temporal con ese mismo nick al
  // vuelo -- crear_jugador_temporal() devuelve el id nuevo directo, así
  // que ya queda seleccionado sin tener que buscarlo de nuevo.
  const handleCrearTemporal = async (nick: string) => {
    if (!editor) return;
    setCreandoTemporal(true);
    setErrorTemporal(null);

    const { data: nuevoId, error: rpcError } = await supabase.rpc("crear_jugador_temporal", {
      p_team_id: editor.mi_team_id,
      p_nick_temporal: nick,
    });

    setCreandoTemporal(false);

    if (rpcError || !nuevoId) {
      setErrorTemporal(rpcError?.message ?? "No se pudo crear el jugador temporal.");
      return;
    }

    await cargarEditor();
    setJugadorNuevo(`temp:${nuevoId}`);
    setBusquedaJugador(nick);
    setMostrarSugerencias(false);
  };

  const handleQuitar = async (lineupId: string) => {
    setQuitando(lineupId);
    setErrorAgregar(null);

    const { error: rpcError } = await supabase.rpc("armar_lineup_cw", {
      p_clan_war_id: id,
      p_accion: "quitar",
      p_lineup_id: lineupId,
    });

    setQuitando(null);

    if (rpcError) {
      setErrorAgregar(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  const handleConfirmar = async () => {
    setConfirmando(true);
    setErrorConfirmar(null);

    const { error: rpcError } = await supabase.rpc("confirmar_lineup_cw", { p_clan_war_id: id });

    setConfirmando(false);

    if (rpcError) {
      setErrorConfirmar(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  // Guarda los 3 campos juntos (migración 133) -- las sub-pestañas
  // Delay y Streamer solo muestran una parte cada una, pero comparten
  // este mismo botón/estado, así que ninguna pisa lo que cargó la otra.
  const handleGuardarStream = async () => {
    const delaySegundos = Number(delaySegundosEditado);
    if (!Number.isFinite(delaySegundos) || delaySegundos < 0) {
      setErrorStream("El delay tiene que ser 0 o más segundos.");
      return;
    }

    setGuardandoStream(true);
    setErrorStream(null);

    const { error: rpcError } = await supabase.rpc("actualizar_stream_equipo_cw", {
      p_clan_war_id: id,
      p_stream_link: streamLinkEditado.trim() || null,
      p_streamer_nombre: streamerNombreEditado.trim() || null,
      p_delay_segundos: delaySegundos,
    });

    setGuardandoStream(false);

    if (rpcError) {
      setErrorStream(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  // Reprogramar (migración 045, ya existía en el Panel de control de
  // la ficha del equipo -- mismo par de RPCs, ahora también acá).
  const handleSolicitarReprogramacion = async () => {
    if (!nuevaFechaReprogramacion) {
      setErrorReprogramacion("Elige la nueva fecha y hora.");
      return;
    }

    setSolicitandoReprogramacion(true);
    setErrorReprogramacion(null);

    const { error: rpcError } = await supabase.rpc("solicitar_reprogramacion_cw", {
      p_clan_war_id: id,
      p_nueva_fecha_hora_cet: datetimeLocalAIso(nuevaFechaReprogramacion),
      p_motivo: motivoReprogramacion.trim() || null,
    });

    setSolicitandoReprogramacion(false);

    if (rpcError) {
      setErrorReprogramacion(rpcError.message);
      return;
    }

    setNuevaFechaReprogramacion("");
    setMotivoReprogramacion("");
    await recargarTodo();
  };

  const handleResponderReprogramacion = async (aceptar: boolean) => {
    if (!reprogramacion) return;
    setRespondiendoReprogramacion(true);
    setErrorReprogramacion(null);

    const { error: rpcError } = await supabase.rpc("responder_reprogramacion_cw", {
      p_reschedule_id: reprogramacion.id,
      p_aceptar: aceptar,
    });

    setRespondiendoReprogramacion(false);

    if (rpcError) {
      setErrorReprogramacion(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  const handleExtenderPlazo = async () => {
    setExtendiendoPlazo(true);
    setErrorExtenderPlazo(null);

    const { error: rpcError } = await supabase.rpc("extender_plazo_clan_war_en_curso", { p_clan_war_id: id });

    setExtendiendoPlazo(false);

    if (rpcError) {
      setErrorExtenderPlazo(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  // Mismo cerrar_clan_war() que ya usaba la ficha del equipo -- computa
  // el resultado (todos los sets/partidas jugados, sin empate sin
  // resolver) recién cuando los dos capitanes confirmaron el cierre.
  const handleCerrarClanWar = async () => {
    if (
      !window.confirm(
        "¿Confirmas que quieres cerrar esta Clan War? El equipo con más partidas ganadas se lleva el ajuste de MMR de clan. Hace falta que los dos capitanes confirmen el cierre."
      )
    ) {
      return;
    }

    setCerrandoClanWar(true);
    setErrorCerrarClanWar(null);

    const { error: rpcError } = await supabase.rpc("cerrar_clan_war", { p_clan_war_id: id });

    setCerrandoClanWar(false);

    if (rpcError) {
      setErrorCerrarClanWar(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  // Corrección: el plazo de edición del lineup (30 min antes de la
  // hora del reto, o la extensión aprobada) es para coordinar la
  // revelación simultánea en Clan Wars DE TORNEO, donde afecta la
  // tabla de posiciones -- una Clan War amistosa no tiene ese problema
  // y ya se podía subir/bajar la cantidad de jugadores en cualquier
  // momento (ver más abajo), así que el lineup en sí tiene que seguir
  // el mismo criterio: sin plazo salvo que sea de torneo.
  const vencioPlazo =
    editor && editor.es_de_torneo
      ? vencioPlazoEdicionLineup(
          editor.fecha_hora_cet,
          editor.lineup_plazo_extendido_hasta,
          Date.now(),
          editor.ventana_revelacion_minutos
        )
      : false;

  const puedeGestionar = !!editor && (editor.status === "aceptada" || editor.status === "en_curso");

  // Cooldown de la Clan War "en curso" (migración 132) -- el botón de
  // extender solo aparece en los últimos 10 minutos antes del cierre
  // automático, para que no se use como forma de posponerla desde el
  // principio. ahora (con tick propio) es lo que hace que el aviso y
  // el botón aparezcan solos, sin necesitar que alguien recargue.
  const ahora = useAhora(30000);
  const enCurso = editor?.status === "en_curso" && !!editor.en_curso_vence_en;
  const vencimientoEnCurso = enCurso ? new Date(editor!.en_curso_vence_en!) : null;
  const puedeExtenderPlazo =
    vencimientoEnCurso !== null && vencimientoEnCurso.getTime() - ahora.getTime() <= 10 * 60 * 1000;

  // Buscador de jugador (migración 126): roster elegible + temporales
  // ya creados, todos en una sola lista para filtrar por nick a medida
  // que se escribe. Formato WTL sin temporada admite temporales (ver
  // el comentario de más abajo, migración 120); con temporada, ni
  // siquiera se ofrecen como sugerencia.
  const opcionesJugador = editor
    ? [
        ...editor.roster_elegible.map((op) => ({
          tipo: "real" as const,
          id: op.jugador_id,
          nombre: op.nombre,
          extra: op.es_mercenario ? " (Mercenario)" : op.es_aliado ? " (Aliado)" : "",
        })),
        ...(editor.formato !== "wtl" || !editor.es_de_torneo
          ? editor.temporales_propios.map((t) => ({
              tipo: "temp" as const,
              id: t.id,
              nombre: t.nick_temporal,
              extra: " (Temporal)",
            }))
          : []),
      ]
    : [];
  const sugerenciasJugador = busquedaJugador.trim()
    ? opcionesJugador.filter((o) => o.nombre.toLowerCase().includes(busquedaJugador.trim().toLowerCase()))
    : opcionesJugador;
  const hayCoincidenciaExacta = opcionesJugador.some(
    (o) => o.nombre.toLowerCase() === busquedaJugador.trim().toLowerCase()
  );

  // Streamer (migración 133): mismo roster_elegible del buscador de
  // jugadores de arriba, pero acá el resultado es un texto simple (no
  // una referencia a un jugador) -- si no está en el roster, se
  // escribe a mano y listo.
  const sugerenciasStreamer = editor
    ? editor.roster_elegible.filter((op) =>
        streamerNombreEditado.trim() ? op.nombre.toLowerCase().includes(streamerNombreEditado.trim().toLowerCase()) : true
      )
    : [];

  // Reprogramación (migración 045): "Solicitud" -- si hay una pendiente,
  // se distingue quién la propuso para saber si corresponde esperar o
  // responder.
  const yoPropuseReprogramar = !!reprogramacion && !!editor && reprogramacion.propuestoPor === editor.mi_team_id;
  const reprogramacionesRestantes = editor ? 2 - editor.reprogramaciones_usadas : 2;

  return (
    <section className="section section-page">
      {/* Corrección: "Volver a Inicio" y la fecha/formato eran dos
          líneas de texto plano sueltas -- ahora van juntas en una
          franja, con la fecha como una insignia en vez de texto liso. */}
      <div className="clan-war-lineup-header">
        <Link to="/" className="team-panel-back">
          ← Volver a Inicio
        </Link>
        {datos && (
          <span className="clan-war-lineup-meta">
            {formatFecha(datos.fecha_hora_cet)} · Formato {datos.formato === "wtl" ? "WTL" : "Simple"}
          </span>
        )}
      </div>

      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {error && <div className="form-error">{error}</div>}

      {datos && (
        <>
          {/* Migración 132: la Clan War queda claramente marcada como
              terminada, sin importar cómo haya llegado a ese estado --
              cerrada a mano ("finalizada"/"empatada") o cerrada sola
              por inactividad ("cancelada", el único caso que hoy usa
              ese status). */}
          {(datos.status === "finalizada" || datos.status === "empatada" || datos.status === "cancelada") && (
            <p className="clan-war-estado-terminado">
              {datos.status === "empatada"
                ? "Evento terminado -- empate."
                : datos.status === "cancelada"
                  ? "Evento cerrado automáticamente por inactividad."
                  : "Evento terminado."}
            </p>
          )}

          {/* Migración 145: resultado real, visible para cualquiera
              (antes solo se veía en el panel privado del equipo) --
              botón de celebración solo si hubo un ganador (no en
              empate ni cancelada). */}
          {datos.status === "finalizada" && datos.ganador_team_id && (
            <>
              <p className="form-success">
                Ganó{" "}
                {datos.ganador_team_id === datos.challenger_team_id
                  ? datos.challenger.nombre
                  : datos.challenged.nombre}{" "}
                ({datos.resultado_mapas_challenger} - {datos.resultado_mapas_challenged})
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } })}
              >
                Ver celebración
              </button>
            </>
          )}

          {!datos.revelado ? (
            <>
              {/* Migración 134: el streamer se ve apenas se carga, no
                  hace falta esperar a que se revele el lineup -- acá
                  afuera de la tarjeta (que recién se monta una vez
                  revelado) para que igual se muestre. */}
              <StreamerBanner datos={datos} />
              <p className="detail-empty">
                Todavía no se reveló la alineación de ambos equipos -- volvé a intentarlo más cerca del
                inicio de la Clan War.
              </p>
            </>
          ) : (
            <>
              <div ref={tarjetaLineupRef} className="lineup-card-captura-wrap">
                <TarjetaLineupClanWar datos={datos} />
              </div>
              <div className="lineup-card-acciones">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={compartiendoLineup}
                  onClick={handleCompartirLineup}
                >
                  <Share2 size={16} className="icon-inline" aria-hidden="true" />
                  {compartiendoLineup ? "Generando imagen..." : "Compartir"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={descargandoLineup}
                  onClick={handleDescargarLineup}
                >
                  <Download size={16} className="icon-inline" aria-hidden="true" />
                  {descargandoLineup ? "Generando imagen..." : "Descargar"}
                </button>
              </div>
            </>
          )}

          {puedeGestionar && editor && (
            <div className="clan-war-editor-wrap">
              {/* Cooldown de "en curso" (migración 132): si nadie la
                  cierra a mano, se cierra sola al vencer el plazo --
                  el aviso y el botón de extender aparecen solos (sin
                  recargar) gracias al tick de useAhora(). */}
              {enCurso && vencimientoEnCurso && (
                <div className="clan-war-cooldown">
                  <p className={`clan-war-cooldown-aviso ${puedeExtenderPlazo ? "clan-war-cooldown-aviso-urgente" : ""}`}>
                    Si nadie la cierra, esta Clan War se cierra sola en{" "}
                    {formatearCuentaRegresiva(vencimientoEnCurso, ahora)}.
                  </p>
                  {errorExtenderPlazo && <div className="form-error">{errorExtenderPlazo}</div>}
                  <div className="clan-war-cooldown-botones">
                    {puedeExtenderPlazo && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={extendiendoPlazo}
                        onClick={handleExtenderPlazo}
                      >
                        {extendiendoPlazo ? "Extendiendo..." : "Extender 1 hora más"}
                      </button>
                    )}
                    {!editor.mi_cierre_confirmado && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={cerrandoClanWar}
                        onClick={handleCerrarClanWar}
                      >
                        {cerrandoClanWar ? "Cerrando..." : "Guardar y cerrar Clan War"}
                      </button>
                    )}
                  </div>
                  <p className="tournament-card-meta">
                    Tu confirmación de cierre: {editor.mi_cierre_confirmado ? "Confirmado" : "Pendiente"} · Confirmación
                    de {editor.rival_nombre}: {editor.cierre_confirmado_rival ? "Confirmado" : "Pendiente"}
                  </p>
                  {errorCerrarClanWar && <div className="form-error">{errorCerrarClanWar}</div>}
                </div>
              )}

              <div className="clan-war-editor-toggle-fila">
                <button
                  type="button"
                  className={`clan-war-editor-toggle ${panelActivo === "look" ? "is-active" : ""}`}
                  onClick={() => setPanelActivo((v) => (v === "look" ? null : "look"))}
                >
                  <Pencil className="icon-inline" />
                  Look
                </button>
                <button
                  type="button"
                  className={`clan-war-editor-toggle ${panelActivo === "agregar_quitar" ? "is-active" : ""}`}
                  onClick={() => setPanelActivo((v) => (v === "agregar_quitar" ? null : "agregar_quitar"))}
                >
                  Agregar y quitar
                </button>
                <button
                  type="button"
                  className={`clan-war-editor-toggle clan-war-editor-toggle-derecha ${panelActivo === "solicitud" ? "is-active" : ""}`}
                  onClick={() => setPanelActivo((v) => (v === "solicitud" ? null : "solicitud"))}
                >
                  Solicitud
                </button>
              </div>

              {panelActivo === "look" && (
                <div className="clan-war-lineup-room">
                  {/* "Look" (migraciones 127 y 129): apariencia de la
                      tarjeta -- Fondo, Estructura y Dimensión, en
                      sub-pestañas. Separado del resto de la gestión
                      (migración 134: "Agregar y quitar" y "Solicitud"
                      son paneles aparte, no sub-pestañas de acá). */}
                  <div className="team-info-tabs clan-war-look-tabs">
                    <button
                      type="button"
                      className={`team-info-tab ${seccionLook === "fondo" ? "is-active" : ""}`}
                      onClick={() => setSeccionLook("fondo")}
                    >
                      Fondo
                    </button>
                    <button
                      type="button"
                      className={`team-info-tab ${seccionLook === "estructura" ? "is-active" : ""}`}
                      onClick={() => setSeccionLook("estructura")}
                    >
                      Estructura
                    </button>
                    <button
                      type="button"
                      className={`team-info-tab ${seccionLook === "dimension" ? "is-active" : ""}`}
                      onClick={() => setSeccionLook("dimension")}
                    >
                      Dimensión
                    </button>
                  </div>

                  {seccionLook === "fondo" && (
                    /* Corrección: onCambio solo refrescaba cargarEditor()
                       (el fondo previsualizado acá adentro) -- la
                       tarjeta real de arriba (TarjetaLineupClanWar) usa
                       los datos de lineup_publico_clan_war(), una
                       consulta aparte, así que el cambio de fondo nunca
                       le llegaba. */
                    <LineupFondoPicker
                      fondo={editor.fondo_lineup}
                      fondoImagenId={editor.fondo_lineup_imagen_id}
                      onElegirClasico={async (nuevoFondo) => {
                        const { error } = await supabase.rpc("cambiar_fondo_lineup_cw", {
                          p_clan_war_id: id!,
                          p_fondo: nuevoFondo,
                        });
                        if (!error) await recargarTodo();
                      }}
                      onElegirImagen={async (imagenId) => {
                        const { error } = await supabase.rpc("cambiar_fondo_lineup_imagen_cw", {
                          p_clan_war_id: id!,
                          p_imagen_id: imagenId,
                        });
                        if (!error) await recargarTodo();
                      }}
                    />
                  )}
                  {seccionLook === "estructura" && (
                    <EstructuraLineupPicker
                      clanWarId={id!}
                      estructura={editor.estructura_lineup}
                      onCambio={recargarTodo}
                    />
                  )}
                  {seccionLook === "dimension" && (
                    <AspectoLineupPicker
                      clanWarId={id!}
                      aspecto={editor.aspecto_lineup}
                      onCambio={recargarTodo}
                    />
                  )}
                </div>
              )}

              {panelActivo === "agregar_quitar" && (
                <div className="clan-war-lineup-room">
                  {/* "Agregar y quitar" (migración 134): quién entra y
                      sale de la Clan War -- jugadores del lineup,
                      cantidad por lado, delay del stream y el streamer
                      -- separado de "Look" (apariencia) y "Solicitud"
                      (cambiar la fecha). Antes todo esto vivía suelto,
                      siempre visible, debajo de "Look". */}
                  <div className="team-info-tabs clan-war-look-tabs">
                    <button
                      type="button"
                      className={`team-info-tab ${seccionAgregarQuitar === "jugadores" ? "is-active" : ""}`}
                      onClick={() => setSeccionAgregarQuitar("jugadores")}
                    >
                      Jugadores
                    </button>
                    <button
                      type="button"
                      className={`team-info-tab ${seccionAgregarQuitar === "delay" ? "is-active" : ""}`}
                      onClick={() => setSeccionAgregarQuitar("delay")}
                    >
                      Delay
                    </button>
                    <button
                      type="button"
                      className={`team-info-tab ${seccionAgregarQuitar === "streamer" ? "is-active" : ""}`}
                      onClick={() => setSeccionAgregarQuitar("streamer")}
                    >
                      Streamer
                    </button>
                  </div>

                  {seccionAgregarQuitar === "delay" && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="editor-stream-delay">
                        Delay de tu stream, en segundos (0 = sin delay)
                      </label>
                      <input
                        id="editor-stream-delay"
                        className="form-input"
                        type="number"
                        min={0}
                        value={delaySegundosEditado}
                        onChange={(e) => setDelaySegundosEditado(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={guardandoStream}
                        onClick={handleGuardarStream}
                      >
                        {guardandoStream ? "Guardando..." : "Guardar"}
                      </button>
                      {errorStream && <div className="form-error">{errorStream}</div>}
                      <p className="form-hint">
                        {editor.rival_stream_delay > 0
                          ? `${editor.rival_nombre} tiene un delay de ${editor.rival_stream_delay} segundos.`
                          : `${editor.rival_nombre} no cargó ningún delay.`}
                      </p>
                    </div>
                  )}

                  {seccionAgregarQuitar === "streamer" && (
                    <div className="form-group">
                      <div className="form-group jugador-buscador-wrap" ref={streamerBuscadorRef}>
                        <label className="form-label" htmlFor="editor-streamer-nombre">
                          Streamer de tu equipo (opcional)
                        </label>
                        <input
                          id="editor-streamer-nombre"
                          className="form-input"
                          type="text"
                          autoComplete="off"
                          placeholder="Busca en tu equipo, o escribe el nombre a mano"
                          value={streamerNombreEditado}
                          onChange={(e) => {
                            setStreamerNombreEditado(e.target.value);
                            setMostrarSugerenciasStreamer(true);
                          }}
                          onFocus={() => setMostrarSugerenciasStreamer(true)}
                        />
                        {mostrarSugerenciasStreamer && sugerenciasStreamer.length > 0 && (
                          <div className="jugador-buscador-sugerencias">
                            {sugerenciasStreamer.map((op) => (
                              <button
                                key={op.jugador_id}
                                type="button"
                                className="jugador-buscador-sugerencia"
                                onClick={() => {
                                  setStreamerNombreEditado(op.nombre);
                                  setMostrarSugerenciasStreamer(false);
                                }}
                              >
                                {op.nombre}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <label className="form-label" htmlFor="editor-stream-link">
                        Link del stream (opcional)
                      </label>
                      <input
                        id="editor-stream-link"
                        className="form-input"
                        type="text"
                        placeholder="https://twitch.tv/tu_canal"
                        value={streamLinkEditado}
                        onChange={(e) => setStreamLinkEditado(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={guardandoStream}
                        onClick={handleGuardarStream}
                      >
                        {guardandoStream ? "Guardando..." : "Guardar"}
                      </button>
                      {errorStream && <div className="form-error">{errorStream}</div>}
                      <p className="form-hint">
                        {editor.rival_stream_link
                          ? `Stream de ${editor.rival_nombre}: ${editor.rival_streamer_nombre ?? editor.rival_nombre} -- ${editor.rival_stream_link}`
                          : `${editor.rival_nombre} todavía no cargó su stream.`}
                      </p>
                    </div>
                  )}

                  {seccionAgregarQuitar === "jugadores" && (
                    <>
                      {!editor.es_de_torneo && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="editor-jugadores-por-set">
                            Cantidad de jugadores por lado
                          </label>
                          <input
                            id="editor-jugadores-por-set"
                            className="form-input"
                            type="number"
                            min={1}
                            value={jugadoresPorSetEditado || String(editor.jugadores_por_set)}
                            onChange={(e) => setJugadoresPorSetEditado(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={guardandoJugadoresPorSet}
                            onClick={handleGuardarJugadoresPorSet}
                          >
                            {guardandoJugadoresPorSet ? "Guardando..." : "Actualizar cantidad"}
                          </button>
                          {errorJugadoresPorSet && <div className="form-error">{errorJugadoresPorSet}</div>}
                          <p className="form-hint">
                            Al ser una Clan War amistosa, se puede subir o bajar en cualquier momento -- no
                            hace falta que los dos capitanes se pongan de acuerdo de nuevo con el lineup.
                          </p>
                        </div>
                      )}

                      <h5 className="detail-subtitle">Lineup: tu equipo</h5>
                      {errorAgregar && <div className="form-error">{errorAgregar}</div>}
                      {editor.lineup_propio.length === 0 ? (
                        <p className="detail-empty">Todavía no agregaste jugadores al lineup.</p>
                      ) : (
                        <div className="detail-participant-list">
                          {editor.lineup_propio.map((entry) => (
                            <div key={entry.id} className="detail-participant-item">
                              {entry.posicion && <span className="liga-badge">Pos. {entry.posicion}</span>}
                              {entry.nombre}
                              {entry.es_temporal && <span className="team-temp-badge">Temporal</span>}
                              {entry.es_suplente && <span className="team-temp-badge">Suplente</span>}
                              {entry.link_verificacion && (
                                <a
                                  href={entry.link_verificacion}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="btn-link"
                                >
                                  Verificación
                                </a>
                              )}
                              {!vencioPlazo && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={quitando === entry.id}
                                  onClick={() => handleQuitar(entry.id)}
                                >
                                  {quitando === entry.id ? "Quitando..." : "Quitar"}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {vencioPlazo ? (
                        <p className="form-hint">
                          El plazo para seguir editando tu lineup ya venció -- pedile al staff o al equipo
                          rival una extensión desde el Panel de control de tu equipo.
                        </p>
                      ) : (
                        <>
                          <div className="form-group jugador-buscador-wrap" ref={buscadorJugadorRef}>
                            <label className="form-label" htmlFor="editor-lineup-jugador">
                              Agregar jugador
                            </label>
                            <input
                              id="editor-lineup-jugador"
                              className="form-input"
                              type="text"
                              autoComplete="off"
                              placeholder="Escribe el nick de tu equipo..."
                              value={busquedaJugador}
                              onChange={(e) => {
                                setBusquedaJugador(e.target.value);
                                setJugadorNuevo("");
                                setMostrarSugerencias(true);
                              }}
                              onFocus={() => setMostrarSugerencias(true)}
                            />
                            {mostrarSugerencias && (
                              <div className="jugador-buscador-sugerencias">
                                {sugerenciasJugador.length === 0 && !busquedaJugador.trim() && (
                                  <p className="jugador-buscador-vacio">Escribe para buscar en tu equipo.</p>
                                )}
                                {sugerenciasJugador.map((op) => (
                                  <button
                                    key={`${op.tipo}:${op.id}`}
                                    type="button"
                                    className="jugador-buscador-sugerencia"
                                    onClick={() => {
                                      setJugadorNuevo(`${op.tipo}:${op.id}`);
                                      setBusquedaJugador(op.nombre);
                                      setMostrarSugerencias(false);
                                    }}
                                  >
                                    {op.nombre}
                                    {op.extra}
                                  </button>
                                ))}
                                {/* Migración 126: si lo que se escribió no
                                    coincide con nadie del roster, se ofrece
                                    crearlo como jugador temporal al vuelo --
                                    sin salir del formulario ni ir a otra
                                    pantalla a crearlo primero. */}
                                {busquedaJugador.trim().length >= 3 && !hayCoincidenciaExacta && (
                                  <button
                                    type="button"
                                    className="jugador-buscador-sugerencia jugador-buscador-crear"
                                    disabled={creandoTemporal}
                                    onClick={() => handleCrearTemporal(busquedaJugador.trim())}
                                  >
                                    {creandoTemporal
                                      ? "Creando..."
                                      : `+ Crear jugador temporal "${busquedaJugador.trim()}"`}
                                  </button>
                                )}
                              </div>
                            )}
                            {errorTemporal && <div className="form-error">{errorTemporal}</div>}
                          </div>
                          <div className="form-group">
                            <label className="form-checkbox-label">
                              <input
                                type="checkbox"
                                checked={esSuplenteNuevo}
                                onChange={(e) => setEsSuplenteNuevo(e.target.checked)}
                              />
                              Es suplente
                            </label>
                            <p className="form-hint">
                              Un suplente se anota igual, sin ocupar ninguna de las posiciones que se van a
                              jugar -- sirve para reemplazar a un titular si el rival reporta un problema.
                            </p>
                          </div>
                          {editor.formato === "wtl" && !esSuplenteNuevo && (
                            <div className="form-group">
                              <label className="form-label" htmlFor="editor-lineup-posicion">
                                Posición (1 a {editor.jugadores_por_set})
                              </label>
                              <select
                                id="editor-lineup-posicion"
                                className="form-select"
                                value={posicionNueva}
                                onChange={(e) => setPosicionNueva(e.target.value)}
                              >
                                <option value="">Selecciona la posición</option>
                                {Array.from({ length: editor.jugadores_por_set }, (_, i) => i + 1).map((pos) => (
                                  <option key={pos} value={pos}>
                                    Posición {pos}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="form-group">
                            <label className="form-label" htmlFor="editor-lineup-link">
                              Link de verificación (opcional)
                            </label>
                            <input
                              id="editor-lineup-link"
                              className="form-input"
                              type="text"
                              placeholder="https://sc2pulse.nephest.com/..."
                              value={linkNuevo}
                              onChange={(e) => setLinkNuevo(e.target.value)}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={agregando}
                            onClick={handleAgregar}
                          >
                            {agregando ? "Agregando..." : "Agregar al lineup"}
                          </button>
                        </>
                      )}

                      <h5 className="detail-subtitle">Lineup de {editor.rival_nombre}</h5>
                      {editor.lineup_rival.length === 0 ? (
                        <p className="detail-empty">{editor.rival_nombre} todavía no anotó ningún jugador.</p>
                      ) : (
                        <div className="detail-participant-list">
                          {editor.lineup_rival.map((entry, indice) => (
                            <div key={indice} className="detail-participant-item">
                              {entry.posicion && <span className="liga-badge">Pos. {entry.posicion}</span>}
                              {editor.lineup_revelado ? (
                                <>
                                  {entry.nombre}
                                  {entry.es_temporal && <span className="team-temp-badge">Temporal</span>}
                                  {entry.link_verificacion && (
                                    <a
                                      href={entry.link_verificacion}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="btn-link"
                                    >
                                      Verificación
                                    </a>
                                  )}
                                </>
                              ) : (
                                <span className="tournament-card-meta">
                                  Jugador anotado (oculto hasta el visto bueno)
                                </span>
                              )}
                              {entry.es_suplente && <span className="team-temp-badge">Suplente</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {panelActivo === "solicitud" && (
                <div className="clan-war-lineup-room">
                  {/* "Solicitud" (migración 134, reutiliza solicitar_
                      reprogramacion_cw()/responder_reprogramacion_cw()
                      de la migración 045 -- antes solo vivían en el
                      Panel de control de la ficha del equipo, nunca acá
                      en el lobby). Solo tiene sentido con la CW
                      "aceptada" -- una vez en curso ya no se puede
                      reprogramar (ver el chequeo en la propia RPC). */}
                  <h5 className="detail-subtitle">Cambiar fecha</h5>
                  {errorReprogramacion && <div className="form-error">{errorReprogramacion}</div>}
                  {editor.status !== "aceptada" ? (
                    <p className="detail-empty">
                      Solo se puede solicitar un cambio de fecha mientras la Clan War está aceptada, antes
                      del check-in.
                    </p>
                  ) : reprogramacion ? (
                    yoPropuseReprogramar ? (
                      <p className="tournament-card-meta">
                        Propusiste cambiar la fecha a {formatearHoraLocal(reprogramacion.nuevaFechaHoraCet)} (
                        {formatearHoraCet(reprogramacion.nuevaFechaHoraCet)} CET)
                        {reprogramacion.motivo && <> -- Motivo: {reprogramacion.motivo}</>}. Esperando la
                        respuesta de {editor.rival_nombre}.
                      </p>
                    ) : (
                      <>
                        <p className="tournament-card-meta">
                          {editor.rival_nombre} propuso cambiar la fecha a{" "}
                          {formatearHoraLocal(reprogramacion.nuevaFechaHoraCet)} (
                          {formatearHoraCet(reprogramacion.nuevaFechaHoraCet)} CET)
                          {reprogramacion.motivo && <> -- Motivo: {reprogramacion.motivo}</>}.
                        </p>
                        <div className="bracket-report">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={respondiendoReprogramacion}
                            onClick={() => handleResponderReprogramacion(true)}
                          >
                            {respondiendoReprogramacion ? "Guardando..." : "Aceptar"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={respondiendoReprogramacion}
                            onClick={() => handleResponderReprogramacion(false)}
                          >
                            {respondiendoReprogramacion ? "Guardando..." : "Rechazar"}
                          </button>
                        </div>
                      </>
                    )
                  ) : reprogramacionesRestantes <= 0 ? (
                    <p className="tournament-card-meta">
                      Ya se usaron las 2 reprogramaciones permitidas para esta Clan War.
                    </p>
                  ) : (
                    <div className="form-group">
                      <label className="form-label" htmlFor="reprogramar-fecha">
                        Nueva fecha y hora (tu hora local)
                      </label>
                      <input
                        id="reprogramar-fecha"
                        className="form-input"
                        type="datetime-local"
                        value={nuevaFechaReprogramacion}
                        onChange={(e) => setNuevaFechaReprogramacion(e.target.value)}
                      />
                      <label className="form-label" htmlFor="reprogramar-motivo">
                        Motivo (opcional)
                      </label>
                      <input
                        id="reprogramar-motivo"
                        className="form-input"
                        type="text"
                        value={motivoReprogramacion}
                        onChange={(e) => setMotivoReprogramacion(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={solicitandoReprogramacion}
                        onClick={handleSolicitarReprogramacion}
                      >
                        {solicitandoReprogramacion ? "Solicitando..." : "Solicitar cambio de fecha"}
                      </button>
                      <p className="form-hint">
                        Te queda{reprogramacionesRestantes === 1 ? "" : "n"} {reprogramacionesRestantes}{" "}
                        reprogramaci{reprogramacionesRestantes === 1 ? "ón" : "ones"} para esta Clan War.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <p className="tournament-card-meta" style={{ marginTop: "1rem" }}>
                Tu visto bueno: {editor.mi_visto_bueno ? "Confirmado" : "Pendiente"} · Visto bueno de{" "}
                {editor.rival_nombre}: {editor.visto_bueno_rival ? "Confirmado" : "Pendiente"}
              </p>
              {errorConfirmar && <div className="form-error">{errorConfirmar}</div>}
              {!editor.mi_visto_bueno && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={confirmando || editor.lineup_propio.length === 0}
                  onClick={handleConfirmar}
                >
                  {confirmando ? "Confirmando..." : "Dar el visto bueno al lineup"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
