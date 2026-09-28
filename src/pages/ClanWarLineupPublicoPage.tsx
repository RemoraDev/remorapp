import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatFecha } from "../lib/formatters";
import { vencioPlazoEdicionLineup } from "../lib/clanWars";
import TarjetaLineupClanWar from "../components/TarjetaLineupClanWar";
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
  const [mostrarEditor, setMostrarEditor] = useState(false);
  // "Look" (migraciones 127 y 129): sub-pestañas de apariencia dentro
  // del panel -- Fondo (ya existía), Estructura (maqueta de la
  // tarjeta) y Dimensión (relación de aspecto), las tres separadas del
  // resto de la gestión (lineup, stream, visto bueno).
  const [seccionLook, setSeccionLook] = useState<"fondo" | "estructura" | "dimension">("fondo");

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

  // Stream propio de cada equipo (migración 125): se inicializa una
  // sola vez con lo que ya tenía cargado, para no pisar lo que el
  // usuario está tipeando en cada refresco de recargarTodo().
  const [streamLinkEditado, setStreamLinkEditado] = useState("");
  const [streamDelayEditado, setStreamDelayEditado] = useState(false);
  const [streamInicializado, setStreamInicializado] = useState(false);
  const [guardandoStream, setGuardandoStream] = useState(false);
  const [errorStream, setErrorStream] = useState<string | null>(null);

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
    const { data, error: rpcError } = await supabase.rpc("lineup_editor_clan_war", { p_clan_war_id: id });
    if (rpcError || !data) {
      setEditor(null);
      return;
    }
    setEditor(data as LineupEditorClanWar);
  }, [id, user]);

  useEffect(() => {
    cargarPublico();
  }, [cargarPublico]);

  useEffect(() => {
    cargarEditor();
  }, [cargarEditor]);

  useEffect(() => {
    if (editor && !streamInicializado) {
      setStreamLinkEditado(editor.mi_stream_link ?? "");
      setStreamDelayEditado(!!editor.mi_stream_delay);
      setStreamInicializado(true);
    }
  }, [editor, streamInicializado]);

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
    await Promise.all([cargarPublico(), cargarEditor()]);
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

  const handleGuardarStream = async () => {
    setGuardandoStream(true);
    setErrorStream(null);

    const { error: rpcError } = await supabase.rpc("actualizar_stream_equipo_cw", {
      p_clan_war_id: id,
      p_stream_link: streamLinkEditado.trim() || null,
      p_tiene_delay: streamDelayEditado,
    });

    setGuardandoStream(false);

    if (rpcError) {
      setErrorStream(rpcError.message);
      return;
    }

    await recargarTodo();
  };

  const vencioPlazo = editor
    ? vencioPlazoEdicionLineup(
        editor.fecha_hora_cet,
        editor.lineup_plazo_extendido_hasta,
        Date.now(),
        editor.ventana_revelacion_minutos
      )
    : false;

  const puedeGestionar = !!editor && (editor.status === "aceptada" || editor.status === "en_curso");

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

  return (
    <section className="section section-page">
      <Link to="/" className="team-panel-back">
        ← Volver a Inicio
      </Link>

      {cargando && <p className="tournament-card-meta">Cargando...</p>}
      {error && <div className="form-error">{error}</div>}

      {datos && (
        <>
          <p className="tournament-card-meta" style={{ marginBottom: "1rem" }}>
            {formatFecha(datos.fecha_hora_cet)} · Formato {datos.formato === "wtl" ? "WTL" : "Simple"}
          </p>

          {!datos.revelado ? (
            <p className="detail-empty">
              Todavía no se reveló la alineación de ambos equipos -- volvé a intentarlo más cerca del
              inicio de la Clan War.
            </p>
          ) : (
            <TarjetaLineupClanWar datos={datos} />
          )}

          {puedeGestionar && editor && (
            <div className="clan-war-editor-wrap">
              <button
                type="button"
                className="clan-war-editor-toggle"
                onClick={() => setMostrarEditor((v) => !v)}
              >
                <Pencil className="icon-inline" />
                {mostrarEditor ? "Cerrar Look" : "Look"}
              </button>

              {mostrarEditor && (
                <div className="clan-war-lineup-room">
                  {/* "Look" (migraciones 127 y 129): apariencia de la
                      tarjeta, separado del resto de la gestión -- Fondo
                      (ya existía), Estructura (maqueta) y Dimensión
                      (relación de aspecto), en sub-pestañas.

                      Corrección: esta sala de edición llegó a tener el
                      fondo elegido (incluida la imagen subida, a
                      pantalla completa) pintado como decoración de este
                      mismo panel -- tapaba las miniaturas del selector y
                      el formulario de stream. El fondo es una propiedad
                      de la TARJETA (TarjetaLineupClanWar, arriba), no de
                      este panel de edición, así que ya no se aplica acá. */}
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
                      clanWarId={id!}
                      fondo={editor.fondo_lineup}
                      fondoImagenId={editor.fondo_lineup_imagen_id}
                      onCambio={recargarTodo}
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

                  {/* Stream propio de cada equipo (migración 125): cada
                      capitán carga el suyo acá mismo, sin pisar el del
                      rival -- antes esto ni existía en el lobby, solo en
                      la ficha del equipo, y encima era un único campo
                      compartido entre los dos lados. */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="editor-stream-link">
                      Tu stream (opcional)
                    </label>
                    <input
                      id="editor-stream-link"
                      className="form-input"
                      type="text"
                      placeholder="https://twitch.tv/tu_canal"
                      value={streamLinkEditado}
                      onChange={(e) => setStreamLinkEditado(e.target.value)}
                    />
                    <label className="form-checkbox-label">
                      <input
                        type="checkbox"
                        checked={streamDelayEditado}
                        onChange={(e) => setStreamDelayEditado(e.target.checked)}
                      />
                      Tiene delay
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={guardandoStream}
                      onClick={handleGuardarStream}
                    >
                      {guardandoStream ? "Guardando..." : "Guardar stream"}
                    </button>
                    {errorStream && <div className="form-error">{errorStream}</div>}
                    <p className="form-hint">
                      {editor.rival_stream_link
                        ? `Stream de ${editor.rival_nombre}: ${editor.rival_stream_link}${
                            editor.rival_stream_delay ? " (con delay)" : ""
                          }`
                        : `${editor.rival_nombre} todavía no cargó su stream.`}
                    </p>
                  </div>

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
                      <button type="button" className="btn btn-ghost" disabled={agregando} onClick={handleAgregar}>
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
                            <span className="tournament-card-meta">Jugador anotado (oculto hasta el visto bueno)</span>
                          )}
                          {entry.es_suplente && <span className="team-temp-badge">Suplente</span>}
                        </div>
                      ))}
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
