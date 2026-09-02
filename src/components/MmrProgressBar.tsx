import { calcularProgresoLiga } from "../lib/ligas";

interface MmrProgressBarProps {
  mmr: number;
  liga: string;
  bancaRota: boolean;
  className?: string;
}

// Barra de progreso de MMR hacia la siguiente liga (migración 020 --
// se calcula entero en el cliente, con la misma tabla de rangos que
// calcular_liga() en la base, ver lib/ligas.ts). Tres estados
// posibles: banca rota (barra de advertencia, no se puede subir),
// Gran Maestro (barra llena, liga sin techo) y el caso normal
// (progreso real dentro del tramo actual).
export default function MmrProgressBar({ mmr, liga, bancaRota, className = "" }: MmrProgressBarProps) {
  if (bancaRota) {
    return (
      <div className={`mmr-progress ${className}`}>
        <div className="mmr-progress-track">
          <div className="mmr-progress-fill mmr-progress-fill-banca-rota" style={{ width: "100%" }} />
        </div>
        <p className="mmr-progress-texto mmr-progress-texto-banca-rota">
          Banca Rota — {mmr} MMR. No puede subir de liga hasta recuperarse.
        </p>
      </div>
    );
  }

  if (liga === "Gran Maestro") {
    return (
      <div className={`mmr-progress ${className}`}>
        <div className="mmr-progress-track">
          <div className="mmr-progress-fill" style={{ width: "100%" }} />
        </div>
        <p className="mmr-progress-texto">Gran Maestro — liga máxima alcanzada ({mmr} MMR).</p>
      </div>
    );
  }

  const progreso = calcularProgresoLiga(mmr, liga);

  return (
    <div className={`mmr-progress ${className}`}>
      <div className="mmr-progress-track">
        <div className="mmr-progress-fill" style={{ width: `${progreso.porcentaje}%` }} />
      </div>
      <p className="mmr-progress-texto">
        {mmr} / {progreso.maximo} MMR — {progreso.faltante} MMR para {progreso.siguienteLiga}
      </p>
    </div>
  );
}
