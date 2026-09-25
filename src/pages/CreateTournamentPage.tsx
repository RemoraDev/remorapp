import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import InfoTooltip from "../components/InfoTooltip";
import ModoIcono from "../components/ModoIcono";
import TipoEventoIcono from "../components/TipoEventoIcono";
import { MODOS, getFormatoLabel } from "../lib/tournamentOptions";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { datetimeLocalAIso, BO_OPTIONS } from "../lib/clanWars";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import type { TorneoFormato, TorneoModo } from "../types/tournaments";
import type { DivisionLiga, Liga } from "../types/ranking";

const FORMATOS: TorneoFormato[] = ["1v1", "2v2", "3v3", "4v4", "wtl"];

// Migración 091: se simplifica de 3 opciones a 2 -- "Evento privado"
// desaparece (un torneo por ligas siempre es público) y "Torneo
// amistoso" se reemplaza por "Clan War Amistosa": ya no es un torneo
// con cupos y llave, sino el reto directo entre dos clanes (mismo
// mecanismo que "Retar a otro clan" del Panel de control del equipo),
// con un formulario mínimo y una invitación por buscador en vez de
// tener que escribir el tag exacto del rival.
type TipoEvento = "liga" | "amistosa";

const TIPOS_EVENTO: { value: TipoEvento; label: string; descripcion: string }[] = [
  {
    value: "amistosa",
    label: "Clan War Amistosa",
    descripcion:
      "Reto directo entre tu clan y otro: elige el formato, la fecha y el clan rival -- sin llave ni cupos, es directamente esa Clan War.",
  },
  {
    value: "liga",
    label: "Torneo por ligas",
    descripcion:
      "Parte de una competencia oficial con ranking (StarLeague Latam, BTL, etc.). Cualquier formato -- en 2v2/3v3/4v4, los clanes entran por invitación o solicitud, no por inscripción libre.",
  },
];

// Tolerancia de reloj/tiempo de carga del formulario -- mismo margen
// que usa el trigger validar_fecha_inicio_torneo() en la base
// (migración 074), para no rechazar en el cliente algo que la base
// aceptaría o viceversa.
const TOLERANCIA_FECHA_MS = 5 * 60 * 1000;

// Migración 095: mismo límite de 60 días que exige
// validar_fecha_inicio_torneo() en la base -- acá es solo para
// acotar el selector de fecha y mostrar el aviso, la validación real
// vive en el trigger.
const LIMITE_ANTICIPACION_DIAS = 60;

