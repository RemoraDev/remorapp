import { useEffect, useState } from "react";
import { obtenerRankingRazas } from "../../lib/osr";
import type { OsrRankingRaza } from "../../types/osr";

const ETIQUETA_RAZA: Record<string, string> = { terran: "Terran", zerg: "Zerg", protoss: "Protoss" };

export default function OsrRankingRazas({ temporadaId }: { temporadaId: string }) {
  const [filas, setFilas] = useState<OsrRankingRaza[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const resultado = await obtenerRankingRazas(temporadaId);
      if (!cancelado) {
        setFilas(resultado);
        setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId]);

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  if (filas.length === 0) {
    return <p className="detail-empty">Todavía no hay jugadores inscriptos -- el ranking de razas se arma cuando haya datos.</p>;
  }

  // Orden fijo Terran/Zerg/Protoss para que el panel no "salte" de
  // lugar según quién gana -- el orden del RANKING (quién es Papá,
  // Hijo, Mascota) se calcula aparte, por mmr_total.
  const ordenFijo = ["terran", "zerg", "protoss"];
  const porSuma = [...filas].sort((a, b) => b.mmr_total - a.mmr_total);
  const etiquetaPorRaza: Record<string, string> = {};
  if (porSuma[0]) etiquetaPorRaza[porSuma[0].raza_principal] = "Papá de todas las razas";
  if (porSuma[1]) etiquetaPorRaza[porSuma[1].raza_principal] = "Hijo de todas las razas";
  if (porSuma[porSuma.length - 1] && porSuma.length > 1) {
    etiquetaPorRaza[porSuma[porSuma.length - 1].raza_principal] = "Mascota de todas las razas";
  }
  const sumaLider = porSuma[0]?.mmr_total ?? 0;

  return (
    <>
      <h3 className="section-title">Ranking de razas</h3>
      <div className="osr-razas-grid">
        {ordenFijo
          .map((raza) => filas.find((f) => f.raza_principal === raza))
          .filter((f): f is OsrRankingRaza => !!f)
          .map((f) => (
            <div key={f.raza_principal} className={`osr-raza-card osr-raza-${f.raza_principal}`}>
              <h4>{ETIQUETA_RAZA[f.raza_principal] ?? f.raza_principal}</h4>
              {etiquetaPorRaza[f.raza_principal] && <span className="osr-insignia-papi">{etiquetaPorRaza[f.raza_principal]}</span>}
              <p className="osr-raza-stat">
                <strong>{f.mmr_total}</strong> MMR total
              </p>
              <p className="osr-raza-stat-sec">{f.jugadores} jugadores · promedio {f.mmr_promedio}</p>
              <p className="osr-raza-stat-sec">Diferencia con el líder: {sumaLider - f.mmr_total}</p>
            </div>
          ))}
      </div>
    </>
  );
}
