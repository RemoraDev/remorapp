import { useEffect, useState } from "react";
import { X } from "lucide-react";
import useModalEscapeYFoco from "../../hooks/useModalEscapeYFoco";
import { esModeradorOsr, obtenerTemporadaActiva } from "../../lib/osr";
import type { OsrTemporada } from "../../types/osr";
import type { CategoriaOsr } from "../../types/osr";
import { CATEGORIAS_OSR } from "../../types/osr";
import OsrInicio from "./OsrInicio";
import OsrRankingCategoria from "./OsrRankingCategoria";
import OsrRankingRazas from "./OsrRankingRazas";
import OsrPaternidades from "./OsrPaternidades";
import OsrTop5Etiquetas from "./OsrTop5Etiquetas";
import OsrHistorial from "./OsrHistorial";
import { OsrReglamentoBasico, OsrReglamentoAvanzado } from "./OsrReglamentos";
import OsrPanelModerador from "./OsrPanelModerador";

type SeccionOsr =
  | "inicio"
  | `categoria_${CategoriaOsr}`
  | "global"
  | "top5"
  | "paternidades"
  | "razas"
  | "historial"
  | "reglamento_basico"
  | "reglamento_avanzado"
  | "panel_moderador";

interface Props {
  onClose: () => void;
}

// "¿Quién es tu papi?" -- competencia interna del clan (migración 214).
// Etapa 1: estructura completa + lectura real de todos los datos
// (vacíos hasta que haya partidas verificadas). El registro/
// verificación de partidas desde el Panel de moderador es la etapa 2
// -- ver OsrPanelModerador.tsx.
export default function EventosOsrModal({ onClose }: Props) {
  const [seccion, setSeccion] = useState<SeccionOsr>("inicio");
  const [temporada, setTemporada] = useState<OsrTemporada | null>(null);
  const [cargandoTemporada, setCargandoTemporada] = useState(true);
  const [esModerador, setEsModerador] = useState(false);
  const panelRef = useModalEscapeYFoco(onClose, true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [t, mod] = await Promise.all([obtenerTemporadaActiva(), esModeradorOsr()]);
      if (cancelado) return;
      setTemporada(t);
      setEsModerador(mod);
      setCargandoTemporada(false);
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="team-leader-panel team-leader-panel-propio team-leader-panel-propio-ancho osr-modal"
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        tabIndex={-1}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar Eventos OSR">
          <X size={18} />
        </button>

        <div className="osr-header">
          <h2 className="osr-titulo">¿Quién es tu papi?</h2>
          <p className="osr-subtitulo">Competencia interna de ØLD SCHOOL REBØRN</p>
          {!cargandoTemporada && (
            <p className="osr-temporada-activa">
              {temporada ? `Temporada activa: ${temporada.nombre}` : "Todavía no hay una temporada activa."}
            </p>
          )}
        </div>

        <div className="team-info-tabs osr-tabs">
          <button className={`team-info-subtab ${seccion === "inicio" ? "is-active" : ""}`} onClick={() => setSeccion("inicio")}>
            Inicio
          </button>
          {CATEGORIAS_OSR.map((c) => (
            <button
              key={c.value}
              className={`team-info-subtab ${seccion === `categoria_${c.value}` ? "is-active" : ""}`}
              onClick={() => setSeccion(`categoria_${c.value}`)}
            >
              {c.label}
            </button>
          ))}
          <button className={`team-info-subtab ${seccion === "global" ? "is-active" : ""}`} onClick={() => setSeccion("global")}>
            Global
          </button>
          <button className={`team-info-subtab ${seccion === "top5" ? "is-active" : ""}`} onClick={() => setSeccion("top5")}>
            Top 5 de etiquetas
          </button>
          <button
            className={`team-info-subtab ${seccion === "paternidades" ? "is-active" : ""}`}
            onClick={() => setSeccion("paternidades")}
          >
            Paternidades
          </button>
          <button className={`team-info-subtab ${seccion === "razas" ? "is-active" : ""}`} onClick={() => setSeccion("razas")}>
            Ranking de razas
          </button>
          <button
            className={`team-info-subtab ${seccion === "historial" ? "is-active" : ""}`}
            onClick={() => setSeccion("historial")}
          >
            Historial de partidas
          </button>
          <button
            className={`team-info-subtab ${seccion === "reglamento_basico" ? "is-active" : ""}`}
            onClick={() => setSeccion("reglamento_basico")}
          >
            Reglamento básico
          </button>
          <button
            className={`team-info-subtab ${seccion === "reglamento_avanzado" ? "is-active" : ""}`}
            onClick={() => setSeccion("reglamento_avanzado")}
          >
            Reglamento avanzado
          </button>
          {esModerador && (
            <button
              className={`team-info-subtab ${seccion === "panel_moderador" ? "is-active" : ""}`}
              onClick={() => setSeccion("panel_moderador")}
            >
              Panel de moderador
            </button>
          )}
        </div>

        <div className="osr-contenido" key={seccion}>
          {cargandoTemporada ? (
            <p className="detail-empty">Cargando...</p>
          ) : !temporada ? (
            <p className="detail-empty">
              Todavía no hay una temporada activa de "¿Quién es tu papi?". Cuando un moderador abra la primera
              temporada, acá van a aparecer los jugadores, rankings y títulos.
            </p>
          ) : (
            <>
              {seccion === "inicio" && <OsrInicio temporadaId={temporada.id} onNavegar={(s) => setSeccion(s as SeccionOsr)} />}
              {seccion.startsWith("categoria_") && (
                <OsrRankingCategoria temporadaId={temporada.id} categoria={seccion.replace("categoria_", "") as CategoriaOsr} />
              )}
              {seccion === "global" && <OsrRankingCategoria temporadaId={temporada.id} categoria={null} />}
              {seccion === "top5" && <OsrTop5Etiquetas temporadaId={temporada.id} />}
              {seccion === "paternidades" && <OsrPaternidades temporadaId={temporada.id} />}
              {seccion === "razas" && <OsrRankingRazas temporadaId={temporada.id} />}
              {seccion === "historial" && <OsrHistorial temporadaId={temporada.id} />}
            </>
          )}
          {seccion === "reglamento_basico" && <OsrReglamentoBasico />}
          {seccion === "reglamento_avanzado" && <OsrReglamentoAvanzado />}
          {seccion === "panel_moderador" && esModerador && <OsrPanelModerador temporada={temporada} />}
        </div>
      </div>
    </div>
  );
}
