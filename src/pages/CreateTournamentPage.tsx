import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import InfoTooltip from "../components/InfoTooltip";
import ModoIcono from "../components/ModoIcono";
import { MODOS } from "../lib/tournamentOptions";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import type { TorneoFormato, TorneoModo } from "../types/tournaments";
import type { DivisionLiga, Liga } from "../types/ranking";

const FORMATOS: TorneoFormato[] = ["1v1", "2v2", "3v3", "4v4"];

// Tolerancia de reloj/tiempo de carga del formulario -- mismo margen
// que usa el trigger validar_fecha_inicio_torneo() en la base
// (migración 074), para no rechazar en el cliente algo que la base
// aceptaría o viceversa.
const TOLERANCIA_FECHA_MS = 5 * 60 * 1000;

export default function CreateTournamentPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [formato, setFormato] = useState<TorneoFormato>("1v1");
  const [modo, setModo] = useState<TorneoModo>("eliminacion_simple");
  const [publico, setPublico] = useState(true);
  const [pozoPremio, setPozoPremio] = useState("");
  const [cuposTotales, setCuposTotales] = useState("16");
  const [fechaInicio, setFechaInicio] = useState("");

  // Etapa de grupos (migración 041) -- solo aplica con eliminación
  // simple, ver el gate en el JSX.
  const [tieneFaseGrupos, setTieneFaseGrupos] = useState(false);
  const [cantidadGrupos, setCantidadGrupos] = useState("2");
  const [avanzanPorGrupo, setAvanzanPorGrupo] = useState("2");

  // Partido por el tercer lugar (migración 046) -- mismo gate que la
  // etapa de grupos: solo tiene sentido con eliminación simple, único
  // modo que tiene llave.
  const [tieneTercerLugar, setTieneTercerLugar] = useState(false);

  // Formato de liga "First Stand" (migración 057) -- 7 clanes, fixture
  // round-robin completo y playoffs top 4. Reemplaza la configuración
  // manual de etapa de grupos/tercer lugar (las oculta en el JSX): ya
  // trae su propia etapa de grupos de un solo grupo de 7 y su propia
  // llave de 4, sin partido por el tercer lugar.
  const [formatoLiga, setFormatoLiga] = useState(false);
  const [puntosVictoria21, setPuntosVictoria21] = useState("3");

  // Liga y división para el ranking de clanes (migración 060, rediseño
  // en la migración 074): apagado por defecto -- son la minoría de
  // los torneos (los que son parte de una competencia oficial con
  // ranking), no el caso general de un evento amistoso entre amigos.
  const [usarLiga, setUsarLiga] = useState(false);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [divisiones, setDivisiones] = useState<DivisionLiga[]>([]);
  const [ligaId, setLigaId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [mostrarFormNuevaLiga, setMostrarFormNuevaLiga] = useState(false);
  const [nuevaLigaNombre, setNuevaLigaNombre] = useState("");
  const [creandoLiga, setCreandoLiga] = useState(false);
  const [errorLiga, setErrorLiga] = useState<string | null>(null);

  // Suizo (migración 069): en blanco = generar_torneo_suizo() calcula
  // sola la cantidad de rondas (techo de log2 de los inscritos).
  const [swissRondas, setSwissRondas] = useState("");

  // Modo simple/avanzado (migración 069): el modo avanzado revela las
  // opciones de las pestañas Bracket/Permissions/Misc del formulario
  // de referencia -- el resto (Notifications, adjuntos, avance rápido,
  // compartir acceso de admin) queda para un pedido aparte.
  const [modoAvanzado, setModoAvanzado] = useState(false);
  const [mostrarNombresRonda, setMostrarNombresRonda] = useState(false);
  const [ocultarNumerosSemilla, setOcultarNumerosSemilla] = useState(false);
  const [ocultarBracketPublico, setOcultarBracketPublico] = useState(false);
  const [reglasSemillas, setReglasSemillas] = useState<"aleatorio" | "tradicional">("aleatorio");
  const [permiteAutoreporte, setPermiteAutoreporte] = useState(true);
  const [excluidoDeBusqueda, setExcluidoDeBusqueda] = useState(false);
  const [mostrarPosiciones, setMostrarPosiciones] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogo de ligas y divisiones (migración 060): se cargan las dos
  // tablas enteras de una vez -- son chicas -- y se filtra por liga
  // elegida en el cliente.
  useEffect(() => {
    Promise.all([
      supabase.from("ligas").select("id, nombre").order("nombre"),
      supabase.from("divisiones_liga").select("id, liga_id, nombre, mmr_limite").order("nombre"),
    ]).then(([ligasRes, divisionesRes]) => {
      if (ligasRes.error) {
        console.error("Error cargando ligas:", ligasRes.error);
      } else {
        setLigas(ligasRes.data ?? []);
      }
      if (divisionesRes.error) {
        console.error("Error cargando divisiones:", divisionesRes.error);
      } else {
        setDivisiones(divisionesRes.data ?? []);
      }
    });
  }, []);

  // Al cambiar de liga, la división elegida (si era de otra liga) deja
  // de tener sentido -- se limpia para no mandar una combinación
  // inválida (el trigger de la base la rechazaría igual, pero es mejor
  // no dejar que el usuario llegue a ese error).
  const divisionesDeLaLiga = divisiones.filter((d) => d.liga_id === ligaId);
  const handleCambiarLiga = (nuevaLigaId: string) => {
    setLigaId(nuevaLigaId);
    setDivisionId("");
  };

  const handleToggleUsarLiga = (activo: boolean) => {
    setUsarLiga(activo);
    if (!activo) {
      setLigaId("");
      setDivisionId("");
      setMostrarFormNuevaLiga(false);
    }
  };

  // crear_liga() (en la base) es la que de verdad valida el nombre y
  // que no exista ya una liga igual -- disponible para cualquier
  // cuenta, no solo administradores (pedido explícito).
  const handleCrearLiga = async () => {
    const nombreLimpio = nuevaLigaNombre.trim();
    if (!nombreLimpio) return;

    if (contieneLenguajeInapropiado(nombreLimpio)) {
      setErrorLiga("Ese nombre no está permitido.");
      return;
    }

    setCreandoLiga(true);
    setErrorLiga(null);

    const { data, error: crearError } = await supabase.rpc("crear_liga", { p_nombre: nombreLimpio });

    setCreandoLiga(false);

    if (crearError || !data) {
      setErrorLiga(crearError?.message ?? "No se pudo crear la liga.");
      return;
    }

    const nuevaLiga = { id: data as string, nombre: nombreLimpio };
    setLigas((prev) => [...prev, nuevaLiga].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setLigaId(nuevaLiga.id);
    setNuevaLigaNombre("");
    setMostrarFormNuevaLiga(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    // También bloqueado a nivel de RLS (tournaments_insert_propio, ver
    // migración 004) -- este chequeo acá es solo para no dejar mandar
    // el formulario y mostrar el aviso al toque, no la única barrera.
    if (profile?.suspendido) {
      setError("Tu cuenta está suspendida.");
      return;
    }

    // El nombre del torneo se muestra públicamente (listado y detalle),
    // así que pasa por el mismo filtro que el nick.
    if (contieneLenguajeInapropiado(nombre)) {
      setError("Ese nombre no está permitido. Por favor elige otro.");
      return;
    }

    // Migración 074: mismo margen de tolerancia que el trigger de la
    // base -- esto solo evita mandar el formulario y esperar el viaje
    // al servidor para enterarse, no es la única barrera real.
    if (new Date(fechaInicio).getTime() < Date.now() - TOLERANCIA_FECHA_MS) {
      setError("La fecha de inicio no puede ser en el pasado.");
      return;
    }

    setLoading(true);
    setError(null);

    const { data: torneo, error: torneoError } = await supabase
      .from("tournaments")
      .insert({
        nombre,
        formato,
        modo,
        publico,
        // Por ahora solo guardamos el monto del pozo, sin cobro real:
        // no hay pasarela de pago conectada todavía ni comisión de
        // ningún tipo.
        pozo_premio: publico && pozoPremio ? Number(pozoPremio) : null,
        cupos_totales: Number(cuposTotales),
        fecha_inicio: new Date(fechaInicio).toISOString(),
        creador_id: user.id,
        tiene_fase_grupos: modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos,
        cantidad_grupos:
          modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos ? Number(cantidadGrupos) : null,
        avanzan_por_grupo:
          modo === "eliminacion_simple" && !formatoLiga && tieneFaseGrupos ? Number(avanzanPorGrupo) : null,
        tiene_tercer_lugar: modo === "eliminacion_simple" && !formatoLiga && tieneTercerLugar,
        formato_liga: modo === "eliminacion_simple" && formatoLiga ? "first_stand" : null,
        puntos_victoria_2_1: modo === "eliminacion_simple" && formatoLiga ? Number(puntosVictoria21) : 3,
        liga_id: usarLiga && ligaId ? ligaId : null,
        division_id: usarLiga && divisionId ? divisionId : null,
        swiss_rondas_totales: modo === "suizo" && swissRondas ? Number(swissRondas) : null,
        mostrar_nombres_ronda_personalizados: modoAvanzado && mostrarNombresRonda,
        ocultar_numeros_semilla: modoAvanzado && ocultarNumerosSemilla,
        ocultar_bracket_publico: modoAvanzado && ocultarBracketPublico,
        reglas_semillas: modoAvanzado ? reglasSemillas : "aleatorio",
        permite_autoreporte: modoAvanzado ? permiteAutoreporte : true,
        excluido_de_busqueda: modoAvanzado && excluidoDeBusqueda,
        mostrar_posiciones: modoAvanzado ? mostrarPosiciones : true,
      })
      .select()
      .single();

    setLoading(false);

    if (torneoError || !torneo) {
      setError(torneoError?.message ?? "No se pudo crear el torneo.");
      return;
    }

    navigate("/tournaments");
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

  return (
    <section className="create-tournament-page">
      <div className="section-head">
        <h1 className="section-title">Crear torneo</h1>
      </div>
      <p className="auth-sub" style={{ textAlign: "left", marginTop: 0 }}>
        Configura tu torneo de StarCraft II paso a paso.
      </p>
      {/* Aclaración explícita: "torneo" y "Clan War" son dos cosas
          distintas en RemorApp, con creación separada -- este
          formulario es solo para torneos (con llave o tabla propia,
          para cualquier cantidad de inscritos). Un enfrentamiento
          puntual entre dos clanes se organiza como Clan War, desde el
          Panel de control del equipo, no acá. */}
      <p className="form-hint" style={{ marginBottom: "1.5rem" }}>
        Esto crea un <strong>torneo</strong>: con llave o tabla propia, para cualquier cantidad de
        inscritos. Si buscas un enfrentamiento directo entre dos clanes, eso es una{" "}
        <strong>Clan War</strong> -- se organiza aparte, desde el Panel de control de tu equipo.
        Marca "Privado" en Visibilidad si es solo para vos y tus amigos; activa la Liga solo si
        este torneo es parte de una competencia oficial con ranking.
      </p>

      <form className="create-tournament-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

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
              {FORMATOS.map((f) => (
                <label key={f} className={`pill-radio-option ${formato === f ? "selected" : ""}`}>
                  <input
                    type="radio"
                    className="sr-only"
                    name="formato"
                    checked={formato === f}
                    onChange={() => setFormato(f)}
                  />
                  {f}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <span className="form-label">Modo de juego</span>
            <div className="modo-grid">
              {MODOS.map((m) => (
                <div key={m.value} className={`modo-card ${modo === m.value ? "selected" : ""}`}>
                  <label className="modo-card-label">
                    <input
                      type="radio"
                      className="sr-only"
                      name="modo"
                      checked={modo === m.value}
                      onChange={() => setModo(m.value)}
                    />
                    <ModoIcono modo={m.value} />
                    <span>{m.label}</span>
                  </label>
                  <InfoTooltip texto={m.descripcion} />
                </div>
              ))}
            </div>
          </div>

          {/* Suizo (migración 069): en blanco, generar_torneo_suizo() la
              calcula sola (techo de log2 de los inscritos) recién al
              iniciar el torneo -- acá es solo para fijarla a mano si el
              organizador prefiere una cantidad puntual. */}
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

          <div className="form-group">
            <label className="form-label" htmlFor="torneo-fecha">
              Fecha de inicio
            </label>
            <input
              id="torneo-fecha"
              className="form-input"
              type="datetime-local"
              required
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
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
              disabled={formatoLiga}
              value={cuposTotales}
              onChange={(e) => setCuposTotales(e.target.value)}
            />
            {formatoLiga && <p className="form-hint">First Stand es siempre para 7 clanes.</p>}
          </div>
        </div>

        <div className="form-section">
          <h2 className="form-section-title">
            <span className="form-section-title-numero">2</span>
            Formato de competencia
          </h2>

          {/* Liga para el ranking de clanes (migración 059, rediseño en
              la 074): apagada por defecto -- sin relación con el
              formato de liga "First Stand" de más abajo. Solo afecta
              el ranking en un torneo por equipos -- en 1v1 el campeón
              nunca es un clan, así que activarla acá no tiene efecto,
              pero no hace falta ocultarla por eso. */}
          <div className="form-group">
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={usarLiga}
                onChange={(e) => handleToggleUsarLiga(e.target.checked)}
              />
              Este torneo cuenta para el ranking de una liga
            </label>
            <p className="form-hint">
              Activalo solo si es parte de una competencia oficial (StarLeague Latam, BTL, etc.) --
              un evento amistoso no lo necesita. Si el torneo es por equipos, el campeón suma un
              torneo ganado en el ranking de la liga elegida (y en "General").
            </p>

            {usarLiga && (
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-liga-ranking">
                  Liga
                </label>
                <select
                  id="torneo-liga-ranking"
                  className="form-select"
                  value={ligaId}
                  onChange={(e) => handleCambiarLiga(e.target.value)}
                >
                  <option value="">Elige una liga</option>
                  {ligas.map((liga) => (
                    <option key={liga.id} value={liga.id}>
                      {liga.nombre}
                    </option>
                  ))}
                </select>

                {!mostrarFormNuevaLiga ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setMostrarFormNuevaLiga(true)}
                  >
                    + Agregar nueva liga
                  </button>
                ) : (
                  <div className="form-group">
                    {errorLiga && <div className="form-error">{errorLiga}</div>}
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
                          setErrorLiga(null);
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {ligaId && (
                  <>
                    <label className="form-label" htmlFor="torneo-division-ranking">
                      División
                    </label>
                    <select
                      id="torneo-division-ranking"
                      className="form-select"
                      value={divisionId}
                      onChange={(e) => setDivisionId(e.target.value)}
                    >
                      <option value="">Ninguna</option>
                      {divisionesDeLaLiga.map((division) => (
                        <option key={division.id} value={division.id}>
                          {division.nombre}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Formato de liga "First Stand" (migración 057): 7 clanes,
              todos contra todos completo y playoffs top 4 -- solo
              tiene sentido con eliminación simple y un formato por
              equipos (necesita clanes, no jugadores individuales). Al
              activarlo se ocultan la etapa de grupos y el tercer lugar
              manuales: First Stand ya trae su propia etapa de grupos
              (un solo grupo de 7) y su propia llave (top 4, sin
              tercer lugar). */}
          {modo === "eliminacion_simple" && formato !== "1v1" && (
            <div className="form-group">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={formatoLiga}
                  onChange={(e) => {
                    setFormatoLiga(e.target.checked);
                    if (e.target.checked) setCuposTotales("7");
                  }}
                />
                Formato de liga "First Stand"
              </label>
              <p className="form-hint">
                Pensado para 7 clanes: fixture de todos contra todos completo (21 partidos en 7
                jornadas, nadie repite rival) y playoffs entre los 4 mejores, con la final al mejor
                de 5.
              </p>

              {formatoLiga && (
                <div className="form-group">
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
                </div>
              )}
            </div>
          )}

          {/* Etapa de grupos (migración 041): todos contra todos dentro
              de cada grupo, con los mejores avanzando a la llave. Solo
              tiene sentido con eliminación simple -- generar_grupos()
              en la base rechaza cualquier otro modo, así que se oculta
              acá directamente en vez de dejar armar una configuración
              que después va a fallar al generarla. Se oculta también
              con First Stand activo: ese formato arma su propia etapa
              de grupos automáticamente. */}
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

          {/* Partido por el tercer lugar (migración 046): entre los
              perdedores de semifinal, en paralelo a la final -- mismo
              gate que la etapa de grupos, solo eliminación simple tiene
              llave. Se oculta con First Stand activo, que no tiene
              partido por el tercer lugar. */}
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

        <div className="form-section">
          <h2 className="form-section-title">
            <span className="form-section-title-numero">3</span>
            Visibilidad y premios
          </h2>
          <div className="form-group">
            <span className="form-label">Visibilidad</span>
            <div className="form-radio-group">
              <label className={`form-radio-option ${publico ? "selected" : ""}`}>
                <input type="radio" name="publico" checked={publico} onChange={() => setPublico(true)} />
                Público
              </label>
              <label className={`form-radio-option ${!publico ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="publico"
                  checked={!publico}
                  onChange={() => setPublico(false)}
                />
                Privado
              </label>
            </div>
            {!publico && <p className="form-hint">Solo por invitación.</p>}
          </div>

          {publico && (
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
          )}
        </div>

        {/* Modo simple/avanzado (migración 069): equivalente a las
            pestañas Bracket/Permissions/Misc del formulario de
            referencia -- Notifications, adjuntos en partidos, avance
            rápido y compartir acceso de admin quedan para un pedido
            aparte, todavía no tienen la infraestructura detrás (no
            hay sistema de notificaciones ni de adjuntos en RemorApp). */}
        <div className="form-section">
          <h2 className="form-section-title">
            <span className="form-section-title-numero">4</span>
            Opciones avanzadas
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => setModoAvanzado((v) => !v)}
          >
            {modoAvanzado ? "Ocultar opciones avanzadas" : "Mostrar opciones avanzadas"}
          </button>

          {modoAvanzado && (
            <div className="advanced-options-panel">
              <h3 className="detail-subtitle">Bracket</h3>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={mostrarNombresRonda}
                  onChange={(e) => setMostrarNombresRonda(e.target.checked)}
                />
                Mostrar nombres de ronda personalizados (Octavos, Cuartos, Semifinal, Final)
              </label>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={ocultarNumerosSemilla}
                  onChange={(e) => setOcultarNumerosSemilla(e.target.checked)}
                />
                Ocultar los números de las semillas
              </label>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={ocultarBracketPublico}
                  onChange={(e) => setOcultarBracketPublico(e.target.checked)}
                />
                Ocultar la vista previa del cuadro al público (solo la ven los inscritos)
              </label>
              <div className="form-group">
                <label className="form-label" htmlFor="torneo-reglas-semillas">
                  Ubicar a los participantes en el cuadro usando
                </label>
                <select
                  id="torneo-reglas-semillas"
                  className="form-select"
                  value={reglasSemillas}
                  onChange={(e) => setReglasSemillas(e.target.value as "aleatorio" | "tradicional")}
                >
                  <option value="aleatorio">Sorteo al azar</option>
                  <option value="tradicional">Semillas tradicionales (por MMR)</option>
                </select>
                <p className="form-hint">
                  Con semillas tradicionales, el mejor MMR ocupa la semilla 1, el segundo mejor la 2,
                  etc. -- así los mejores puestos no se cruzan entre sí en las primeras rondas.
                </p>
              </div>

              <h3 className="detail-subtitle">Permissions</h3>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={permiteAutoreporte}
                  onChange={(e) => setPermiteAutoreporte(e.target.checked)}
                />
                Permitir que los participantes reporten su propio resultado
              </label>
              <p className="form-hint">
                Desactivado, solo vos como organizador vas a poder cargar los resultados de cada
                partida.
              </p>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={excluidoDeBusqueda}
                  onChange={(e) => setExcluidoDeBusqueda(e.target.checked)}
                />
                Excluir este torneo del buscador público
              </label>

              <h3 className="detail-subtitle">Misc</h3>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={mostrarPosiciones}
                  onChange={(e) => setMostrarPosiciones(e.target.checked)}
                />
                Mostrar la pestaña de posiciones
              </label>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Creando torneo..." : "Crear torneo"}
        </button>
      </form>
    </section>
  );
}
