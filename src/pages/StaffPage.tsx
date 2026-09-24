import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatFecha } from "../lib/formatters";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import ListaNoticiasReordenable from "../components/ListaNoticiasReordenable";

interface ReporteStaff {
  id: string;
  asunto: string;
  descripcion: string;
  createdAt: string;
  reportadoPorNombre: string;
  resuelto: boolean;
  resueltoPorNombre: string | null;
  resueltoEn: string | null;
}

interface BugReportado {
  id: string;
  titulo: string;
  descripcion: string;
  status: "abierto" | "en_revision" | "resuelto";
  createdAt: string;
  reportadoPorNombre: string;
}

const BUG_STATUS_LABEL: Record<BugReportado["status"], string> = {
  abierto: "Abierto",
  en_revision: "En revisión",
  resuelto: "Resuelto",
};

// Migración 094: Panel Staff -- distinto del Panel de Administración
// completo (AdminPage.tsx). Permisos deliberadamente acotados: crear
// ligas de clanes, ver/resolver "Reportar un problema" (reportes_staff)
// y reportar bugs (bugs_reportados). Staff NO tiene acceso acá a nada
// de lo que ya está restringido en la base a es_dueno_plataforma o
// is_admin (intervenir lineups, ver lineups sin revelar, suspender
// cuentas, eliminar equipos/torneos/noticias, el registro de actividad
// del dueño) -- esas restricciones viven en RLS/RPC, no en esta
// página, así que no hace falta repetirlas acá.
export default function StaffPage() {
  const { user, profile, loading: authLoading } = useAuth();

  // --- Crear liga de clanes (mismo mecanismo que ya usa cualquier
  // cuenta autenticada desde /tournaments/create, ver crear_liga()) ---
  const [nombreLiga, setNombreLiga] = useState("");
  const [creandoLiga, setCreandoLiga] = useState(false);
  const [errorLiga, setErrorLiga] = useState<string | null>(null);
  const [ligaCreada, setLigaCreada] = useState<string | null>(null);

  const handleCrearLiga = async (event: FormEvent) => {
    event.preventDefault();
    const nombreLimpio = nombreLiga.trim();
    if (!nombreLimpio) return;

    if (contieneLenguajeInapropiado(nombreLimpio)) {
      setErrorLiga("Ese nombre no está permitido.");
      return;
    }

    setCreandoLiga(true);
    setErrorLiga(null);
    setLigaCreada(null);

    const { error } = await supabase.rpc("crear_liga", { p_nombre: nombreLimpio });

    setCreandoLiga(false);

    if (error) {
      setErrorLiga(error.message);
      return;
    }

    setLigaCreada(nombreLimpio);
    setNombreLiga("");
  };

  // --- Reportes al staff ("Reportar un problema") ---
  const [reportes, setReportes] = useState<ReporteStaff[]>([]);
  const [cargandoReportes, setCargandoReportes] = useState(true);
  const [errorReportes, setErrorReportes] = useState<string | null>(null);
  const [verReportesResueltos, setVerReportesResueltos] = useState(false);
  const [resolviendoReporte, setResolviendoReporte] = useState<string | null>(null);
  const [erroresResolverReporte, setErroresResolverReporte] = useState<Record<string, string>>({});

  const cargarReportes = async () => {
    const { data, error } = await supabase
      .from("reportes_staff")
      .select(
        "id, asunto, descripcion, created_at, resuelto, resuelto_en, reportador:profiles!reportado_por(nombre, nick, unique_id), resolutor:profiles!resuelto_por(nick, unique_id)"
      )
      .order("created_at", { ascending: false });

    if (error) {
      setErrorReportes(error.message);
      setCargandoReportes(false);
      return;
    }

    setReportes(
      (data ?? []).map((r) => {
        const reportador = Array.isArray(r.reportador) ? r.reportador[0] : r.reportador;
        const p = reportador as { nombre: string | null; nick: string | null; unique_id: string | null } | null;
        const resolutor = Array.isArray(r.resolutor) ? r.resolutor[0] : r.resolutor;
        const rp = resolutor as { nick: string | null; unique_id: string | null } | null;
        return {
          id: r.id,
          asunto: r.asunto,
          descripcion: r.descripcion,
          createdAt: r.created_at,
          reportadoPorNombre: p?.nick ? `${p.nick}#${p.unique_id}` : p?.nombre ?? "Jugador de RemorApp",
          resuelto: r.resuelto,
          resueltoPorNombre: rp?.nick ? `${rp.nick}#${rp.unique_id}` : null,
          resueltoEn: r.resuelto_en,
        };
      })
    );
    setCargandoReportes(false);
  };

  const handleResolverReporte = async (reporteId: string) => {
    setResolviendoReporte(reporteId);
    setErroresResolverReporte((prev) => ({ ...prev, [reporteId]: "" }));

    const { error } = await supabase
      .from("reportes_staff")
      .update({ resuelto: true, resuelto_por: user?.id, resuelto_en: new Date().toISOString() })
      .eq("id", reporteId);

    setResolviendoReporte(null);

    if (error) {
      setErroresResolverReporte((prev) => ({ ...prev, [reporteId]: error.message }));
      return;
    }

    await cargarReportes();
  };

  // --- Reportar un bug (bugs_reportados) ---
  const [bugs, setBugs] = useState<BugReportado[]>([]);
  const [cargandoBugs, setCargandoBugs] = useState(true);
  const [errorBugs, setErrorBugs] = useState<string | null>(null);
  const [tituloBug, setTituloBug] = useState("");
  const [descripcionBug, setDescripcionBug] = useState("");
  const [enviandoBug, setEnviandoBug] = useState(false);
  const [bugEnviado, setBugEnviado] = useState(false);

  const cargarBugs = async () => {
    const { data, error } = await supabase
      .from("bugs_reportados")
      .select("id, titulo, descripcion, status, created_at, profiles!reportado_por(nick, unique_id)")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorBugs(error.message);
      setCargandoBugs(false);
      return;
    }

    setBugs(
      (data ?? []).map((b) => {
        const perfil = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
        const p = perfil as { nick: string | null; unique_id: string | null } | null;
        return {
          id: b.id,
          titulo: b.titulo,
          descripcion: b.descripcion,
          status: b.status as BugReportado["status"],
          createdAt: b.created_at,
          reportadoPorNombre: p?.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp",
        };
      })
    );
    setCargandoBugs(false);
  };

  const handleReportarBug = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const tituloLimpio = tituloBug.trim();
    const descripcionLimpia = descripcionBug.trim();
    if (!tituloLimpio || !descripcionLimpia) return;

    setEnviandoBug(true);
    setErrorBugs(null);
    setBugEnviado(false);

    const { error } = await supabase.from("bugs_reportados").insert({
      reportado_por: user.id,
      titulo: tituloLimpio,
      descripcion: descripcionLimpia,
    });

    setEnviandoBug(false);

    if (error) {
      setErrorBugs(error.message);
      return;
    }

    setBugEnviado(true);
    setTituloBug("");
    setDescripcionBug("");
    await cargarBugs();
  };

  // --- Migración 100: reordenar noticias (solo el orden -- publicar y
  // eliminar noticias sigue siendo exclusivo del Panel de
  // Administración completo, acá no se agrega esa capacidad). ---
  const [noticiasOrden, setNoticiasOrden] = useState<{ id: string; titulo: string }[]>([]);
  const [cargandoNoticiasOrden, setCargandoNoticiasOrden] = useState(true);

  const cargarNoticiasOrden = async () => {
    const { data, error } = await supabase
      .from("noticias")
      .select("id, titulo")
      .order("orden", { ascending: true });

    if (error) {
      console.error("Error cargando noticias:", error);
      setCargandoNoticiasOrden(false);
      return;
    }

    setNoticiasOrden(data ?? []);
    setCargandoNoticiasOrden(false);
  };

  useEffect(() => {
    cargarReportes();
    cargarBugs();
    cargarNoticiasOrden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orden importa: primero la sesión, después el perfil (llega por una
  // consulta aparte, después de la sesión) -- se muestra "nada"
  // mientras cualquiera de los dos está cargando, para no mandar a
  // Inicio a un miembro real del staff por apurarse (mismo patrón que
  // AdminPage.tsx).
  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!profile) return null;
  if (!profile.es_staff && !profile.es_admin) return <Navigate to="/" replace />;

  const pendientes = reportes.filter((r) => !r.resuelto);
  const reportesVisibles = verReportesResueltos ? reportes : pendientes;

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Panel Staff</h1>
      </div>
      <p className="form-hint" style={{ marginBottom: "1.5rem" }}>
        Panel simple para tareas de Staff -- distinto del Panel de Administración completo. Acá solo se
        puede crear una liga de clanes, ver y resolver los reportes al staff, y reportar bugs de la
        plataforma.
      </p>

      <div className="form-section">
        <h2 className="form-section-title">Crear liga de clanes</h2>
        <form className="auth-form" onSubmit={handleCrearLiga}>
          {errorLiga && <div className="form-error">{errorLiga}</div>}
          {ligaCreada && <div className="form-success">Liga "{ligaCreada}" creada correctamente.</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="staff-nombre-liga">
              Nombre de la liga
            </label>
            <input
              id="staff-nombre-liga"
              className="form-input"
              type="text"
              value={nombreLiga}
              onChange={(e) => setNombreLiga(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creandoLiga || !nombreLiga.trim()}>
            {creandoLiga ? "Creando..." : "Crear liga"}
          </button>
        </form>
      </div>

      <div className="form-section">
        <h2 className="form-section-title">Reportes al staff</h2>
        <div className="admin-panel">
          <div className="admin-row-actions">
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={verReportesResueltos}
                onChange={(e) => setVerReportesResueltos(e.target.checked)}
              />
              Ver también los ya resueltos ({reportes.length - pendientes.length})
            </label>
          </div>

          {errorReportes && <div className="form-error">{errorReportes}</div>}
          {cargandoReportes && <p className="tournament-card-meta">Cargando reportes...</p>}
          {!cargandoReportes && reportesVisibles.length === 0 && (
            <p className="detail-empty">{pendientes.length === 0 ? "No hay reportes pendientes." : "No hay reportes."}</p>
          )}
          <div className="admin-list">
            {reportesVisibles.map((r) => (
              <div key={r.id} className="admin-row">
                <div className="admin-row-info">
                  <p className="admin-row-title">{r.asunto}</p>
                  <p className="admin-row-meta">
                    {r.reportadoPorNombre} · {formatFecha(r.createdAt)}
                  </p>
                  <p className="admin-row-meta">{r.descripcion}</p>
                  {r.resuelto && (
                    <p className="form-success">
                      Resuelto {r.resueltoPorNombre && `por ${r.resueltoPorNombre}`}
                      {r.resueltoEn && ` el ${formatFecha(r.resueltoEn)}`}
                    </p>
                  )}
                  {erroresResolverReporte[r.id] && <div className="form-error">{erroresResolverReporte[r.id]}</div>}
                </div>
                {!r.resuelto && (
                  <div className="admin-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={resolviendoReporte === r.id}
                      onClick={() => handleResolverReporte(r.id)}
                    >
                      {resolviendoReporte === r.id ? "Marcando..." : "Marcar como resuelto"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="form-section">
        <h2 className="form-section-title">Reportar un bug</h2>
        <form className="auth-form" onSubmit={handleReportarBug}>
          {errorBugs && <div className="form-error">{errorBugs}</div>}
          {bugEnviado && <div className="form-success">Bug reportado correctamente.</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="staff-bug-titulo">
              Título
            </label>
            <input
              id="staff-bug-titulo"
              className="form-input"
              type="text"
              maxLength={150}
              value={tituloBug}
              onChange={(e) => setTituloBug(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="staff-bug-descripcion">
              Descripción
            </label>
            <textarea
              id="staff-bug-descripcion"
              className="form-textarea"
              maxLength={2000}
              value={descripcionBug}
              onChange={(e) => setDescripcionBug(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={enviandoBug || !tituloBug.trim() || !descripcionBug.trim()}
          >
            {enviandoBug ? "Enviando..." : "Reportar bug"}
          </button>
        </form>

        <h3 className="detail-subtitle" style={{ marginTop: "1.5rem" }}>
          Bugs reportados
        </h3>
        {cargandoBugs && <p className="tournament-card-meta">Cargando bugs...</p>}
        {!cargandoBugs && bugs.length === 0 && <p className="detail-empty">Todavía no se reportó ningún bug.</p>}
        <div className="admin-list">
          {bugs.map((b) => (
            <div key={b.id} className="admin-row">
              <div className="admin-row-info">
                <p className="admin-row-title">
                  {b.titulo} <span className="liga-badge">{BUG_STATUS_LABEL[b.status]}</span>
                </p>
                <p className="admin-row-meta">
                  {b.reportadoPorNombre} · {formatFecha(b.createdAt)}
                </p>
                <p className="admin-row-meta">{b.descripcion}</p>
              </div>
            </div>
          ))}
        </div>

        <h3 className="detail-subtitle" style={{ marginTop: "1.5rem" }}>
          Reordenar noticias
        </h3>
        <p className="form-hint">Arrastra desde el ícono para cambiar el orden en que aparecen en Noticias.</p>
        {cargandoNoticiasOrden && <p className="tournament-card-meta">Cargando noticias...</p>}
        {!cargandoNoticiasOrden && noticiasOrden.length === 0 && (
          <p className="detail-empty">Todavía no hay ninguna noticia publicada.</p>
        )}
        <div className="admin-list">
          <ListaNoticiasReordenable
            noticias={noticiasOrden}
            onReordenar={setNoticiasOrden}
            renderFila={(n, manija) => (
              <div className="admin-row">
                {manija}
                <div className="admin-row-info">
                  <p className="admin-row-title">{n.titulo}</p>
                </div>
              </div>
            )}
          />
        </div>
      </div>
    </section>
  );
}