// El input datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local,
// sin zona horaria -- toISOString() da UTC con "Z", hay que armarlo a
// mano para que el límite se vea en la hora del propio navegador.
function fechaMaximaDatetimeLocal(): string {
  const limite = new Date(Date.now() + LIMITE_ANTICIPACION_DIAS * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${limite.getFullYear()}-${pad(limite.getMonth() + 1)}-${pad(limite.getDate())}T${pad(limite.getHours())}:${pad(limite.getMinutes())}`;
}

export default function CreateTournamentPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Paso del asistente (migración 079): 1 = info básica, 2 = fecha y
  // cupos, 3 = liga y divisiones (solo si tipoEvento === "liga"), 4 =
  // temporada (solo si tipoEvento === "liga"). Los eventos que no son
  // de liga terminan en el paso 2.
  const [paso, setPaso] = useState(1);

  const [nombre, setNombre] = useState("");
  const [tipoEvento, setTipoEvento] = useState<TipoEvento>("amistosa");
  const [formato, setFormato] = useState<TorneoFormato>("1v1");
  const [modo, setModo] = useState<TorneoModo>("eliminacion_simple");

  // Migración 091/093: Clan War Amistosa -- formulario mínimo, sin
  // paso a paso, que no crea ningún torneo: llama directo a
  // proponer_clan_war() (el mismo "Retar a otro clan" de siempre) con
  // el clan elegido en el buscador. Un solo sistema de lineup para
  // cualquier cantidad de jugadores (ya no hay que elegir entre
  // 1v1/2v2/3v3/4v4 y WTL por separado, migración 093): cada titular
  // juega su propio set 1v1 contra la posición equivalente del rival,
  // con el "Bo" que se configure acá.
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);
  const [cargandoMiEquipo, setCargandoMiEquipo] = useState(true);
  const [cwJugadoresPorSet, setCwJugadoresPorSet] = useState("3");
  const [cwMapasPorSet, setCwMapasPorSet] = useState("2");
  const [cwFechaHora, setCwFechaHora] = useState("");
  const [cwBusqueda, setCwBusqueda] = useState("");
  const [cwResultados, setCwResultados] = useState<{ id: string; name: string; tag: string }[]>([]);
  const [cwBuscando, setCwBuscando] = useState(false);
  const [cwEquipoElegido, setCwEquipoElegido] = useState<{ id: string; name: string; tag: string } | null>(null);
  const [cwEnviando, setCwEnviando] = useState(false);

  // Migración 095: un torneo/liga por equipos (cualquier formato
  // distinto de 1v1 -- 2v2/3v3/4v4/wtl, First Stand incluido, que
  // siempre se arma sobre un formato de equipo) exige ser caster,
  // dueño/capitán de algún clan, staff, admin, o dueño de la
  // plataforma. Esto es solo la vista previa en el cliente (oculta las
  // píldoras que igual la base rechazaría) -- la validación real vive
  // en el trigger validar_creador_torneo(), ver la migración.
  const [puedeCrearTorneoDeEquipo, setPuedeCrearTorneoDeEquipo] = useState(false);
  useEffect(() => {
    if (!user) return;
    Promise.all([supabase.rpc("lidera_algun_equipo"), supabase.rpc("es_dueno_plataforma")]).then(
      ([liderRes, duenoRes]) => {
        setPuedeCrearTorneoDeEquipo(
          !!(profile?.es_caster || profile?.es_admin || profile?.es_staff || liderRes.data || duenoRes.data)
        );
      }
    );
  }, [user, profile]);

  // Etapa de grupos (migración 041) -- solo aplica con eliminación
  // simple, ver el gate en el JSX.
  const [tieneFaseGrupos, setTieneFaseGrupos] = useState(false);
  const [cantidadGrupos, setCantidadGrupos] = useState("2");
  const [avanzanPorGrupo, setAvanzanPorGrupo] = useState("2");

  // Partido por el tercer lugar (migración 046) -- mismo gate que la
  // etapa de grupos.
  const [tieneTercerLugar, setTieneTercerLugar] = useState(false);
  // Migración 101: solo tiene sentido en eliminación doble -- el
  // default (true) es el comportamiento de siempre de
  // avanzar_ganador_doble(), esto solo agrega la opción de desactivarlo.
  const [granFinalConReset, setGranFinalConReset] = useState(true);

  // Formato de liga "First Stand" (migración 057).
  const [formatoLiga, setFormatoLiga] = useState(false);
  const [puntosVictoria21, setPuntosVictoria21] = useState("3");
  const [avanzanPlayoffsFirstStand, setAvanzanPlayoffsFirstStand] = useState("4");
  // Formato de las Clan Wars que genera el fixture (migración 087):
  // "simple" (reporte partida por partida, admite cualquier cantidad
  // de jugadores) o "wtl" (3 sets fijos por posición, con ACE si
  // empatan 3-3) -- WTL exige lineup de exactamente 3, así que solo se
  // ofrece en 3v3 (ver el gate en el JSX).
  const [formatoClanWar, setFormatoClanWar] = useState<"simple" | "wtl">("simple");

  // Migración 090: solo aplican cuando formato === "wtl" -- cuántos
  // jugadores por set (posiciones del lineup) y cuántos mapas gana
  // cada set de cada Clan War que genera el bracket.
  const [jugadoresPorSet, setJugadoresPorSet] = useState("3");
  const [mapasPorSet, setMapasPorSet] = useState("2");

  // Suizo (migración 069): en blanco = generar_torneo_suizo() calcula
  // sola la cantidad de rondas.
  const [swissRondas, setSwissRondas] = useState("");

  const [fechaInicio, setFechaInicio] = useState("");
  const [cuposTotales, setCuposTotales] = useState("16");
  // cupos_totales es la cantidad de participantes del bracket (jugadores
  // en 1v1, clanes en 2v2/3v3/4v4) -- no se multiplica por el tamaño del
  // formato. 16 es un default razonable para 1v1; en equipos rara vez
  // se junta esa cantidad de clanes, así que ahí el default baja a 8 --
  // sin pisar nunca un valor que el organizador ya haya tocado a mano.
  const [cuposTocados, setCuposTocados] = useState(false);
  // Ventana de revelación del lineup de Clan War (migración 089): antes
  // fija en 30 minutos para cualquier torneo -- solo aplica a formatos
  // de equipo, donde cada partido puede jugarse como Clan War real.
  const [ventanaRevelacionMinutos, setVentanaRevelacionMinutos] = useState("30");
  const [pozoPremio, setPozoPremio] = useState("");

  // Liga y divisiones (migración 079): al elegir "Torneo por ligas",
  // el organizador marca UNA o VARIAS divisiones -- se crea un torneo
  // por cada división marcada, todos con el mismo organizador, mismo
  // formato/modo/fecha/cupos. Si la liga no tiene divisiones cargadas
  // (o no se marca ninguna), se crea un solo torneo sin división.
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaId, setLigaId] = useState("");
  const [divisiones, setDivisiones] = useState<DivisionLiga[]>([]);
  const [divisionesSeleccionadas, setDivisionesSeleccionadas] = useState<Record<string, boolean>>({});
  const [mostrarFormNuevaLiga, setMostrarFormNuevaLiga] = useState(false);
  const [nuevaLigaNombre, setNuevaLigaNombre] = useState("");
  const [creandoLiga, setCreandoLiga] = useState(false);

  // Temporada (migración 079): se crea junto con el/los torneo(s) de
  // liga, en vez de tener que volver después a /tournaments/:id a
  // crearla a mano.
  const [temporadaModo, setTemporadaModo] = useState<"numerada" | "manual">("numerada");
  const [temporadaNumero, setTemporadaNumero] = useState("1");
  const [temporadaNombreManual, setTemporadaNombreManual] = useState("");
  const [temporadaFechaFin, setTemporadaFechaFin] = useState("");

  const [loading, setLoading] = useState(false);

  const esLiga = tipoEvento === "liga";
  const totalPasos = esLiga ? 4 : 2;

  // Catálogo de ligas: se carga siempre (aunque tipoEvento no sea
  // "liga" todavía) para que el paso 3 no tenga que esperar.
  useEffect(() => {
    supabase
      .from("ligas")
      .select("id, nombre")
      .order("nombre")
      .then(({ data, error: ligasError }) => {
        if (ligasError) console.error("Error cargando ligas:", ligasError);
        else setLigas(data ?? []);
      });
  }, []);

  // Divisiones de la liga elegida.
  useEffect(() => {
    if (!ligaId) {
      setDivisiones([]);
      setDivisionesSeleccionadas({});
      return;
    }
    supabase
      .from("divisiones_liga")
      .select("id, liga_id, nombre, mmr_limite")
      .eq("liga_id", ligaId)
      .order("nombre")
      .then(({ data, error: divisionesError }) => {
        if (divisionesError) {
          console.error("Error cargando divisiones:", divisionesError);
          return;
        }
        setDivisiones(data ?? []);
        setDivisionesSeleccionadas({});
      });
  }, [ligaId]);

  // Si en algún momento se resuelve que el organizador NO puede crear
  // un torneo por equipos (por ejemplo, la respuesta del permiso llega
  // después de que ya había elegido un formato de equipo a mano), se
  // lo vuelve a 1v1 -- mismo criterio que el resto de los efectos de
  // limpieza de esta página.
  useEffect(() => {
    if (!puedeCrearTorneoDeEquipo && formato !== "1v1") {
      setFormato("1v1");
    }
  }, [puedeCrearTorneoDeEquipo, formato]);

  // Default de cupos según el formato -- pero solo mientras el
  // organizador no haya tocado el campo a mano, para no pisarle un
  // valor que ya eligió.
  useEffect(() => {
    if (cuposTocados) return;
    setCuposTotales(formato === "1v1" ? "16" : "8");
  }, [formato, cuposTocados]);

  // Si el organizador elige WTL y después cambia el formato a algo
  // distinto de 3v3, el select de WTL desaparece (ver el gate en el
  // JSX) -- este efecto evita mandar "wtl" igual con el valor viejo
  // ya elegido, que el check de la base (tournaments_wtl_solo_3v3)
  // rechazaría al crear el torneo.
  useEffect(() => {
    if (formato !== "3v3" && formatoClanWar === "wtl") {
      setFormatoClanWar("simple");
    }
  }, [formato, formatoClanWar]);

  // Migración 090: "Clan vs Clan (WTL)" siempre es una llave de
  // eliminación normal, sin fase de grupos ni formato de liga First
  // Stand (eso es otro sistema de fixture aparte, con su propio camino
  // para jugar WTL) -- mismo criterio que exige el check de la base
  // (tournaments_wtl_es_bracket_simple).
  useEffect(() => {
    if (formato === "wtl") {
      setModo("eliminacion_simple");
      setFormatoLiga(false);
    }
  }, [formato]);

  // Migración 091: mi propio equipo, para saber si puedo proponer una
  // Clan War Amistosa (hace falta pertenecer a uno) y para no
  // ofrecérmelo a mí mismo en el buscador de rivales.
  useEffect(() => {
    if (!user) {
      setCargandoMiEquipo(false);
      return;
    }
    obtenerEquipoDelUsuario(user.id)
      .then(setMiEquipo)
      .finally(() => setCargandoMiEquipo(false));
  }, [user]);

  // Buscador de clanes públicos para invitar a la Clan War Amistosa --
  // mismo criterio de "equipo público" que usa /equipos (is_public y
  // no disuelto), excluyendo mi propio equipo y los que están en
  // banca rota (proponer_clan_war() los rechazaría igual).
  useEffect(() => {
    const termino = cwBusqueda.trim();
    if (termino.length < 2) {
      setCwResultados([]);
      return;
    }
    let cancelado = false;
    setCwBuscando(true);
    const timeout = setTimeout(() => {
      supabase
        .from("teams")
        .select("id, name, tag")
        .eq("is_public", true)
        .eq("disuelto", false)
        .eq("banca_rota", false)
        .or(`name.ilike.%${termino}%,tag.ilike.%${termino}%`)
        .neq("id", miEquipo?.team_id ?? "00000000-0000-0000-0000-000000000000")
        .order("name")
        .limit(10)
        .then(({ data, error: buscarError }) => {
          if (cancelado) return;
          if (buscarError) console.error("Error buscando equipos:", buscarError);
          setCwResultados(data ?? []);
          setCwBuscando(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timeout);
    };
  }, [cwBusqueda, miEquipo]);

  const handleProponerClanWarAmistosa = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (!cwEquipoElegido) {
      toast.error("Elige un clan rival en el buscador.");
      return;
    }
    if (!cwFechaHora) {
      toast.error("Elige la fecha y hora de la Clan War.");
      return;
    }
    const jugadores = Number(cwJugadoresPorSet);
    if (!jugadores || jugadores < 1) {
      toast.error("La cantidad de jugadores por lado tiene que ser al menos 1.");
      return;
    }

    setCwEnviando(true);

    // Migración 093: Clan War Amistosa siempre usa el sistema de
    // lineup (antes "WTL") -- ya no existe la opción "simple" acá.
    const { error: proponerError } = await supabase.rpc("proponer_clan_war", {
      p_challenged_team_id: cwEquipoElegido.id,
      p_fecha_hora_cet: datetimeLocalAIso(cwFechaHora),
      p_formato: "wtl",
      p_temporada_id: null,
      p_jugadores_por_set: jugadores,
      p_mapas_por_set: Number(cwMapasPorSet) || 2,
    });

    setCwEnviando(false);

    if (proponerError) {
      toast.error(proponerError.message);
      return;
    }

    toast.success(
      "¡Solicitud enviada! El otro clan la va a ver en su Panel de control para aceptarla o rechazarla."
    );
    setCwEquipoElegido(null);
    setCwBusqueda("");
    setCwFechaHora("");
  };

  const handleCrearLiga = async () => {
    const nombreLimpio = nuevaLigaNombre.trim();
    if (!nombreLimpio) return;

    if (contieneLenguajeInapropiado(nombreLimpio)) {
      toast.error("Ese nombre no está permitido.");
      return;
    }

    setCreandoLiga(true);

    const { data, error: crearError } = await supabase.rpc("crear_liga", { p_nombre: nombreLimpio });

    setCreandoLiga(false);

    if (crearError || !data) {
      toast.error(crearError?.message ?? "No se pudo crear la liga.");
      return;
    }

    const nuevaLiga = { id: data as string, nombre: nombreLimpio };
    setLigas((prev) => [...prev, nuevaLiga].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setLigaId(nuevaLiga.id);
    setNuevaLigaNombre("");
    setMostrarFormNuevaLiga(false);
  };

  const toggleDivision = (id: string) => {
    setDivisionesSeleccionadas((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const puedeAvanzarDesdePaso1 = nombre.trim().length > 0;
  const puedeAvanzarDesdePaso2 = fechaInicio.length > 0 && Number(cuposTotales) >= 2;
  const puedeAvanzarDesdePaso3 = !esLiga || !!ligaId;

  const handleSiguiente = () => {
    if (paso === 1 && !puedeAvanzarDesdePaso1) {
      toast.error("Ponle un nombre al torneo antes de seguir.");
      return;
    }
    if (paso === 2 && !puedeAvanzarDesdePaso2) {
      toast.error("Elige la fecha de inicio y una cantidad de cupos válida.");
      return;
    }
    if (paso === 3 && !puedeAvanzarDesdePaso3) {
      toast.error("Elige una liga antes de seguir.");
      return;
    }
    setPaso((p) => Math.min(p + 1, totalPasos));
  };

  const handleAtras = () => {
    setPaso((p) => Math.max(p - 1, 1));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    // También bloqueado a nivel de RLS (tournaments_insert_propio, ver
    // migración 004) -- este chequeo acá es solo para no dejar mandar
    // el formulario y mostrar el aviso al toque, no la única barrera.
    if (profile?.suspendido) {
      toast.error("Tu cuenta está suspendida.");
      return;
    }

    // Migración 095, ajustado en la 107: también bloqueado por el
    // trigger validar_creador_torneo() -- este chequeo acá es solo
    // para mostrar el aviso al toque. Solo el nick (país, servidor/ID
    // de SC2 quedaron opcionales, RemorApp no exige jugar StarCraft II).
    if (!profile?.cuenta_validada) {
      toast.error("Necesitas completar tu perfil (el nick) antes de crear un torneo.");
      return;
    }

    // El nombre del torneo se muestra públicamente (listado y detalle),
    // así que pasa por el mismo filtro que el nick.
    if (contieneLenguajeInapropiado(nombre)) {
      toast.error("Ese nombre no está permitido. Por favor elige otro.");
      return;
    }

    // Migración 074: mismo margen de tolerancia que el trigger de la
    // base.
    if (new Date(fechaInicio).getTime() < Date.now() - TOLERANCIA_FECHA_MS) {
      toast.error("La fecha de inicio no puede ser en el pasado.");
      return;
    }

    // Migración 095: mismo límite de 60 días que exige
    // validar_fecha_inicio_torneo() en la base.
    if (new Date(fechaInicio).getTime() > Date.now() + LIMITE_ANTICIPACION_DIAS * 24 * 60 * 60 * 1000) {
      toast.error(
        `La fecha de inicio no puede ser más de ${LIMITE_ANTICIPACION_DIAS} días en el futuro. Si necesitas programar con más anticipación, pídele a un administrador que extienda el plazo una vez creado el torneo.`
      );
      return;
    }

    const divisionesElegidas = esLiga ? divisiones.filter((d) => divisionesSeleccionadas[d.id]) : [];

    if (esLiga && temporadaModo === "manual" && !temporadaNombreManual.trim()) {
      toast.error("Escribe el nombre de la temporada, o cambia a numerada.");
      return;
    }
    if (esLiga && !temporadaFechaFin) {
      toast.error("Elige la fecha de fin de la temporada.");
      return;
    }
    if (esLiga && temporadaFechaFin && new Date(temporadaFechaFin) <= new Date(fechaInicio)) {
      toast.error("La fecha de fin de la temporada debe ser posterior a la fecha de inicio del torneo.");
      return;
    }

    setLoading(true);

    // Opciones avanzadas (Bracket/Permissions/Misc) ya NO se
    // configuran acá -- quedan en su valor por defecto al crear, y se
    // ajustan después desde la propia ficha del torneo (solo el
    // organizador las ve).
    const payloadBase = {
      formato,
      modo,
      // Migración 091: "Evento privado" ya no existe como tipo de
      // evento -- un torneo por ligas (el único que llega hasta acá)
      // siempre es público.
      publico: true,
      pozo_premio: pozoPremio ? Number(pozoPremio) : null,
      cupos_totales: Number(cuposTotales),
      fecha_inicio: new Date(fechaInicio).toISOString(),
      creador_id: user.id,
      tiene_fase_grupos: modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos,
      cantidad_grupos:
        modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos ? Number(cantidadGrupos) : null,
      avanzan_por_grupo:
        modo === "eliminacion_simple" && formatoLiga
          ? Number(avanzanPlayoffsFirstStand)
          : modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos
            ? Number(avanzanPorGrupo)
            : null,
      tiene_tercer_lugar: modo === "eliminacion_simple" && !formatoLiga && tieneTercerLugar,
      gran_final_con_reset: modo === "eliminacion_doble" ? granFinalConReset : true,
      formato_liga: modo === "eliminacion_simple" && formatoLiga ? "first_stand" : null,
      puntos_victoria_2_1: modo === "eliminacion_simple" && formatoLiga ? Number(puntosVictoria21) : 3,
      formato_clan_war: modo === "eliminacion_simple" && formatoLiga && formato === "3v3" ? formatoClanWar : "simple",
      ventana_revelacion_minutos: formato !== "1v1" ? Number(ventanaRevelacionMinutos) || 30 : 30,
      jugadores_por_set: formato === "wtl" ? Number(jugadoresPorSet) || 3 : 3,
      mapas_por_set: formato === "wtl" ? Number(mapasPorSet) || 2 : 2,
      liga_id: esLiga ? ligaId || null : null,
      swiss_rondas_totales: modo === "suizo" && swissRondas ? Number(swissRondas) : null,
    };

    // Un torneo por división marcada (o uno solo, sin división, si no
    // es de liga o la liga no tiene divisiones marcadas).
    const tandas = divisionesElegidas.length > 0 ? divisionesElegidas : [null];

    const idsCreados: string[] = [];
    for (const division of tandas) {
      const { data: torneo, error: torneoError } = await supabase
        .from("tournaments")
        .insert({
          ...payloadBase,
          nombre: tandas.length > 1 ? `${nombre} - ${division!.nombre}` : nombre,
          division_id: division ? division.id : null,
        })
        .select()
        .single();

      if (torneoError || !torneo) {
        setLoading(false);
        toast.error(
          idsCreados.length > 0
            ? `Se crearon ${idsCreados.length} de ${tandas.length} torneos antes de este error: ${
                torneoError?.message ?? "No se pudo crear el torneo."
              }`
            : torneoError?.message ?? "No se pudo crear el torneo."
        );
        return;
      }

      idsCreados.push(torneo.id);

      if (esLiga) {
        const nombreTemporada = temporadaModo === "numerada" ? `Temporada ${temporadaNumero}` : temporadaNombreManual.trim();
        const { error: temporadaError } = await supabase.from("temporadas").insert({
          torneo_id: torneo.id,
          nombre: nombreTemporada,
          fecha_inicio: new Date(fechaInicio).toISOString(),
          fecha_fin: new Date(temporadaFechaFin).toISOString(),
        });
        // No bloquea la creación del torneo si falla la temporada --
        // el torneo ya existe, solo faltaría crearla a mano después.
        if (temporadaError) console.error("Error creando la temporada:", temporadaError);
      }

    }

    setLoading(false);
    toast.success(idsCreados.length === 1 ? "Torneo creado correctamente." : "Torneos creados correctamente.");
    navigate(idsCreados.length === 1 ? `/tournaments/${idsCreados[0]}` : "/tournaments");
  };

  if (!authLoading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para crear un torneo</h1>
        <p>
          Necesitas una cuenta de RemorApp para organizar torneos.{" "}
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  const esClanWarAmistosa = tipoEvento === "amistosa";

  return (
    <section className="create-tournament-page">
      <div className="section-head">
        <h1 className="section-title">Crear torneo</h1>
      </div>
      {!esClanWarAmistosa && (
        <p className="auth-sub" style={{ textAlign: "left", marginTop: 0, marginBottom: "0.5rem" }}>
          Paso {paso} de {totalPasos}
        </p>
      )}
      <p className="form-hint" style={{ marginBottom: "1.5rem" }}>
        Un <strong>torneo por ligas</strong> tiene llave o tabla propia, para cualquier cantidad de
        inscritos. Una <strong>Clan War Amistosa</strong> es un enfrentamiento directo entre tu clan y
        otro -- sin llave ni cupos, es directamente esa Clan War.
      </p>

      <div className="form-group">
        <span className="form-label">Tipo de evento</span>
        <div className="modo-grid">
          {TIPOS_EVENTO.map((t) => (
            <div key={t.value} className={`modo-card ${tipoEvento === t.value ? "selected" : ""}`}>
              <label className="modo-card-label">
                <input
                  type="radio"
                  className="sr-only"
                  name="tipoEvento"
                  checked={tipoEvento === t.value}
                  onChange={() => setTipoEvento(t.value)}
                />
                <TipoEventoIcono tipo={t.value} />
                <span>{t.label}</span>
              </label>
              <InfoTooltip texto={t.descripcion} />
            </div>
          ))}
        </div>
      </div>

      {esClanWarAmistosa ? (
        <form className="create-tournament-form" onSubmit={handleProponerClanWarAmistosa}>
          {!cargandoMiEquipo && !miEquipo && (
            <p className="form-hint">
              Necesitas pertenecer a un equipo para proponer una Clan War Amistosa.{" "}
              <Link to="/equipos" className="btn-link">
                Ver equipos
              </Link>
            </p>
          )}

          {miEquipo && (
            <div className="form-section">
              {/* Migración 093: un solo sistema de lineup para
                  cualquier cantidad de jugadores -- cada titular juega
                  su propio set 1v1 contra la posición equivalente del
                  rival. Ya no hay que elegir un "formato" aparte
                  (1v1/2v2/3v3/4v4 vs WTL): la cantidad de jugadores y
                  el "Bo" de cada set son los dos únicos ajustes. */}
              <div className="form-group">
                <label className="form-label" htmlFor="cw-jugadores-por-set">
                  Cantidad de jugadores por lado
                </label>
                <input
                  id="cw-jugadores-por-set"
                  className="form-input"
                  type="number"
                  min={1}
                  value={cwJugadoresPorSet}
                  onChange={(e) => setCwJugadoresPorSet(e.target.value)}
                />
                <p className="form-hint">
                  Cada titular juega su propio set 1v1 contra la posición equivalente del rival. Es
                  editable -- y se puede volver a ajustar más adelante, subir o bajar, directo desde el
                  lineup de la Clan War.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="cw-mapas-por-set">
                  "Bo" de cada set
                </label>
                <select
                  id="cw-mapas-por-set"
                  className="form-select"
                  value={cwMapasPorSet}
                  onChange={(e) => setCwMapasPorSet(e.target.value)}
                >
                  {BO_OPTIONS.map((bo) => (
                    <option key={bo.value} value={bo.value}>
                      {bo.label}
                    </option>
                  ))}
                </select>
                <p className="form-hint">
                  Cuántos mapas como máximo se juegan en cada set -- se cierra apenas alguien alcanza la
                  mayoría necesaria, sin jugar de más.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="cw-fecha-hora">
                  Fecha y hora (tu hora local)
                </label>
                <input
                  id="cw-fecha-hora"
                  className="form-input"
                  type="datetime-local"
                  required
                  value={cwFechaHora}
                  onChange={(e) => setCwFechaHora(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="cw-buscar-equipo">
                  Enviar solicitud a un clan
                </label>
                <input
                  id="cw-buscar-equipo"
                  className="form-input"
                  type="text"
                  placeholder="Busca por nombre o tag..."
                  value={cwEquipoElegido ? `${cwEquipoElegido.name} [${cwEquipoElegido.tag}]` : cwBusqueda}
                  onChange={(e) => {
                    setCwEquipoElegido(null);
                    setCwBusqueda(e.target.value);
                  }}
                />
                {cwBuscando && <p className="form-hint">Buscando...</p>}
                {!cwEquipoElegido && cwResultados.length > 0 && (
                  <div className="detail-participant-list">
                    {cwResultados.map((eq) => (
                      <button
                        type="button"
                        key={eq.id}
                        className="btn btn-ghost btn-block"
                        onClick={() => {
                          setCwEquipoElegido(eq);
                          setCwResultados([]);
                        }}
                      >
                        {eq.name} [{eq.tag}]
                      </button>
                    ))}
                  </div>
                )}
                {!cwEquipoElegido && !cwBuscando && cwBusqueda.trim().length >= 2 && cwResultados.length === 0 && (
                  <p className="form-hint">No encontré ningún clan público con ese nombre o tag.</p>
                )}
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={cwEnviando}>
                {cwEnviando ? "Enviando solicitud..." : "Enviar solicitud"}
              </button>
            </div>
          )}
        </form>
      ) : (
      <form className="create-tournament-form" onSubmit={handleSubmit}>
        {paso === 1 && (
          <div className="form-section">
            <h2 className="form-section-title">
              <span className="form-section-title-numero">1</span>
              Información básica
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-nombre">
                Nombre del torneo
              </label>
              <input
                id="torneo-nombre"
                className="form-input"
                type="text"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="form-group">
              <span className="form-label">Formato</span>
              <div className="pill-radio-group">
                {FORMATOS.map((f) => {
                  const habilitado = f === "1v1" || puedeCrearTorneoDeEquipo;
                  return (
                    <label
                      key={f}
                      className={`pill-radio-option ${formato === f ? "selected" : ""} ${habilitado ? "" : "disabled"}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="formato"
                        checked={formato === f}
                        disabled={!habilitado}
                        onChange={() => setFormato(f)}
                      />
                      {getFormatoLabel(f)}
                    </label>
                  );
                })}
              </div>
              {!puedeCrearTorneoDeEquipo && (
                <p className="form-hint">
                  Un torneo o liga por equipos (2v2/3v3/4v4/Clan vs Clan) requiere ser caster, dueño o
                  capitán de un clan, staff, o administrador.
                </p>
              )}
              {esLiga && formato !== "1v1" && (
                <p className="form-hint">
                  Los clanes entran por invitación tuya o pidiendo el ingreso -- no hay inscripción
                  libre en un torneo de liga por equipos.
                </p>
              )}
              {formato === "wtl" && (
                <p className="form-hint">
                  Cada cruce de la llave entre dos clanes se juega como una Clan War real, con lineup,
                  visto bueno de los dos capitanes y check-in -- no con el botón "Ganó X" de siempre.
                  Este formato siempre es una llave de eliminación simple, sin fase de grupos ni First
                  Stand.
                </p>
              )}
            </div>

            {formato === "wtl" && (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-jugadores-por-set">
                  Jugadores por set
                </label>
                <input
                  id="torneo-jugadores-por-set"
                  className="form-input"
                  type="number"
                  min={1}
                  value={jugadoresPorSet}
                  onChange={(e) => setJugadoresPorSet(e.target.value)}
                />

                <label className="form-label" htmlFor="torneo-mapas-por-set">
                  "Bo" de cada set
                </label>
                <select
                  id="torneo-mapas-por-set"
                  className="form-select"
                  value={mapasPorSet}
                  onChange={(e) => setMapasPorSet(e.target.value)}
                >
                  {BO_OPTIONS.map((bo) => (
                    <option key={bo.value} value={bo.value}>
                      {bo.label}
                    </option>
                  ))}
                </select>
                <p className="form-hint">
                  Cuántos jugadores de cada clan juegan sets 1v1 separados en cada Clan War, y cuántos
                  mapas como máximo tiene cada set -- se cierra apenas alguien alcanza la mayoría
                  necesaria.
                </p>
              </div>
            )}

            <div className="form-group">
              <span className="form-label">Modo de juego</span>
              <div className="modo-grid">
                {/* "Rey de la colina" queda afuera del selector: es un
                    modo sin ningún motor detrás (ni generación de
                    fixture ni progresión) -- crearlo dejaba al
                    organizador con un torneo que nunca se podía
                    arrancar. Sigue en MODOS (tournamentOptions.ts) para
                    no romper el label de algún torneo viejo que ya lo
                    tuviera, pero no se puede volver a elegir. */}
                {MODOS.filter(
                  (m) => m.value !== "rey_de_la_colina" && (formato !== "wtl" || m.value === "eliminacion_simple")
                ).map((m) => (
                  <div key={m.value} className={`modo-card ${modo === m.value ? "selected" : ""}`}>
                    <label className="modo-card-label">
                      <input
                        type="radio"
                        className="sr-only"
                        name="modo"
                        checked={modo === m.value}
                        onChange={() => setModo(m.value)}
                        disabled={formato === "wtl"}
                      />
                      <ModoIcono modo={m.value} />
                      <span>{m.label}</span>
                    </label>
                    <InfoTooltip texto={m.descripcion} />
                  </div>
                ))}
              </div>
              {formato === "wtl" && (
                <p className="form-hint">"Clan vs Clan (WTL)" solo está disponible en eliminación simple.</p>
              )}
            </div>

            {modo === "eliminacion_doble" && (
              <>
                <p className="form-hint">
                  Este modo necesita exactamente 4, 8, 16 o 32 confirmados al cerrar el check-in -- no
                  admite bye. Si te faltan o te sobran para llegar a la potencia de 2 más cercana, vas a
                  tener que esperar a que se sumen o dar de baja a alguno antes de generar la llave.
                </p>
                <div className="form-group">
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={granFinalConReset}
                      onChange={(e) => setGranFinalConReset(e.target.checked)}
                    />
                    Gran Final con partido de reset
                  </label>
                  <p className="form-hint">
                    Si el campeón de la llave de perdedores le gana la Gran Final al campeón invicto de
                    la llave de ganadores, se juega un partido extra para desempatar de verdad (esa fue
                    su primera derrota del torneo). Desmárcalo para que la Gran Final sea un partido
                    único, sin revancha.
                  </p>
                </div>
              </>
            )}

            {modo === "suizo" && (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-swiss-rondas">
                  Cantidad de rondas (opcional)
                </label>
                <input
                  id="torneo-swiss-rondas"
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="Se calcula sola si la dejas en blanco"
                  value={swissRondas}
                  onChange={(e) => setSwissRondas(e.target.value)}
                />
              </div>
            )}

            {modo === "eliminacion_simple" && formato !== "1v1" && formato !== "wtl" && (
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formatoLiga}
                    onChange={(e) => setFormatoLiga(e.target.checked)}
                  />
                  Formato de liga "First Stand"
                </label>
                <p className="form-hint">
                  Fixture de todos contra todos completo (cada clan juega contra todos los demás una
                  vez, nadie repite rival) y playoffs entre los mejores puestos, con la final al mejor
                  de 5. Sirve para cualquier cantidad de clanes, no solo 7.
                </p>

                {formatoLiga && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="torneo-avanzan-playoffs">
                      Cuántos avanzan a los playoffs
                    </label>
                    <input
                      id="torneo-avanzan-playoffs"
                      className="form-input"
                      type="number"
                      min={2}
                      value={avanzanPlayoffsFirstStand}
                      onChange={(e) => setAvanzanPlayoffsFirstStand(e.target.value)}
                    />

                    <label className="form-label" htmlFor="torneo-puntos-2-1">
                      Puntos por una victoria 2-1
                    </label>
                    <select
                      id="torneo-puntos-2-1"
                      className="form-select"
                      value={puntosVictoria21}
                      onChange={(e) => setPuntosVictoria21(e.target.value)}
                    >
                      <option value="3">3 puntos (igual que una victoria 2-0)</option>
                      <option value="2">2 puntos (sistema alternativo)</option>
                    </select>
                    <p className="form-hint">Una victoria 2-0 siempre vale 3 puntos.</p>

                    <label className="form-label" htmlFor="torneo-formato-clan-war">
                      Cómo se juega cada partido
                    </label>
                    <select
                      id="torneo-formato-clan-war"
                      className="form-select"
                      value={formatoClanWar}
                      onChange={(e) => setFormatoClanWar(e.target.value as "simple" | "wtl")}
                    >
                      <option value="simple">
                        Clan War simple -- partida por partida, admite suplentes
                      </option>
                      {formato === "3v3" && <option value="wtl">WTL -- 3 sets fijos por posición, con ACE</option>}
                    </select>
                    <p className="form-hint">
                      Cada partido del fixture se juega como una Clan War real: lineup, visto bueno de
                      los dos capitanes y ventana de check-in antes de empezar.
                      {formato !== "3v3" && " WTL solo está disponible en 3v3."}
                    </p>
                  </div>
                )}
              </div>
            )}

            {modo === "eliminacion_simple" && !formatoLiga && (
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={tieneFaseGrupos}
                    onChange={(e) => setTieneFaseGrupos(e.target.checked)}
                  />
                  Con etapa de grupos
                </label>
                <p className="form-hint">
                  Los inscritos se reparten en grupos y juegan todos contra todos dentro de su grupo;
                  los mejores de cada uno avanzan a la llave eliminatoria.
                </p>

                {tieneFaseGrupos && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="torneo-cantidad-grupos">
                      Cantidad de grupos
                    </label>
                    <input
                      id="torneo-cantidad-grupos"
                      className="form-input"
                      type="number"
                      min={2}
                      value={cantidadGrupos}
                      onChange={(e) => setCantidadGrupos(e.target.value)}
                    />

                    <label className="form-label" htmlFor="torneo-avanzan-por-grupo">
                      Cuántos avanzan por grupo
                    </label>
                    <input
                      id="torneo-avanzan-por-grupo"
                      className="form-input"
                      type="number"
                      min={1}
                      value={avanzanPorGrupo}
                      onChange={(e) => setAvanzanPorGrupo(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {modo === "eliminacion_simple" && !formatoLiga && (
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={tieneTercerLugar}
                    onChange={(e) => setTieneTercerLugar(e.target.checked)}
                  />
                  Con partido por el tercer lugar
                </label>
                <p className="form-hint">
                  Los dos perdedores de semifinal juegan aparte por el tercer puesto, en paralelo a la
                  final.
                </p>
              </div>
            )}
          </div>
        )}

        {paso === 2 && (
          <div className="form-section">
            <h2 className="form-section-title">
              <span className="form-section-title-numero">2</span>
              Fecha y cupos
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-fecha">
                Fecha de inicio
              </label>
              <input
                id="torneo-fecha"
                className="form-input"
                type="datetime-local"
                required
                max={fechaMaximaDatetimeLocal()}
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
              <p className="form-hint">
                No puede ser más de {LIMITE_ANTICIPACION_DIAS} días en el futuro. Si necesitas programar
                con más anticipación, pídele a un administrador que extienda el plazo una vez creado el
                torneo.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-cupos">
                Cupos totales
              </label>
              <input
                id="torneo-cupos"
                className="form-input"
                type="number"
                min={2}
                required
                value={cuposTotales}
                onChange={(e) => {
                  setCuposTocados(true);
                  setCuposTotales(e.target.value);
                }}
              />
            </div>

            {formato !== "1v1" && (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-ventana-revelacion">
                  Ventana de revelación del lineup (minutos)
                </label>
                <input
                  id="torneo-ventana-revelacion"
                  className="form-input"
                  type="number"
                  min={1}
                  value={ventanaRevelacionMinutos}
                  onChange={(e) => setVentanaRevelacionMinutos(e.target.value)}
                />
                <p className="form-hint">
                  Cuántos minutos antes de la hora de cada Clan War se traba la edición del lineup y se
                  revela al rival. 30 por default.
                </p>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-pozo">
                Pozo de premios en CLP (opcional)
              </label>
              <input
                id="torneo-pozo"
                className="form-input"
                type="number"
                min={0}
                value={pozoPremio}
                onChange={(e) => setPozoPremio(e.target.value)}
              />
            </div>
          </div>
        )}

        {paso === 3 && esLiga && (
          <div className="form-section">
            <h2 className="form-section-title">
              <span className="form-section-title-numero">3</span>
              Liga y divisiones
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-liga">
                Liga
              </label>
              <select id="torneo-liga" className="form-select" value={ligaId} onChange={(e) => setLigaId(e.target.value)}>
                <option value="">Elige una liga</option>
                {ligas.map((liga) => (
                  <option key={liga.id} value={liga.id}>
                    {liga.nombre}
                  </option>
                ))}
              </select>

              {!mostrarFormNuevaLiga ? (
                <button type="button" className="btn btn-ghost" onClick={() => setMostrarFormNuevaLiga(true)}>
                  + Agregar nueva liga
                </button>
              ) : (
                <div className="form-group">
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Nombre de la nueva liga"
                    value={nuevaLigaNombre}
                    onChange={(e) => setNuevaLigaNombre(e.target.value)}
                  />
                  <div className="invitation-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={creandoLiga || !nuevaLigaNombre.trim()}
                      onClick={handleCrearLiga}
                    >
                      {creandoLiga ? "Creando..." : "Crear liga"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setMostrarFormNuevaLiga(false);
                        setNuevaLigaNombre("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {ligaId && (
              <div className="form-group">
                <span className="form-label">Divisiones a crear</span>
                {divisiones.length === 0 ? (
                  <p className="form-hint">
                    Esta liga todavía no tiene divisiones cargadas -- se va a crear un solo torneo,
                    sin división.
                  </p>
                ) : (
                  <>
                    <p className="form-hint">
                      Marca una o varias -- se crea un torneo por cada división marcada, con el mismo
                      formato, modo, fecha y cupos.
                    </p>
                    <div className="detail-participant-list">
                      {divisiones.map((d) => (
                        <label key={d.id} className="form-checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!divisionesSeleccionadas[d.id]}
                            onChange={() => toggleDivision(d.id)}
                          />
                          {d.nombre}
                          {d.mmr_limite !== null && (
                            <span className="tournament-card-meta"> · hasta {d.mmr_limite} MMR</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="form-hint">
              Los equipos entran por invitación tuya, o pidiendo el ingreso para que vos lo apruebes --
              ambas opciones van a estar disponibles desde la ficha de cada torneo, una vez creado.
            </p>
          </div>
        )}

        {paso === 4 && esLiga && (
          <div className="form-section">
            <h2 className="form-section-title">
              <span className="form-section-title-numero">4</span>
              Temporada
            </h2>

            <div className="form-group">
              <div className="form-radio-group">
                <label className={`form-radio-option ${temporadaModo === "numerada" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="temporadaModo"
                    checked={temporadaModo === "numerada"}
                    onChange={() => setTemporadaModo("numerada")}
                  />
                  Numerada
                </label>
                <label className={`form-radio-option ${temporadaModo === "manual" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="temporadaModo"
                    checked={temporadaModo === "manual"}
                    onChange={() => setTemporadaModo("manual")}
                  />
                  Nombre personalizado
                </label>
              </div>
            </div>

            {temporadaModo === "numerada" ? (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-temporada-numero">
                  Número de temporada
                </label>
                <input
                  id="torneo-temporada-numero"
                  className="form-input"
                  type="number"
                  min={1}
                  value={temporadaNumero}
                  onChange={(e) => setTemporadaNumero(e.target.value)}
                />
                <p className="form-hint">Se va a llamar "Temporada {temporadaNumero || "N"}".</p>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-temporada-nombre">
                  Nombre de la temporada
                </label>
                <input
                  id="torneo-temporada-nombre"
                  className="form-input"
                  type="text"
                  placeholder="SLL Season 7"
                  value={temporadaNombreManual}
                  onChange={(e) => setTemporadaNombreManual(e.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="torneo-temporada-fin">
                Fecha de fin de la temporada
              </label>
              <input
                id="torneo-temporada-fin"
                className="form-input"
                type="datetime-local"
                required
                min={fechaInicio || undefined}
                value={temporadaFechaFin}
                onChange={(e) => setTemporadaFechaFin(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="create-tournament-nav">
          {paso > 1 && (
            <button type="button" className="btn btn-ghost" onClick={handleAtras}>
              Atrás
            </button>
          )}
          {paso < totalPasos ? (
            <button type="button" className="btn btn-primary" onClick={handleSiguiente}>
              Siguiente
            </button>
          ) : (
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? "Creando torneo..." : "Crear torneo"}
            </button>
          )}
        </div>
      </form>
      )}
    </section>
  );
}
