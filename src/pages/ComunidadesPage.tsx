import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, Users, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import type { ComunidadRow } from "../types/comunidades";

interface ComunidadConInfo extends ComunidadRow {
  memberCount: number;
}

// Comunidades (migración 198, a pedido del usuario): grupos públicos,
// cualquiera puede crear una y cualquiera puede unirse con un click,
// sin aprobación -- mismo listado/buscador que Clanes (TeamsPage.tsx),
// pero más simple (sin tag, sin servidores, sin código de invitación).
export default function ComunidadesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [comunidades, setComunidades] = useState<ComunidadConInfo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [nombreNueva, setNombreNueva] = useState("");
  const [descripcionNueva, setDescripcionNueva] = useState("");
  const [creando, setCreando] = useState(false);

  const cargarComunidades = async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("comunidades")
      .select("*")
      .order("creado_en", { ascending: false });

    if (error || !data) {
      console.error("Error cargando comunidades:", error);
      setCargando(false);
      return;
    }

    const ids = data.map((c) => c.id as string);
    let conteoPorComunidad: Record<string, number> = {};

    if (ids.length > 0) {
      const { data: miembrosData } = await supabase
        .from("comunidad_miembros")
        .select("comunidad_id")
        .in("comunidad_id", ids);

      conteoPorComunidad = (miembrosData ?? []).reduce<Record<string, number>>((acc, m) => {
        acc[m.comunidad_id] = (acc[m.comunidad_id] ?? 0) + 1;
        return acc;
      }, {});
    }

    setComunidades(
      (data as ComunidadRow[]).map((c) => ({ ...c, memberCount: conteoPorComunidad[c.id] ?? 0 }))
    );
    setCargando(false);
  };

  useEffect(() => {
    cargarComunidades();
  }, []);

  const comunidadesFiltradas = comunidades
    .filter((c) => !busqueda.trim() || c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
    .sort((a, b) => b.memberCount - a.memberCount);

  const handleCrear = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const nombreLimpio = nombreNueva.trim();
    if (nombreLimpio.length < 3 || nombreLimpio.length > 40) {
      toast.error("El nombre tiene que tener entre 3 y 40 caracteres.");
      return;
    }
    if (
      contieneLenguajeInapropiado(nombreLimpio) ||
      (descripcionNueva.trim() && contieneLenguajeInapropiado(descripcionNueva))
    ) {
      toast.error("Ese nombre o descripción no está permitido. Por favor cámbialo.");
      return;
    }

    setCreando(true);
    const { data, error } = await supabase.rpc("crear_comunidad", {
      p_nombre: nombreLimpio,
      p_descripcion: descripcionNueva.trim() || null,
    });
    setCreando(false);

    if (error || !data) {
      toast.error(error?.message ?? "No se pudo crear la comunidad.");
      return;
    }

    toast.success("Comunidad creada correctamente.");
    navigate(`/comunidades/${data}`);
  };

  return (
    <div className="equipos-page-fijo">
      <div className="equipos-page-header">
        <div className="section-head">
          <h1 className="section-title">Comunidades</h1>
          {user && (
            <button type="button" className="btn btn-primary" onClick={() => setMostrarCrear(true)}>
              Crear comunidad
            </button>
          )}
        </div>

        <div className="team-search-moderna">
          <div className="team-search-moderna-input">
            <Search size={16} className="icon-inline" aria-hidden="true" />
            <input
              className="form-input"
              type="text"
              maxLength={40}
              placeholder="Buscar comunidad por nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="equipos-lista-scroll">
        {cargando && <p className="tournament-card-meta">Cargando comunidades...</p>}
        {!cargando && comunidadesFiltradas.length === 0 && (
          <p className="tournament-card-meta">No hay comunidades que calcen con esa búsqueda.</p>
        )}

        <div className="team-grid">
          {comunidadesFiltradas.map((comunidad) => (
            <Link key={comunidad.id} to={`/comunidades/${comunidad.id}`} className="team-card">
              {comunidad.logo_url ? (
                <img src={comunidad.logo_url} alt={comunidad.nombre} className="team-card-logo" />
              ) : (
                <div className="team-card-logo team-card-logo-placeholder">
                  <Users size={20} aria-hidden="true" />
                </div>
              )}
              <div className="team-card-info">
                <p className="team-card-name">{comunidad.nombre}</p>
                {comunidad.descripcion && <p className="team-card-tag">{comunidad.descripcion}</p>}
                <p className="team-card-meta">
                  {comunidad.memberCount} {comunidad.memberCount === 1 ? "integrante" : "integrantes"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {mostrarCrear && (
        <div className="modal-backdrop" onClick={() => setMostrarCrear(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setMostrarCrear(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <h2 className="modal-title">Crear comunidad</h2>
            <form className="modal-form" onSubmit={handleCrear}>
              <div className="form-group">
                <label className="form-label" htmlFor="comunidad-nombre">
                  Nombre
                </label>
                <input
                  id="comunidad-nombre"
                  className="form-input"
                  type="text"
                  required
                  minLength={3}
                  maxLength={40}
                  value={nombreNueva}
                  onChange={(e) => setNombreNueva(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="comunidad-descripcion">
                  Descripción (opcional)
                </label>
                <textarea
                  id="comunidad-descripcion"
                  className="form-textarea"
                  maxLength={280}
                  value={descripcionNueva}
                  onChange={(e) => setDescripcionNueva(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={creando}>
                  {creando ? "Creando..." : "Crear comunidad"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
