import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import RecortadorImagenModal from "./RecortadorImagenModal";
import { RAZAS_GUERRA, RESULTADO_BO3_OPTIONS } from "../types/guerraRazas";
import type {
  CategoriaGuerra,
  GuerraRazasEncuentroRow,
  GuerraRazasJugadorRow,
  GuerraRazasRow,
  RazaGuerra,
  ResultadoBo3,
} from "../types/guerraRazas";

const IMAGEN_DEFAULT: Record<RazaGuerra, string> = {
  protoss: "/razas/protoss.webp",
  terran: "/razas/terran.webp",
  zerg: "/razas/zerg.webp",
};

const CAMPO_JUGADOR: Record<RazaGuerra, "jugador_protoss_id" | "jugador_terran_id" | "jugador_zerg_id"> = {
  protoss: "jugador_protoss_id",
  terran: "jugador_terran_id",
  zerg: "jugador_zerg_id",
};

const CAMPO_IMAGEN_ENC: Record<RazaGuerra, "imagen_protoss_url" | "imagen_terran_url" | "imagen_zerg_url"> = {
  protoss: "imagen_protoss_url",
  terran: "imagen_terran_url",
  zerg: "imagen_zerg_url",
};

const CAMPO_PUNTOS: Record<RazaGuerra, "puntos_protoss" | "puntos_terran" | "puntos_zerg"> = {
  protoss: "puntos_protoss",
  terran: "puntos_terran",
  zerg: "puntos_zerg",
};

type Pairing = "protoss_terran" | "terran_zerg" | "protoss_zerg";

const PAIRINGS: { value: Pairing; a: RazaGuerra; b: RazaGuerra; campo: "resultado_protoss_terran" | "resultado_terran_zerg" | "resultado_protoss_zerg" }[] = [
  { value: "protoss_terran", a: "protoss", b: "terran", campo: "resultado_protoss_terran" },
  { value: "terran_zerg", a: "terran", b: "zerg", campo: "resultado_terran_zerg" },
  { value: "protoss_zerg", a: "protoss", b: "zerg", campo: "resultado_protoss_zerg" },
];

interface Props {
  guerra: GuerraRazasRow;
  categoria: CategoriaGuerra;
  jugadores: GuerraRazasJugadorRow[];
  esOrganizador: boolean;
}

