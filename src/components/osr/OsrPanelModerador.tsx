import { useEffect, useState } from "react";
import { obtenerTemporadaActiva } from "../../lib/osr";
import type { OsrTemporada } from "../../types/osr";
import OsrModPendientes from "./moderador/OsrModPendientes";
import OsrModRegistrar from "./moderador/OsrModRegistrar";
import OsrModJugadores from "./moderador/OsrModJugadores";
import OsrModCorregir from "./moderador/OsrModCorregir";
import OsrModTemporadaYModeradores from "./moderador/OsrModTemporadaYModeradores";
import OsrModAuditoriaYEstadisticas from "./moderador/OsrModAuditoriaYEstadisticas";

type SubtabModerador = "pendientes" | "registrar" | "jugadores" | "corregir" | "auditoria" | "temporada";

interface Props {
  temporada: OsrTemporada | null;
}

// Etapa 2: panel de moderador completo -- registrar/verificar/
// corregir/eliminar partidas, inscribir jugadores, abrir temporadas y
// administrar moderadores. Mantiene su propia copia de "temporada"
// (inicializada con la del padre) para poder refrescarla después de
// abrir una nueva, sin depender de que el padre vuelva a consultarla.
export default function OsrPanelModerador({ temporada: temporadaInicial }: Props) {
  const [temporada, setTemporada] = useState(temporadaInicial);
  const [subtab, setSubtab] = useState<SubtabModerador>(temporadaInicial ? "pendientes" : "temporada");

  async function refrescarTemporada() {
    const t = await obtenerTemporadaActiva();
    setTemporada(t);
    setSubtab("pendientes");
  }

  useEffect(() => {
    if (!temporada) setSubtab("temporada");
  }, [temporada]);

  return (
    <div className="osr-panel-moderador">
      <h3 className="section-title">Panel de moderador</h3>

      <div className="team-info-tabs osr-tabs">
        <button className={`team-info-subtab ${subtab === "pendientes" ? "is-active" : ""}`} disabled={!temporada} onClick={() => setSubtab("pendientes")}>
          Pendientes
        </button>
        <button className={`team-info-subtab ${subtab === "registrar" ? "is-active" : ""}`} disabled={!temporada} onClick={() => setSubtab("registrar")}>
          Registrar partida
        </button>
        <button className={`team-info-subtab ${subtab === "jugadores" ? "is-active" : ""}`} disabled={!temporada} onClick={() => setSubtab("jugadores")}>
          Jugadores
        </button>
        <button className={`team-info-subtab ${subtab === "corregir" ? "is-active" : ""}`} disabled={!temporada} onClick={() => setSubtab("corregir")}>
          Corregir / eliminar
        </button>
        <button className={`team-info-subtab ${subtab === "auditoria" ? "is-active" : ""}`} disabled={!temporada} onClick={() => setSubtab("auditoria")}>
          Auditoría y estadísticas
        </button>
        <button className={`team-info-subtab ${subtab === "temporada" ? "is-active" : ""}`} onClick={() => setSubtab("temporada")}>
          Temporada y moderadores
        </button>
      </div>

      {!temporada && subtab !== "temporada" ? (
        <p className="detail-empty">Primero hay que abrir una temporada, en la pestaña "Temporada y moderadores".</p>
      ) : (
        <>
          {temporada && subtab === "pendientes" && <OsrModPendientes temporadaId={temporada.id} />}
          {temporada && subtab === "registrar" && (
            <OsrModRegistrar temporadaId={temporada.id} onRegistrada={() => setSubtab("pendientes")} />
          )}
          {temporada && subtab === "jugadores" && <OsrModJugadores temporadaId={temporada.id} />}
          {temporada && subtab === "corregir" && <OsrModCorregir temporadaId={temporada.id} />}
          {temporada && subtab === "auditoria" && <OsrModAuditoriaYEstadisticas temporadaId={temporada.id} />}
          {subtab === "temporada" && (
            <OsrModTemporadaYModeradores temporada={temporada} onTemporadaAbierta={refrescarTemporada} />
          )}
        </>
      )}
    </div>
  );
}
