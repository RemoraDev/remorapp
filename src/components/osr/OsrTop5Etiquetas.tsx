import { useEffect, useState, type ReactNode } from "react";
import { Crown } from "lucide-react";
import { obtenerTop5Mascota, obtenerTop5PapiDios, obtenerTop5PapiRegador, obtenerTop5Padrastro, obtenerNombresJugadores } from "../../lib/osr";
import type { OsrTop5Mascota, OsrTop5PapiDios, OsrTop5PapiRegador, OsrTop5Padrastro } from "../../types/osr";

interface Props {
  temporadaId: string;
  // Usado desde "Inicio": solo muestra al líder de cada etiqueta, sin
  // tabla completa.
  soloResumen?: boolean;
}

interface Datos {
  papiDios: OsrTop5PapiDios[];
  papiRegador: OsrTop5PapiRegador[];
  padrastro: OsrTop5Padrastro[];
  mascota: OsrTop5Mascota[];
  nombres: Record<string, string>;
}

export default function OsrTop5Etiquetas({ temporadaId, soloResumen }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [papiDios, papiRegador, padrastro, mascota] = await Promise.all([
        obtenerTop5PapiDios(temporadaId),
        obtenerTop5PapiRegador(temporadaId),
        obtenerTop5Padrastro(temporadaId),
        obtenerTop5Mascota(temporadaId),
      ]);
      if (cancelado) return;
      const ids = [
        ...papiDios.map((f) => f.user_id),
        ...papiRegador.map((f) => f.user_id),
        ...padrastro.flatMap((f) => [f.candidato_user_id, f.rival_user_id]),
        ...mascota.map((f) => f.user_id),
      ];
      const nombres = await obtenerNombresJugadores(ids);
      if (!cancelado) setDatos({ papiDios, papiRegador, padrastro, mascota, nombres });
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId]);

  if (!datos) return <p className="detail-empty">Cargando...</p>;

  const nombreDe = (id: string) => datos.nombres[id] ?? "Jugador de RemorApp";

  if (soloResumen) {
    return (
      <div className="osr-resumen-grid">
        <ResumenEtiqueta titulo="Papi Dios" vacio="Sin datos todavía">
          {datos.papiDios[0] && <strong>{datos.papiDios[0].nick ?? nombreDe(datos.papiDios[0].user_id)}</strong>}
        </ResumenEtiqueta>
        <ResumenEtiqueta titulo="Papi Regador" vacio="Sin datos todavía">
          {datos.papiRegador[0] && <strong>{datos.papiRegador[0].nick ?? nombreDe(datos.papiRegador[0].user_id)}</strong>}
        </ResumenEtiqueta>
        <ResumenEtiqueta titulo="Padrastro" vacio="Nadie cumple el requisito todavía">
          {datos.padrastro[0] && <strong>{nombreDe(datos.padrastro[0].candidato_user_id)}</strong>}
        </ResumenEtiqueta>
        <ResumenEtiqueta titulo="Mascota del Clan" vacio="Sin datos todavía">
          {datos.mascota[0] && <strong>{datos.mascota[0].nick ?? nombreDe(datos.mascota[0].user_id)}</strong>}
        </ResumenEtiqueta>
      </div>
    );
  }

  return (
    <>
      <h3 className="section-title">Top 5 Papi Dios</h3>
      {datos.papiDios.length === 0 ? (
        <p className="detail-empty">Sin datos todavía.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>MMR del evento</th>
              <th>Diferencia con el líder</th>
            </tr>
          </thead>
          <tbody>
            {datos.papiDios.map((f) => (
              <tr key={f.user_id}>
                <td>{f.posicion}</td>
                <td>
                  {f.nick ?? "Jugador de RemorApp"}
                  {f.posicion === 1 && <span className="osr-insignia-papi osr-insignia-papi-dios"><Crown size={12} className="icon-inline" /> Papi Dios</span>}
                </td>
                <td>{f.mmr_evento}</td>
                <td>{f.diferencia_con_lider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="section-title osr-section-spacer">Top 5 Papi Regador</h3>
      {datos.papiRegador.length === 0 ? (
        <p className="detail-empty">Todavía nadie tiene hijos consolidados.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>Hijos</th>
              <th>Padres</th>
              <th>MMR del evento</th>
            </tr>
          </thead>
          <tbody>
            {datos.papiRegador.map((f) => (
              <tr key={f.user_id}>
                <td>{f.posicion}</td>
                <td>
                  {f.nick ?? "Jugador de RemorApp"}
                  {f.posicion === 1 && <span className="osr-insignia-papi"><Crown size={12} className="icon-inline" /> Papi Regador</span>}
                </td>
                <td>{f.hijos}</td>
                <td>{f.padres}</td>
                <td>{f.mmr_evento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="section-title osr-section-spacer">Top 5 Padrastro</h3>
      {datos.padrastro.length === 0 ? (
        <p className="detail-empty">Nadie tiene todavía una ventaja de 10 victorias o más sobre un mismo rival.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Candidato</th>
              <th>Rival</th>
              <th>Victorias</th>
              <th>Diferencia</th>
              <th>MMR del evento</th>
            </tr>
          </thead>
          <tbody>
            {datos.padrastro.map((f, i) => (
              <tr key={`${f.candidato_user_id}-${f.rival_user_id}`}>
                <td>{f.posicion}</td>
                <td>
                  {nombreDe(f.candidato_user_id)}
                  {i === 0 && <span className="osr-insignia-papi"><Crown size={12} className="icon-inline" /> Padrastro</span>}
                </td>
                <td>{nombreDe(f.rival_user_id)}</td>
                <td>
                  {f.victorias_candidato}-{f.victorias_rival}
                </td>
                <td>+{f.diferencia}</td>
                <td>{f.mmr_evento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="section-title osr-section-spacer">Top 5 Mascota del Clan</h3>
      {datos.mascota.length === 0 ? (
        <p className="detail-empty">Sin datos todavía.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>MMR del evento</th>
              <th>Padres</th>
              <th>Hijos</th>
            </tr>
          </thead>
          <tbody>
            {datos.mascota.map((f) => (
              <tr key={f.user_id}>
                <td>{f.posicion}</td>
                <td>
                  {f.nick ?? "Jugador de RemorApp"}
                  {f.posicion === 1 && <span className="osr-insignia-papi"><Crown size={12} className="icon-inline" /> Mascota del Clan</span>}
                </td>
                <td>{f.mmr_evento}</td>
                <td>{f.padres}</td>
                <td>{f.hijos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ResumenEtiqueta({ titulo, vacio, children }: { titulo: string; vacio: string; children?: ReactNode }) {
  return (
    <div className="osr-resumen-card">
      <h4>{titulo}</h4>
      {children ?? <span className="detail-empty">{vacio}</span>}
    </div>
  );
}
