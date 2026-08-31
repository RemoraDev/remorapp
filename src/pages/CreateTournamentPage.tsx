import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import InfoTooltip from "../components/InfoTooltip";
import { MODOS } from "../lib/tournamentOptions";
import type { MapRow, TorneoFormato, TorneoModo } from "../types/tournaments";

const FORMATOS: TorneoFormato[] = ["1v1", "2v2", "3v3", "4v4"];

export default function CreateTournamentPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [formato, setFormato] = useState<TorneoFormato>("1v1");
  const [modo, setModo] = useState<TorneoModo>("eliminacion_simple");
  const [publico, setPublico] = useState(true);
  const [pozoPremio, setPozoPremio] = useState("");
  const [cuposTotales, setCuposTotales] = useState("16");
  const [fechaInicio, setFechaInicio] = useState("");

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
            value={cuposTotales}
            onChange={(e) => setCuposTotales(e.target.value)}
          />
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
