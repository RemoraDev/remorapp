import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import InfoTooltip from "../components/InfoTooltip";
import ModoIcono from "../components/ModoIcono";
import TipoEventoIcono from "../components/TipoEventoIcono";
import { MODOS } from "../lib/tournamentOptions";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import type { TorneoFormato, TorneoModo } from "../types/tournaments";
import type { DivisionLiga, Liga } from "../types/ranking";

const FORMATOS: TorneoFormato[] = ["1v1", "2v2", "3v3", "4v4"];

type TipoEvento = "privado" | "liga" | "amistosa";

const TIPOS_EVENTO: { value: TipoEvento; label: string; descripcion: string }[] = [
  {
    value: "amistosa",
    // Antes se llamaba "Clan War amistosa", un nombre engañoso: esto
    // NO es un reto directo 1 clan vs 1 clan (eso ya existe aparte,
    // como Clan War, desde el Panel de control del equipo) -- es el
    // torneo público genérico, con cupos y bracket/liga, sin
    // pertenecer a una liga oficial.
    label: "Torneo amistoso",
    descripcion: "Evento público, sin liga -- el caso general para un torneo entre la comunidad.",
  },
  {
    value: "liga",
    label: "Torneo por ligas",
    descripcion:
      "Parte de una competencia oficial con ranking (StarLeague Latam, BTL, etc.). Cualquier formato -- en 2v2/3v3/4v4, los clanes entran por invitación o solicitud, no por inscripción libre.",
  },
  {
    value: "privado",
    label: "Evento privado",
    descripcion: "Solo por invitación -- no aparece en el buscador público.",
  },
];

// Tolerancia de reloj/tiempo de carga del formulario -- mismo margen
// que usa el trigger validar_fecha_inicio_torneo() en la base
// (migración 074), para no rechazar en el cliente algo que la base
// aceptaría o viceversa.
const TOLERANCIA_FECHA_MS = 5 * 60 * 1000;

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

  // Etapa de grupos (migración 041) -- solo aplica con eliminación
  // simple, ver el gate en el JSX.
  const [tieneFaseGrupos, setTieneFaseGrupos] = useState(false);
  const [cantidadGrupos, setCantidadGrupos] = useState("2");
  const [avanzanPorGrupo, setAvanzanPorGrupo] = useState("2");

  // Partido por el tercer lugar (migración 046) -- mismo gate que la
  // etapa de grupos.
  const [tieneTercerLugar, setTieneTercerLugar] = useState(false);

  // Formato de liga "First Stand" (migración 057).
  const [formatoLiga, setFormatoLiga] = useState(false);
  const [puntosVictoria21, setPuntosVictoria21] = useState("3");
  const [avanzanPlayoffsFirstStand, setAvanzanPlayoffsFirstStand] = useState("4");

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
  const [errorLiga, setErrorLiga] = useState<string | null>(null);

  // Temporada (migración 079): se crea junto con el/los torneo(s) de
  // liga, en vez de tener que volver después a /tournaments/:id a
  // crearla a mano.
  const [temporadaModo, setTemporadaModo] = useState<"numerada" | "manual">("numerada");
  const [temporadaNumero, setTemporadaNumero] = useState("1");
  const [temporadaNombreManual, setTemporadaNombreManual] = useState("");
  const [temporadaFechaFin, setTemporadaFechaFin] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Default de cupos según el formato -- pero solo mientras el
  // organizador no haya tocado el campo a mano, para no pisarle un
  // valor que ya eligió.
  useEffect(() => {
    if (cuposTocados) return;
    setCuposTotales(formato === "1v1" ? "16" : "8");
  }, [formato, cuposTocados]);

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

  const toggleDivision = (id: string) => {
    setDivisionesSeleccionadas((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const puedeAvanzarDesdePaso1 = nombre.trim().length > 0;
  const puedeAvanzarDesdePaso2 = fechaInicio.length > 0 && Number(cuposTotales) >= 2;
  const puedeAvanzarDesdePaso3 = !esLiga || !!ligaId;

  const handleSiguiente = () => {
    setError(null);
    if (paso === 1 && !puedeAvanzarDesdePaso1) {
      setError("Ponle un nombre al torneo antes de seguir.");
      return;
    }
    if (paso === 2 && !puedeAvanzarDesdePaso2) {
      setError("Elige la fecha de inicio y una cantidad de cupos válida.");
      return;
    }
    if (paso === 3 && !puedeAvanzarDesdePaso3) {
      setError("Elige una liga antes de seguir.");
      return;
    }
    setPaso((p) => Math.min(p + 1, totalPasos));
  };

  const handleAtras = () => {
    setError(null);
    setPaso((p) => Math.max(p - 1, 1));
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
    // base.
    if (new Date(fechaInicio).getTime() < Date.now() - TOLERANCIA_FECHA_MS) {
      setError("La fecha de inicio no puede ser en el pasado.");
      return;
    }

    const divisionesElegidas = esLiga ? divisiones.filter((d) => divisionesSeleccionadas[d.id]) : [];

    if (esLiga && temporadaModo === "manual" && !temporadaNombreManual.trim()) {
      setError("Escribe el nombre de la temporada, o cambia a numerada.");
      return;
    }
    if (esLiga && !temporadaFechaFin) {
      setError("Elige la fecha de fin de la temporada.");
      return;
    }
    if (esLiga && temporadaFechaFin && new Date(temporadaFechaFin) <= new Date(fechaInicio)) {
      setError("La fecha de fin de la temporada debe ser posterior a la fecha de inicio del torneo.");
      return;
    }

    setLoading(true);
    setError(null);

    // Opciones avanzadas (Bracket/Permissions/Misc) ya NO se
    // configuran acá -- quedan en su valor por defecto al crear, y se
    // ajustan después desde la propia ficha del torneo (solo el
    // organizador las ve).
    const payloadBase = {
      formato,
      modo,
      publico: tipoEvento !== "privado",
      pozo_premio: tipoEvento !== "privado" && pozoPremio ? Number(pozoPremio) : null,
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
      formato_liga: modo === "eliminacion_simple" && formatoLiga ? "first_stand" : null,
      puntos_victoria_2_1: modo === "eliminacion_simple" && formatoLiga ? Number(puntosVictoria21) : 3,
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
        setError(
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

  return (
    <section className="create-tournament-page">
      <div className="section-head">
        <h1 className="section-title">Crear torneo</h1>
      </div>
      <p className="auth-sub" style={{ textAlign: "left", marginTop: 0, marginBottom: "0.5rem" }}>
        Paso {paso} de {totalPasos}
      </p>
      <p className="form-hint" style={{ marginBottom: "1.5rem" }}>
        Esto crea un <strong>torneo</strong>: con llave o tabla propia, para cualquier cantidad de
        inscritos. Si buscas un enfrentamiento directo entre dos clanes, eso es una{" "}
        <strong>Clan War</strong> -- se organiza aparte, desde el Panel de control de tu equipo.
      </p>

      <form className="create-tournament-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

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
              {esLiga && formato !== "1v1" && (
                <p className="form-hint">
                  Los clanes entran por invitación tuya o pidiendo el ingreso -- no hay inscripción
                  libre en un torneo de liga por equipos.
                </p>
              )}
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

            {modo === "eliminacion_simple" && formato !== "1v1" && (
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
                value={cuposTotales}
                onChange={(e) => {
                  setCuposTocados(true);
                  setCuposTotales(e.target.value);
                }}
              />
            </div>

            {tipoEvento !== "privado" && (
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
    </section>
  );
}
