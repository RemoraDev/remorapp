import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatFecha } from "../lib/formatters";
import { vencioPlazoEdicionLineup } from "../lib/clanWars";
import TarjetaLineupClanWar from "../components/TarjetaLineupClanWar";
import LineupFondoPicker from "../components/LineupFondoPicker";
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
  const [fondoImagenUrl, setFondoImagenUrl] = useState<string | null>(null);

  const [jugadoresPorSetEditado, setJugadoresPorSetEditado] = useState("");
  const [guardandoJugadoresPorSet, setGuardandoJugadoresPorSet] = useState(false);
  const [errorJugadoresPorSet, setErrorJugadoresPorSet] = useState<string | null>(null);

  const [jugadorNuevo, setJugadorNuevo] = useState("");
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

  // Solo cuando el fondo elegido es una imagen del catálogo (no uno de
  // los 4 clásicos, que se pintan con CSS puro vía data-fondo-lineup).
  useEffect(() => {
    if (!editor?.fondo_lineup_imagen_id) {
      setFondoImagenUrl(null);
      return;
    }
    supabase
      .from("catalogo_fondos_lineup")
      .select("image_url")
      .eq("id", editor.fondo_lineup_imagen_id)
      .maybeSingle()
      .then(({ data }) => setFondoImagenUrl(data?.image_url ?? null));
  }, [editor?.fondo_lineup_imagen_id]);

  useEffect(() => {
    if (editor && !streamInicializado) {
      setStreamLinkEditado(editor.mi_stream_link ?? "");
      setStreamDelayEditado(!!editor.mi_stream_delay);
      setStreamInicializado(true);
    }
  }, [editor, streamInicializado]);

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
    setLinkNuevo("");
    setPosicionNueva("");
    setEsSuplenteNuevo(false);
    await recargarTodo();
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
                {mostrarEditor ? "Cerrar editor" : "Editar"}
              </button>

              {mostrarEditor && (
                <div
                  className="clan-war-lineup-room"
                  data-fondo-lineup={editor.fondo_lineup_imagen_id ? undefined : editor.fondo_lineup}
                  style={
                    editor.fondo_lineup_imagen_id && fondoImagenUrl
                      ? { backgroundImage: `url(${fondoImagenUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : undefined
                  }
                >
                  {/* Corrección: onCambio solo refrescaba cargarEditor()
                      (el fondo previsualizado acá adentro) -- la tarjeta
                      real de arriba (TarjetaLineupClanWar) usa los datos
                      de lineup_publico_clan_war(), una consulta aparte,
                      así que el cambio de fondo nunca le llegaba. */}
                  <LineupFondoPicker
                    clanWarId={id!}
                    fondo={editor.fondo_lineup}
                    fondoImagenId={editor.fondo_lineup_imagen_id}
                    onCambio={recargarTodo}
                  />

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
                      <div className="form-group">
                        <label className="form-label" htmlFor="editor-lineup-jugador">
                          Agregar jugador
                        </label>
                        <select
                          id="editor-lineup-jugador"
                          className="form-select"
                          value={jugadorNuevo}
                          onChange={(e) => setJugadorNuevo(e.target.value)}
                        >
                          <option value="">Selecciona un jugador</option>
                          {editor.roster_elegible.map((op) => (
                            <option key={`real:${op.jugador_id}`} value={`real:${op.jugador_id}`}>
                              {op.nombre}
                              {op.es_mercenario ? " (Mercenario)" : ""}
                              {op.es_aliado ? " (Aliado)" : ""}
                            </option>
                          ))}
                          {/* Formato WTL: solo admite temporales cuando el
                              reto NO pertenece a una temporada de torneo --
                              con temporada, el MMR de equipos por posición
                              exige un jugador real (ver armar_lineup_cw()
                              en la base, migración 120). */}
                          {(editor.formato !== "wtl" || !editor.es_de_torneo) &&
                            editor.temporales_propios.map((t) => (
                              <option key={`temp:${t.id}`} value={`temp:${t.id}`}>
                                {t.nick_temporal} (Temporal)
                              </option>
                            ))}
                        </select>
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
