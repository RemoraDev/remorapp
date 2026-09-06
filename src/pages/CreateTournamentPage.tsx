import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import InfoTooltip from "../components/InfoTooltip";
import { MODOS } from "../lib/tournamentOptions";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import type { MapRow, TorneoFormato, TorneoModo } from "../types/tournaments";
import type { DivisionLiga, Liga } from "../types/ranking";

const FORMATOS: TorneoFormato[] = ["1v1", "2v2", "3v3", "4v4"];

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

  // Liga y división para el ranking de clanes (migración 060) --
  // ambas opcionales, elegidas por el organizador; sin relación con
  // formatoLiga (esa es el formato de competencia, esta es la
  // categoría a efectos del ranking).
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [divisiones, setDivisiones] = useState<DivisionLiga[]>([]);
  const [ligaId, setLigaId] = useState("");
  const [divisionId, setDivisionId] = useState("");

  const [mapas, setMapas] = useState<MapRow[]>([]);
  const [mapasIncluidos, setMapasIncluidos] = useState<Record<string, boolean>>({});
  const [mapasVeteables, setMapasVeteables] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogo de mapas: viene de la tabla `maps`, no está hardcodeado
  // en el frontend para poder agregar mapas nuevos solo desde Supabase.
  useEffect(() => {
    supabase
      .from("maps")
      .select("id, nombre, activo")
      .eq("activo", true)
      .order("nombre")
      .then(({ data, error: mapsError }) => {
        if (mapsError) {
          console.error("Error cargando mapas:", mapsError);
          return;
        }
        setMapas(data ?? []);
      });
  }, []);

  // Catálogo de ligas y divisiones (migración 060): se cargan las dos
  // tablas enteras de una vez -- son chicas (3 ligas, un puñado de
  // divisiones) -- y se filtra por liga elegida en el cliente.
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

  const toggleMapa = (id: string) => {
    setMapasIncluidos((prev) => ({ ...prev, [id]: !prev[id] }));
    // Al incluir un mapa por primera vez, queda veteable por defecto.
    setMapasVeteables((prev) => (prev[id] === undefined ? { ...prev, [id]: true } : prev));
  };

  const toggleVeteable = (id: string) => {
    setMapasVeteables((prev) => ({ ...prev, [id]: !prev[id] }));
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
        // no hay pasarela de pago conectada todavía. Cuando se agregue,
        // acá se calcularía la comisión de RemorApp (5%) sobre el pozo
        // ya descontada la comisión de la pasarela, algo como:
        //   comisionRemorApp = (pozoPremio - comisionPasarela) * 0.05
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
        liga_id: ligaId || null,
        division_id: divisionId || null,
      })
      .select()
      .single();

    if (torneoError || !torneo) {
      setError(torneoError?.message ?? "No se pudo crear el torneo.");
      setLoading(false);
      return;
    }

    const idsIncluidos = mapas.filter((m) => mapasIncluidos[m.id]).map((m) => m.id);

    if (idsIncluidos.length > 0) {
      const { error: mapasError } = await supabase.from("tournament_maps").insert(
        idsIncluidos.map((mapId) => ({
          tournament_id: torneo.id,
          map_id: mapId,
          es_veteable: mapasVeteables[mapId] ?? true,
        }))
      );

      // No bloqueamos la creación del torneo si falla guardar los
      // mapas: el torneo ya existe, solo faltaría reintentar esto.
      if (mapasError) {
        console.error("Error guardando mapas del torneo:", mapasError);
      }
    }

    setLoading(false);
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
    <section className="auth-page">
      <h1 className="auth-title">Crear torneo</h1>
      <p className="auth-sub">Configura tu torneo de StarCraft II.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

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
          <div className="form-radio-group">
            {MODOS.map((m) => (
              <div
                key={m.value}
                className={`form-radio-option ${modo === m.value ? "selected" : ""}`}
              >
                <label className="form-radio-label">
                  <input
                    type="radio"
                    name="modo"
                    checked={modo === m.value}
                    onChange={() => setModo(m.value)}
                  />
                  {m.label}
                </label>
                <InfoTooltip texto={m.descripcion} />
              </div>
            ))}
          </div>
        </div>

        {/* Liga para el ranking de clanes (migración 059): opcional,
            sin relación con el formato de liga "First Stand" de más
            abajo. Solo afecta el ranking en un torneo por equipos --
            en 1v1 el campeón nunca es un clan, así que elegirla acá no
            tiene efecto, pero no hace falta ocultarla por eso. */}
        <div className="form-group">
          <label className="form-label" htmlFor="torneo-liga-ranking">
            Liga (para el ranking de clanes)
          </label>
          <select
            id="torneo-liga-ranking"
            className="form-select"
            value={ligaId}
            onChange={(e) => handleCambiarLiga(e.target.value)}
          >
            <option value="">Ninguna</option>
            {ligas.map((liga) => (
              <option key={liga.id} value={liga.id}>
                {liga.nombre}
              </option>
            ))}
          </select>
          <p className="form-hint">
            Si el torneo es por equipos, el campeón suma un torneo ganado en el ranking de esta
            liga (y en "General").
          </p>

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

        {/* Formato de liga "First Stand" (migración 057): 7 clanes,
            todos contra todos completo y playoffs top 4 -- solo tiene
            sentido con eliminación simple y un formato por equipos
            (necesita clanes, no jugadores individuales). Al activarlo
            se ocultan la etapa de grupos y el tercer lugar manuales:
            First Stand ya trae su propia etapa de grupos (un solo
            grupo de 7) y su propia llave (top 4, sin tercer lugar). */}
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

        <div className="form-group">
          <span className="form-label">Mapas</span>
          <div className="map-picker">
            {mapas.map((mapa) => {
              const incluido = !!mapasIncluidos[mapa.id];
              return (
                <div key={mapa.id} className={`map-picker-item ${incluido ? "included" : ""}`}>
                  <label className="map-picker-name">
                    <input type="checkbox" checked={incluido} onChange={() => toggleMapa(mapa.id)} />
                    {mapa.nombre}
                  </label>
                  {incluido && (
                    <label className="map-picker-veto">
                      <input
                        type="checkbox"
                        checked={mapasVeteables[mapa.id] ?? true}
                        onChange={() => toggleVeteable(mapa.id)}
                      />
                      Se puede vetar
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

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
          {!publico && <p className="form-hint">Sin comisión — solo por invitación</p>}
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

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Creando torneo..." : "Crear torneo"}
        </button>
      </form>
    </section>
  );
}
