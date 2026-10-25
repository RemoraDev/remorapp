import { useEffect, useState } from "react";
import { obtenerNombresJugadores, obtenerPaternidadesHistorial, obtenerPaternidadesTemporada } from "../../lib/osr";
import type { OsrParPaternidad } from "../../types/osr";

export default function OsrPaternidades({ temporadaId }: { temporadaId: string }) {
  const [vista, setVista] = useState<"temporada" | "historico">("temporada");
  const [pares, setPares] = useState<OsrParPaternidad[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    (async () => {
      const resultado = vista === "temporada" ? await obtenerPaternidadesTemporada(temporadaId) : await obtenerPaternidadesHistorial();
      if (cancelado) return;
      setPares(resultado);
      const ids = resultado.flatMap((p) => [p.jugador_a, p.jugador_b]);
      setNombres(await obtenerNombresJugadores(ids));
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId, vista]);

  return (
    <>
      <h3 className="section-title">Paternidades</h3>
      <div className="team-info-tabs osr-subtabs-paternidad">
        <button className={`team-info-subtab ${vista === "temporada" ? "is-active" : ""}`} onClick={() => setVista("temporada")}>
          Esta temporada
        </button>
        <button className={`team-info-subtab ${vista === "historico" ? "is-active" : ""}`} onClick={() => setVista("historico")}>
          Histórico (todas las temporadas)
        </button>
      </div>

      {cargando ? (
        <p className="detail-empty">Cargando...</p>
      ) : pares.length === 0 ? (
        <p className="detail-empty">
          Todavía no hay paternidades consolidadas. Se necesitan al menos 3 victorias netas de un jugador sobre otro para que exista
          un papá -- con menos diferencia, la relación queda "disputando paternidad".
        </p>
      ) : (
        <TablaPaternidades pares={pares} nombres={nombres} />
      )}
    </>
  );
}

function TablaPaternidades({ pares, nombres }: { pares: OsrParPaternidad[]; nombres: Record<string, string> }) {
  const consolidadas = pares.filter((p) => p.estado !== "disputando");
  const disputadas = pares.filter((p) => p.estado === "disputando");

  return (
    <>
      <h4>Paternidades consolidadas</h4>
      {consolidadas.length === 0 ? (
        <p className="detail-empty">Todavía ninguna relación llegó a 3 victorias netas de diferencia.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Papá</th>
              <th>Hijo</th>
              <th>Victorias</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {consolidadas.map((p) => {
              const papaId = p.estado === "papa_a" ? p.jugador_a : p.jugador_b;
              const hijoId = p.estado === "papa_a" ? p.jugador_b : p.jugador_a;
              const victoriasPapa = p.estado === "papa_a" ? p.victorias_a : p.victorias_b;
              const victoriasHijo = p.estado === "papa_a" ? p.victorias_b : p.victorias_a;
              return (
                <tr key={`${p.jugador_a}-${p.jugador_b}`}>
                  <td>{nombres[papaId] ?? "Jugador de RemorApp"}</td>
                  <td>{nombres[hijoId] ?? "Jugador de RemorApp"}</td>
                  <td>
                    {victoriasPapa}-{victoriasHijo}
                  </td>
                  <td>+{Math.abs(p.diferencia)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h4 className="osr-section-spacer">Disputando paternidad</h4>
      {disputadas.length === 0 ? (
        <p className="detail-empty">No hay rivalidades en disputa ahora mismo.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Jugador A</th>
              <th>Jugador B</th>
              <th>Victorias</th>
            </tr>
          </thead>
          <tbody>
            {disputadas.map((p) => (
              <tr key={`${p.jugador_a}-${p.jugador_b}`}>
                <td>{nombres[p.jugador_a] ?? "Jugador de RemorApp"}</td>
                <td>{nombres[p.jugador_b] ?? "Jugador de RemorApp"}</td>
                <td>
                  {p.victorias_a}-{p.victorias_b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
