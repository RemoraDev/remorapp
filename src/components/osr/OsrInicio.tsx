import { useEffect, useState } from "react";
import { obtenerHistorialPartidas, obtenerNombresJugadores, obtenerRankingCategoria, obtenerRankingRazas } from "../../lib/osr";
import { CATEGORIAS_OSR } from "../../types/osr";
import type { OsrPartida, OsrRankingFila, OsrRankingRaza } from "../../types/osr";
import OsrTop5Etiquetas from "./OsrTop5Etiquetas";
import { formatFecha } from "../../lib/formatters";

const ETIQUETA_RAZA: Record<string, string> = { terran: "Terran", zerg: "Zerg", protoss: "Protoss" };

interface Props {
  temporadaId: string;
  onNavegar: (seccion: string) => void;
}

// Sección 20 del documento: portada con Papi Dios/Papi por categoría/
// Papi Regador/Padrastro/Mascota (vía OsrTop5Etiquetas en modo
// resumen), Papá/Hijo/Mascota de razas, últimas partidas verificadas,
// y accesos rápidos a los rankings y reglamentos.
export default function OsrInicio({ temporadaId, onNavegar }: Props) {
  const [papiPorCategoria, setPapiPorCategoria] = useState<Record<string, OsrRankingFila | null> | null>(null);
  const [razas, setRazas] = useState<OsrRankingRaza[] | null>(null);
  const [ultimas, setUltimas] = useState<OsrPartida[] | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const porCategoria: Record<string, OsrRankingFila | null> = {};
      await Promise.all(
        CATEGORIAS_OSR.map(async (c) => {
          const filas = await obtenerRankingCategoria(temporadaId, c.value);
          porCategoria[c.value] = filas[0] ?? null;
        })
      );
      const [razasResultado, historial] = await Promise.all([obtenerRankingRazas(temporadaId), obtenerHistorialPartidas(temporadaId)]);
      if (cancelado) return;
      setPapiPorCategoria(porCategoria);
      setRazas(razasResultado);
      const verificadas = historial.filter((p) => p.estado === "verificada" || p.estado === "corregida").slice(0, 5);
      setUltimas(verificadas);
      setNombres(await obtenerNombresJugadores(verificadas.flatMap((p) => [p.ganador_user_id, p.perdedor_user_id])));
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId]);

  const porSuma = razas ? [...razas].sort((a, b) => b.mmr_total - a.mmr_total) : [];
  const papaRaza = porSuma[0];
  const hijoRaza = porSuma[1];
  const mascotaRaza = porSuma.length > 1 ? porSuma[porSuma.length - 1] : null;

  return (
    <>
      <OsrTop5Etiquetas temporadaId={temporadaId} soloResumen />

      <h4 className="osr-section-spacer">Papi de cada categoría</h4>
      {!papiPorCategoria ? (
        <p className="detail-empty">Cargando...</p>
      ) : (
        <div className="osr-resumen-grid">
          {CATEGORIAS_OSR.map((c) => (
            <div key={c.value} className="osr-resumen-card">
              <h4>{c.label}</h4>
              {papiPorCategoria[c.value] ? (
                <strong>{papiPorCategoria[c.value]?.nick ?? "Jugador de RemorApp"}</strong>
              ) : (
                <span className="detail-empty">Sin jugadores</span>
              )}
            </div>
          ))}
        </div>
      )}

      <h4 className="osr-section-spacer">Razas</h4>
      {!razas ? (
        <p className="detail-empty">Cargando...</p>
      ) : razas.length === 0 ? (
        <p className="detail-empty">Sin datos todavía.</p>
      ) : (
        <div className="osr-resumen-grid">
          <div className={`osr-resumen-card osr-raza-${papaRaza?.raza_principal}`}>
            <h4>Papá de todas las razas</h4>
            <strong>{papaRaza ? ETIQUETA_RAZA[papaRaza.raza_principal] : "--"}</strong>
          </div>
          <div className={`osr-resumen-card osr-raza-${hijoRaza?.raza_principal}`}>
            <h4>Hijo de todas las razas</h4>
            <strong>{hijoRaza ? ETIQUETA_RAZA[hijoRaza.raza_principal] : "--"}</strong>
          </div>
          <div className={`osr-resumen-card osr-raza-${mascotaRaza?.raza_principal}`}>
            <h4>Mascota de todas las razas</h4>
            <strong>{mascotaRaza ? ETIQUETA_RAZA[mascotaRaza.raza_principal] : "--"}</strong>
          </div>
        </div>
      )}

      <h4 className="osr-section-spacer">Últimas partidas verificadas</h4>
      {!ultimas ? (
        <p className="detail-empty">Cargando...</p>
      ) : ultimas.length === 0 ? (
        <p className="detail-empty">Todavía no hay partidas verificadas.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ganador</th>
              <th>Perdedor</th>
            </tr>
          </thead>
          <tbody>
            {ultimas.map((p) => (
              <tr key={p.id}>
                <td>{formatFecha(p.fecha)}</td>
                <td>{nombres[p.ganador_user_id] ?? "Jugador de RemorApp"}</td>
                <td>{nombres[p.perdedor_user_id] ?? "Jugador de RemorApp"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="osr-section-spacer">Accesos rápidos</h4>
      <div className="osr-accesos-rapidos">
        <button type="button" className="btn btn-ghost" onClick={() => onNavegar("global")}>
          Ranking Global
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onNavegar("top5")}>
          Top 5 de etiquetas
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onNavegar("paternidades")}>
          Paternidades
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onNavegar("razas")}>
          Ranking de razas
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onNavegar("reglamento_basico")}>
          Reglamento básico
        </button>
      </div>
    </>
  );
}
