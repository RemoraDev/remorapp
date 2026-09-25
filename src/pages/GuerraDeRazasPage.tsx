import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Star, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import RecortadorImagenModal from "../components/RecortadorImagenModal";
import {
  CATEGORIAS_GUERRA,
  RAZAS_GUERRA,
} from "../types/guerraRazas";
import type {
  CategoriaGuerra,
  GuerraRazasJugadorRow,
  GuerraRazasRow,
  RazaGuerra,
} from "../types/guerraRazas";

const IMAGEN_DEFAULT: Record<RazaGuerra, string> = {
  protoss: "/razas/protoss.webp",
  terran: "/razas/terran.webp",
  zerg: "/razas/zerg.webp",
};

const CAMPO_PUNTOS: Record<RazaGuerra, "puntos_protoss" | "puntos_terran" | "puntos_zerg"> = {
  protoss: "puntos_protoss",
  terran: "puntos_terran",
  zerg: "puntos_zerg",
};

const CAMPO_IMAGEN: Record<RazaGuerra, "imagen_protoss_url" | "imagen_terran_url" | "imagen_zerg_url"> = {
  protoss: "imagen_protoss_url",
  terran: "imagen_terran_url",
  zerg: "imagen_zerg_url",
};

// Migración 102: "Guerra de Razas" -- marcador en vivo con temática
// StarCraft II (Protoss/Terran/Zerg), complemento opcional de un
// torneo. El organizador (guerra.creado_por) edita puntaje, imágenes
// de mascota y jugadores destacados; cualquier otra persona con el
// link ve los mismos cambios en vivo por Realtime, sin ningún control
// de edición visible. El propio organizador puede alternar a "Vista
// previa modo lector" para ver exactamente lo que ve el resto.
export default function GuerraDeRazasPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [guerra, setGuerra] = useState<GuerraRazasRow | null>(null);
  const [jugadores, setJugadores] = useState<GuerraRazasJugadorRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState<CategoriaGuerra>("3500");
  const [guardandoPuntos, setGuardandoPuntos] = useState(false);

  const [archivoParaRecortar, setArchivoParaRecortar] = useState<{ raza: RazaGuerra; file: File } | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState<RazaGuerra | null>(null);

  const [nombresNuevos, setNombresNuevos] = useState<Record<RazaGuerra, string>>({
    protoss: "",
    terran: "",
    zerg: "",
  });
  const [agregando, setAgregando] = useState<RazaGuerra | null>(null);

  const cargarDatos = useCallback(async () => {
    if (!id) return;
    const [{ data: guerraData }, { data: jugadoresData }] = await Promise.all([
      supabase.from("guerra_razas").select("*").eq("id", id).maybeSingle(),
      supabase.from("guerra_razas_jugadores").select("*").eq("guerra_id", id).order("creado_en", { ascending: true }),
    ]);
    if (!guerraData) {
      setNotFound(true);
      setCargando(false);
      return;
    }
    setGuerra(guerraData as GuerraRazasRow);
    setJugadores((jugadoresData ?? []) as GuerraRazasJugadorRow[]);
    setCargando(false);
  }, [id]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Realtime (mismo patrón que supabase.channel().on("postgres_changes", ...)
  // -- no había ningún ejemplo vivo en el frontend para copiar, así que
  // se escribe directo contra la API de supabase-js v2): cualquiera con
  // esta página abierta recibe los cambios de puntaje/jugadores sin
  // recargar.
  useEffect(() => {
    if (!guerra) return;
    const channel = supabase
      .channel(`guerra-razas-${guerra.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guerra_razas", filter: `id=eq.${guerra.id}` },
        (payload) => {
          if (payload.eventType === "UPDATE") setGuerra(payload.new as GuerraRazasRow);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guerra_razas_jugadores", filter: `guerra_id=eq.${guerra.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setJugadores((prev) => [...prev, payload.new as GuerraRazasJugadorRow]);
          } else if (payload.eventType === "UPDATE") {
            const actualizado = payload.new as GuerraRazasJugadorRow;
            setJugadores((prev) => prev.map((j) => (j.id === actualizado.id ? actualizado : j)));
          } else if (payload.eventType === "DELETE") {
            const borrado = payload.old as GuerraRazasJugadorRow;
            setJugadores((prev) => prev.filter((j) => j.id !== borrado.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guerra?.id]);

  if (cargando) {
    return (
      <section className="guerra-razas-page">
        <p className="tournament-card-meta">Cargando...</p>
      </section>
    );
  }

  if (notFound || !guerra) {
    return (
      <section className="guerra-razas-page">
        <Link to="/" className="guerra-razas-volver">
          ← Volver a Inicio
        </Link>
        <div className="form-error">No se encontró esta Guerra de Razas.</div>
      </section>
    );
  }

  const esOrganizador = !!user && user.id === guerra.creado_por;
  const modoEdicionActivo = esOrganizador && !vistaPrevia;

  const ranking = (["protoss", "terran", "zerg"] as RazaGuerra[]).slice().sort((a, b) => {
    const diff = guerra[CAMPO_PUNTOS[b]] - guerra[CAMPO_PUNTOS[a]];
    if (diff !== 0) return diff;
    return RAZAS_GUERRA.findIndex((r) => r.value === a) - RAZAS_GUERRA.findIndex((r) => r.value === b);
  });
  const orden: Record<RazaGuerra, number> = {
    [ranking[1]]: 1,
    [ranking[0]]: 2,
    [ranking[2]]: 3,
  } as Record<RazaGuerra, number>;

  // El incremento se calcula DENTRO de la base (RPC atómica), no acá
  // con "valor actual + delta" -- con clics rápidos, el eco de
  // Realtime de una actualización anterior podía llegar y pisar el
  // estado local justo antes de calcular el siguiente clic, perdiendo
  // incrementos (ver migración 102b).
  const ajustarPuntos = async (raza: RazaGuerra, delta: number) => {
    if (!guerra || guardandoPuntos) return;
    setGuardandoPuntos(true);
    const { data, error } = await supabase.rpc("ajustar_puntos_guerra_razas", {
      p_guerra_id: guerra.id,
      p_raza: raza,
      p_delta: delta,
    });
    if (error) toast.error(error.message);
    else setGuerra(data as GuerraRazasRow);
    setGuardandoPuntos(false);
  };

  const handleSeleccionArchivo = (raza: RazaGuerra, file: File | undefined) => {
    if (!file) return;
    setArchivoParaRecortar({ raza, file });
  };

  const handleConfirmarRecorte = async (recorte: Blob) => {
    if (!archivoParaRecortar || !guerra || !user) return;
    const { raza } = archivoParaRecortar;
    setArchivoParaRecortar(null);
    setSubiendoImagen(raza);
    try {
      const extension = recorte.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/${guerra.id}-${raza}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("guerra-razas")
        .upload(ruta, recorte, { contentType: recorte.type });
      if (uploadError) {
        toast.error("No se pudo subir la imagen: " + uploadError.message);
        return;
      }
      const url = supabase.storage.from("guerra-razas").getPublicUrl(ruta).data.publicUrl;
      const campo = CAMPO_IMAGEN[raza];
      const { error: updateError } = await supabase.from("guerra_razas").update({ [campo]: url }).eq("id", guerra.id);
      if (updateError) {
        toast.error(updateError.message);
        return;
      }
      setGuerra((g) => (g ? { ...g, [campo]: url } : g));
      toast.success("Imagen actualizada.");
    } catch {
      toast.error("No se pudo procesar la imagen, prueba con otra.");
    } finally {
      setSubiendoImagen(null);
    }
  };

  const handleAgregarJugador = async (raza: RazaGuerra) => {
    if (!guerra) return;
    const nombre = nombresNuevos[raza].trim();
    if (!nombre) return;
    setAgregando(raza);
    const { error } = await supabase.from("guerra_razas_jugadores").insert({
      guerra_id: guerra.id,
      categoria: categoriaActiva,
      raza,
      nombre,
    });
    setAgregando(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNombresNuevos((prev) => ({ ...prev, [raza]: "" }));
  };

  const handleEliminarJugador = async (jugadorId: string) => {
    const { error } = await supabase.from("guerra_razas_jugadores").delete().eq("id", jugadorId);
    if (error) toast.error(error.message);
  };

  const handleToggleElegido = async (jugador: GuerraRazasJugadorRow) => {
    const { error } = await supabase
      .from("guerra_razas_jugadores")
      .update({ elegido: !jugador.elegido })
      .eq("id", jugador.id);
    if (error) toast.error(error.message);
  };

  return (
    <section className="guerra-razas-page">
      <Link to="/" className="guerra-razas-volver">
        ← Volver a Inicio
      </Link>

      <header className="guerra-razas-header">
        <h1 className="guerra-razas-titulo">Guerra de Razas</h1>
        <div className="guerra-razas-franja" />
      </header>

      <div className="guerra-razas-badge-fila">
        {esOrganizador ? (
          vistaPrevia ? (
            <span className="guerra-razas-badge guerra-razas-badge-lectura">
              Solo lectura — en vivo (vista previa)
              <button type="button" className="guerra-razas-badge-boton" onClick={() => setVistaPrevia(false)}>
                Volver a modo edición
              </button>
            </span>
          ) : (
            <span className="guerra-razas-badge guerra-razas-badge-edicion">
              Modo edición
              <button type="button" className="guerra-razas-badge-boton" onClick={() => setVistaPrevia(true)}>
                Vista previa modo lector
              </button>
            </span>
          )
        ) : (
          <span className="guerra-razas-badge guerra-razas-badge-lectura">Solo lectura — en vivo</span>
        )}
      </div>

      <div className="guerra-razas-podio">
        {RAZAS_GUERRA.map(({ value: raza, label }) => {
          const esPrimero = ranking[0] === raza;
          const imagenUrl = guerra[CAMPO_IMAGEN[raza]] || IMAGEN_DEFAULT[raza];
          return (
            <div
              key={raza}
              className={`guerra-razas-podio-lugar guerra-razas-raza-${raza} ${
                esPrimero ? "guerra-razas-podio-primero" : ""
              }`}
              style={{ order: orden[raza] }}
            >
              <div className="guerra-razas-mascota-wrap">
                {esPrimero && <div className="guerra-razas-anillo-energia" aria-hidden="true" />}
                <img src={imagenUrl} alt={`Mascota ${label}`} className="guerra-razas-mascota-img" />
              </div>
              <p className="guerra-razas-podio-nombre-raza">{label}</p>
              <p className="guerra-razas-puntos">{guerra[CAMPO_PUNTOS[raza]]}</p>

              {modoEdicionActivo && (
                <>
                  <div className="guerra-razas-puntos-control">
                    <button
                      type="button"
                      className="guerra-razas-puntos-btn"
                      disabled={guardandoPuntos}
                      onClick={() => ajustarPuntos(raza, -1)}
                      aria-label={`Restar punto a ${label}`}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="guerra-razas-puntos-btn"
                      disabled={guardandoPuntos}
                      onClick={() => ajustarPuntos(raza, 1)}
                      aria-label={`Sumar punto a ${label}`}
                    >
                      +
                    </button>
                  </div>

                  <label className="guerra-razas-imagen-label">
                    <Upload className="icon-inline" aria-hidden="true" />{" "}
                    {subiendoImagen === raza ? "Subiendo..." : "Cambiar imagen"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: "none" }}
                      disabled={subiendoImagen === raza}
                      onChange={(e) => {
                        handleSeleccionArchivo(raza, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <p className="guerra-razas-imagen-hint">
                    Para mejor resultado, sube una imagen que ya tenga fondo transparente (PNG). No se
                    quita el fondo en forma automática.
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      {archivoParaRecortar && (
        <RecortadorImagenModal
          archivo={archivoParaRecortar.file}
          aspecto={1}
          titulo={`Ajustar mascota de ${RAZAS_GUERRA.find((r) => r.value === archivoParaRecortar.raza)?.label}`}
          onConfirmar={handleConfirmarRecorte}
          onCancelar={() => setArchivoParaRecortar(null)}
        />
      )}

      <div className="guerra-razas-tabs">
        {CATEGORIAS_GUERRA.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`guerra-razas-tab ${categoriaActiva === value ? "selected" : ""}`}
            onClick={() => setCategoriaActiva(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="guerra-razas-columnas">
        {RAZAS_GUERRA.map(({ value: raza, label }) => {
          const jugadoresColumna = jugadores.filter((j) => j.categoria === categoriaActiva && j.raza === raza);
          return (
            <div key={raza} className="guerra-razas-columna">
              <p className="guerra-razas-columna-titulo">{label}</p>

              {jugadoresColumna.length === 0 && !modoEdicionActivo && (
                <p className="detail-empty" style={{ fontSize: "0.75rem" }}>
                  Sin jugadores.
                </p>
              )}

              {jugadoresColumna.map((jugador) => (
                <div
                  key={jugador.id}
                  className={`guerra-razas-jugador-fila ${jugador.elegido ? "guerra-razas-jugador-elegido" : ""}`}
                >
                  <span className="guerra-razas-jugador-nombre">{jugador.nombre}</span>
                  {modoEdicionActivo ? (
                    <span className="guerra-razas-jugador-acciones">
                      <button
                        type="button"
                        className="guerra-razas-jugador-btn"
                        onClick={() => handleToggleElegido(jugador)}
                        aria-label={jugador.elegido ? "Quitar de elegido" : "Marcar como elegido"}
                        title={jugador.elegido ? "Quitar de elegido" : "Marcar como elegido"}
                      >
                        <Star size={14} fill={jugador.elegido ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className="guerra-razas-jugador-btn"
                        onClick={() => handleEliminarJugador(jugador.id)}
                        aria-label="Eliminar jugador"
                        title="Eliminar jugador"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ) : (
                    jugador.elegido && <Star size={14} fill="currentColor" aria-label="Elegido" />
                  )}
                </div>
              ))}

              {modoEdicionActivo && (
                <form
                  className="guerra-razas-agregar-jugador"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAgregarJugador(raza);
                  }}
                >
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Nombre"
                    maxLength={40}
                    value={nombresNuevos[raza]}
                    onChange={(e) => setNombresNuevos((prev) => ({ ...prev, [raza]: e.target.value }))}
                  />
                  <button
                    type="submit"
                    className="guerra-razas-jugador-btn"
                    disabled={agregando === raza || !nombresNuevos[raza].trim()}
                    aria-label="Agregar jugador"
                  >
                    <Plus size={16} />
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
