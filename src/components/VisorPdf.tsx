import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";

// Visor de PDF embebido con PDF.js (Mozilla, Apache-2.0) -- se renderiza
// página por página en un <canvas>, sin redirigir a ningún lector
// externo ni abrir una pestaña nueva. Tanto este componente como
// "pdfjs-dist" en sí se cargan recién cuando alguien abre un PDF
// (ver el import() dinámico dentro de este mismo archivo, y el
// React.lazy() del componente que lo usa) -- nunca en la carga normal
// de la app, que es justo lo que pidió el usuario.
interface VisorPdfProps {
  url: string;
  titulo: string;
  onCerrar: () => void;
}

export default function VisorPdf({ url, titulo, onCerrar }: VisorPdfProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tareaRef = useRef<import("pdfjs-dist").PDFDocumentLoadingTask | null>(null);
  const documentoRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(0);

  // Carga del documento: una sola vez por URL. pdfjs-dist necesita un
  // Worker propio para parsear el PDF fuera del hilo principal -- se
  // apunta al archivo real que Vite ya empaquetó (import ?url), nunca
  // a un CDN externo, para que funcione igual sin conexión a internet
  // y dentro de la app de escritorio (Tauri).
  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const tarea = pdfjs.getDocument({ url });
        tareaRef.current = tarea;
        const documento = await tarea.promise;
        if (cancelado) return;
        documentoRef.current = documento;
        setTotalPaginas(documento.numPages);
        setPaginaActual(1);
      } catch {
        if (!cancelado) setError("No se pudo cargar el reglamento. Intenta de nuevo más tarde.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();

    return () => {
      cancelado = true;
      documentoRef.current = null;
      tareaRef.current?.destroy();
      tareaRef.current = null;
    };
  }, [url]);

  // Render de la página actual -- aparte del efecto de carga, porque
  // cambiar de página no debe volver a descargar ni reparsear el PDF.
  useEffect(() => {
    if (!documentoRef.current || !canvasRef.current) return;
    let cancelado = false;

    (async () => {
      const pagina = await documentoRef.current!.getPage(paginaActual);
      if (cancelado) return;
      const viewport = pagina.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current!;
      const contexto = canvas.getContext("2d");
      if (!contexto) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pagina.render({ canvas, canvasContext: contexto, viewport }).promise;
    })();

    return () => {
      cancelado = true;
    };
  }, [paginaActual, totalPaginas]);

  return (
    <div className="modal-backdrop">
      <div className="modal-panel visor-pdf-panel">
        <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="visor-pdf-header">
          <h3 className="modal-title">{titulo}</h3>
          <a href={url} download className="btn btn-ghost visor-pdf-descargar" title="Descargar PDF">
            <Download size={16} />
          </a>
        </div>

        <div className="visor-pdf-cuerpo">
          {cargando && <p className="tournament-card-meta">Cargando reglamento...</p>}
          {error && <div className="form-error">{error}</div>}
          {!cargando && !error && (
            <>
              <div className="visor-pdf-pagina-wrap">
                <canvas ref={canvasRef} className="visor-pdf-canvas" />
              </div>

              {totalPaginas > 1 && (
                <div className="visor-pdf-navegacion">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={paginaActual <= 1}
                    onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} className="icon-inline" aria-hidden="true" />
                    Anterior
                  </button>
                  <span className="tournament-card-meta">
                    Página {paginaActual} de {totalPaginas}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={paginaActual >= totalPaginas}
                    onClick={() => setPaginaActual((p) => Math.min(totalPaginas, p + 1))}
                  >
                    Siguiente
                    <ChevronRight size={16} className="icon-inline" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
