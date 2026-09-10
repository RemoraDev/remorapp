import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, Point } from "react-easy-crop";
import { recortarImagenDesdeArea } from "../lib/imageCrop";

interface RecortadorImagenModalProps {
  archivo: File;
  aspecto: number;
  titulo: string;
  onConfirmar: (recorte: Blob) => void;
  onCancelar: () => void;
}

// Recortador interactivo (avatar de perfil, banner de perfil, logo de
// equipo, banner de equipo): reemplaza el recorte automático centrado
// que existía antes. Se abre apenas el usuario selecciona el archivo,
// antes de subirlo a Supabase Storage -- el arrastre y el zoom son
// solo una vista previa; el recorte final se procesa recién al
// presionar "Confirmar", nunca al seleccionar el archivo.
export default function RecortadorImagenModal({
  archivo,
  aspecto,
  titulo,
  onConfirmar,
  onCancelar,
}: RecortadorImagenModalProps) {
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaRecorte, setAreaRecorte] = useState<Area | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(archivo);
    setImagenUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const handleConfirmar = async () => {
    if (!areaRecorte) return;
    setProcesando(true);
    setError(null);
    try {
      const recorte = await recortarImagenDesdeArea(archivo, areaRecorte);
      onConfirmar(recorte);
    } catch {
      setError("No se pudo procesar la imagen, prueba con otra.");
      setProcesando(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel modal-panel-recorte">
        <button type="button" className="modal-close" onClick={onCancelar} aria-label="Cancelar">
          ✕
        </button>
        <h3 className="modal-title">{titulo}</h3>
        <p className="modal-sub">Arrastra la imagen para ubicarla y usa la barra para acercar o alejar.</p>

        {error && <div className="form-error">{error}</div>}

        <div className="recortador-area">
          {imagenUrl && (
            <Cropper
              image={imagenUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspecto}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, areaPixeles) => setAreaRecorte(areaPixeles)}
            />
          )}
        </div>

        <div className="recortador-zoom">
          <span className="recortador-zoom-label">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom de la imagen"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-block" onClick={onCancelar} disabled={procesando}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleConfirmar}
            disabled={procesando || !areaRecorte}
          >
            {procesando ? "Procesando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