// Migración 111: página "Enfrentamiento" -- muestra los 3 jugadores
// elegidos (misma estrella de Marcador) en composición triangular,
// según la posición de podio de su raza, con sus 3 resultados Bo3 y el
// botón de finalizar. Toda la lógica de puntaje (raza + jugador +
// ciclo) vive en la base (generar_encuentro_guerra_razas() /
// finalizar_encuentro_guerra_razas()) -- este componente solo llama a
// esas funciones y refleja lo que Realtime le devuelve.
export default function GuerraRazasEnfrentamiento({ guerra, categoria, jugadores, esOrganizador }: Props) {
  const [encuentro, setEncuentro] = useState<GuerraRazasEncuentroRow | null>(null);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [rehaciendo, setRehaciendo] = useState(false);
  const [guardandoResultado, setGuardandoResultado] = useState<Pairing | null>(null);
  const [archivoParaRecortar, setArchivoParaRecortar] = useState<{ raza: RazaGuerra; file: File } | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState<RazaGuerra | null>(null);

  const cargarEncuentro = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase
      .from("guerra_razas_encuentros")
      .select("*")
      .eq("guerra_id", guerra.id)
      .eq("categoria", categoria)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    setEncuentro((data as GuerraRazasEncuentroRow | null) ?? null);
    setCargando(false);
  }, [guerra.id, categoria]);

  useEffect(() => {
    cargarEncuentro();
  }, [cargarEncuentro]);

  useEffect(() => {
    const channel = supabase
      .channel(`guerra-razas-encuentro-${guerra.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guerra_razas_encuentros", filter: `guerra_id=eq.${guerra.id}` },
        (payload) => {
          const fila = (payload.new ?? payload.old) as GuerraRazasEncuentroRow;
          if (fila.categoria !== categoria || payload.eventType === "DELETE") return;
          setEncuentro((actual) => {
            if (!actual || fila.id === actual.id) return fila;
            return new Date(fila.creado_en) > new Date(actual.creado_en) ? fila : actual;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [guerra.id, categoria]);

  const handleGenerar = async () => {
    setGenerando(true);
    const { error } = await supabase.rpc("generar_encuentro_guerra_razas", {
      p_guerra_id: guerra.id,
      p_categoria: categoria,
    });
    setGenerando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await cargarEncuentro();
  };

  const handleCambiarResultado = async (pairing: Pairing, resultado: ResultadoBo3) => {
    if (!encuentro) return;
    setGuardandoResultado(pairing);
    const { error } = await supabase.rpc("actualizar_resultado_encuentro_guerra_razas", {
      p_encuentro_id: encuentro.id,
      p_pairing: pairing,
      p_resultado: resultado,
    });
    setGuardandoResultado(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEncuentro((prev) => (prev ? { ...prev, [PAIRINGS.find((p) => p.value === pairing)!.campo]: resultado } : prev));
  };

  // Un encuentro sin finalizar queda con sus 3 jugadores fijos desde
  // que se generó -- si el organizador cambia después la estrella de
  // "elegido" en Marcador, este encuentro abierto no se entera solo.
  // "Rehacer" lo borra (todavía no repartió ningún punto) y genera uno
  // nuevo, que sí toma a los jugadores elegidos actuales.
  const handleRehacer = async () => {
    if (!encuentro) return;
    if (
      !window.confirm(
        "¿Rehacer este encuentro con los jugadores elegidos actuales? Se pierden la imagen y los resultados cargados en este encuentro sin finalizar."
      )
    )
      return;
    setRehaciendo(true);
    const { error: errorEliminar } = await supabase.rpc("eliminar_encuentro_guerra_razas", {
      p_encuentro_id: encuentro.id,
    });
    if (errorEliminar) {
      setRehaciendo(false);
      toast.error(errorEliminar.message);
      return;
    }
    const { error: errorGenerar } = await supabase.rpc("generar_encuentro_guerra_razas", {
      p_guerra_id: guerra.id,
      p_categoria: categoria,
    });
    setRehaciendo(false);
    if (errorGenerar) {
      toast.error(errorGenerar.message);
      await cargarEncuentro();
      return;
    }
    toast.success("Encuentro rehecho con los jugadores elegidos actuales.");
    await cargarEncuentro();
  };

  const handleFinalizar = async () => {
    if (!encuentro) return;
    if (!window.confirm("¿Finalizar este encuentro? Los resultados quedarán fijos y se reparten los puntos.")) return;
    setFinalizando(true);
    const { error } = await supabase.rpc("finalizar_encuentro_guerra_razas", { p_encuentro_id: encuentro.id });
    setFinalizando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Encuentro finalizado.");
    await cargarEncuentro();
  };

  const handleSeleccionArchivo = (raza: RazaGuerra, file: File | undefined) => {
    if (!file) return;
    setArchivoParaRecortar({ raza, file });
  };

  const handleConfirmarRecorte = async (recorte: Blob) => {
    if (!archivoParaRecortar || !encuentro) return;
    const { raza } = archivoParaRecortar;
    setArchivoParaRecortar(null);
    setSubiendoImagen(raza);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const extension = recorte.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/encuentro-${encuentro.id}-${raza}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("guerra-razas")
        .upload(ruta, recorte, { contentType: recorte.type });
      if (uploadError) {
        toast.error("No se pudo subir la imagen: " + uploadError.message);
        return;
      }
      const url = supabase.storage.from("guerra-razas").getPublicUrl(ruta).data.publicUrl;
      const { error } = await supabase.rpc("actualizar_imagen_encuentro_guerra_razas", {
        p_encuentro_id: encuentro.id,
        p_raza: raza,
        p_url: url,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setEncuentro((prev) => (prev ? { ...prev, [CAMPO_IMAGEN_ENC[raza]]: url } : prev));
      toast.success("Imagen actualizada.");
    } catch {
      toast.error("No se pudo procesar la imagen, prueba con otra.");
    } finally {
      setSubiendoImagen(null);
    }
  };

  if (cargando) {
    return <p className="tournament-card-meta">Cargando...</p>;
  }

  // Posición de podio de cada raza (mismo criterio que Marcador: más
  // puntos primero, empate resuelto por el orden fijo protoss/terran/zerg).
  const ranking = (["protoss", "terran", "zerg"] as RazaGuerra[])
    .slice()
    .sort((a, b) => {
      const diff = guerra[CAMPO_PUNTOS[b]] - guerra[CAMPO_PUNTOS[a]];
      if (diff !== 0) return diff;
      return RAZAS_GUERRA.findIndex((r) => r.value === a) - RAZAS_GUERRA.findIndex((r) => r.value === b);
    });
  const posicionTriangulo: Record<RazaGuerra, "arriba" | "abajo-izq" | "abajo-der"> = {
    [ranking[0]]: "arriba",
    [ranking[1]]: "abajo-izq",
    [ranking[2]]: "abajo-der",
  } as Record<RazaGuerra, "arriba" | "abajo-izq" | "abajo-der">;

  if (!encuentro) {
    return (
      <div className="guerra-razas-enfrentamiento">
        <p className="detail-empty">Todavía no hay ningún enfrentamiento en esta categoría.</p>
        {esOrganizador && (
          <button type="button" className="btn btn-primary" disabled={generando} onClick={handleGenerar}>
            {generando ? "Generando..." : "Generar encuentro"}
          </button>
        )}
      </div>
    );
  }

  const modoEdicionActivo = esOrganizador && !encuentro.finalizado;

  return (
    <div className="guerra-razas-enfrentamiento">
      <p className="tournament-card-meta">
        Ciclo {encuentro.numero_ciclo} {encuentro.finalizado && "— Finalizado"}
      </p>

      <div className="guerra-razas-triangulo">
        {RAZAS_GUERRA.map(({ value: raza, label }) => {
          const jugadorId = encuentro[CAMPO_JUGADOR[raza]];
          const jugador = jugadores.find((j) => j.id === jugadorId);
          const imagenUrl = encuentro[CAMPO_IMAGEN_ENC[raza]] || IMAGEN_DEFAULT[raza];
          return (
            <div key={raza} className={`guerra-razas-triangulo-nodo guerra-razas-triangulo-${posicionTriangulo[raza]}`}>
              <img src={imagenUrl} alt={`${label}: ${jugador?.nombre ?? "?"}`} className="guerra-razas-triangulo-img" />
              <p className="guerra-razas-podio-nombre-raza">{label}</p>
              <p className="guerra-razas-triangulo-jugador">{jugador?.nombre ?? "Sin jugador"}</p>
              {modoEdicionActivo && (
                <label className="guerra-razas-imagen-label">
                  <Upload className="icon-inline" aria-hidden="true" />{" "}
                  {subiendoImagen === raza ? "Subiendo..." : "Cambiar imagen"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    disabled={subiendoImagen === raza}
                    onChange={(e) => {
                      handleSeleccionArchivo(raza, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {archivoParaRecortar && (
        <RecortadorImagenModal
          archivo={archivoParaRecortar.file}
          aspecto={1}
          titulo={`Ajustar imagen de ${RAZAS_GUERRA.find((r) => r.value === archivoParaRecortar.raza)?.label}`}
          onConfirmar={handleConfirmarRecorte}
          onCancelar={() => setArchivoParaRecortar(null)}
        />
      )}

      <div className="guerra-razas-resultados">
        {PAIRINGS.map((p) => {
          const labelA = RAZAS_GUERRA.find((r) => r.value === p.a)?.label;
          const labelB = RAZAS_GUERRA.find((r) => r.value === p.b)?.label;
          const valorActual = encuentro[p.campo];
          return (
            <div key={p.value} className="guerra-razas-resultado-fila">
              <span className="guerra-razas-resultado-titulo">
                {labelA} vs {labelB}
              </span>
              {modoEdicionActivo ? (
                <select
                  className="form-select"
                  value={valorActual ?? ""}
                  disabled={guardandoResultado === p.value}
                  onChange={(e) => handleCambiarResultado(p.value, e.target.value as ResultadoBo3)}
                >
                  <option value="" disabled>
                    Sin cargar
                  </option>
                  {RESULTADO_BO3_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} ({labelA}-{labelB})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="guerra-razas-resultado-valor">{valorActual ?? "Sin cargar"}</span>
              )}
            </div>
          );
        })}
      </div>

      {modoEdicionActivo && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={
            finalizando ||
            !encuentro.resultado_protoss_terran ||
            !encuentro.resultado_terran_zerg ||
            !encuentro.resultado_protoss_zerg
          }
          onClick={handleFinalizar}
        >
          {finalizando ? "Finalizando..." : "Finalizar encuentro"}
        </button>
      )}

      {modoEdicionActivo && (
        <button
          type="button"
          className="btn btn-ghost btn-block"
          disabled={rehaciendo || finalizando}
          onClick={handleRehacer}
          title="Úsalo si cambiaste la estrella de 'elegido' en Marcador y este encuentro todavía muestra a los jugadores anteriores"
        >
          {rehaciendo ? "Rehaciendo..." : "Rehacer con los jugadores elegidos actuales"}
        </button>
      )}

      {esOrganizador && encuentro.finalizado && (
        <button type="button" className="btn btn-ghost btn-block" disabled={generando} onClick={handleGenerar}>
          {generando ? "Generando..." : "Generar siguiente encuentro"}
        </button>
      )}
    </div>
  );
}
