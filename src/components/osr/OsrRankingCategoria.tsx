import { useEffect, useMemo, useState } from "react";
import { Crown, Swords, Users } from "lucide-react";
import { obtenerPaternidadesHistorial, obtenerRankingCategoria, obtenerRankingGlobal } from "../../lib/osr";
import type { CategoriaOsr, OsrParPaternidad, OsrRankingFila } from "../../types/osr";
import { CATEGORIAS_OSR, RAZAS_OSR } from "../../types/osr";
import OsrHijosPadresModal from "./OsrHijosPadresModal";
import OsrPerfilJugadorModal from "./OsrPerfilJugadorModal";

interface Props {
  temporadaId: string;
  // null = ranking Global (todas las categorías juntas).
  categoria: CategoriaOsr | null;
}

const ETIQUETA_RAZA: Record<string, string> = { terran: "Terran", zerg: "Zerg", protoss: "Protoss" };

interface Conteo {
  hijos: number;
  padres: number;
  disputando: number;
}

function contarPaternidades(userId: string, pares: OsrParPaternidad[]): Conteo {
  let hijos = 0;
  let padres = 0;
  let disputando = 0;
  for (const p of pares) {
    const esA = p.jugador_a === userId;
    const esB = p.jugador_b === userId;
    if (!esA && !esB) continue;
    if (p.estado === "disputando") disputando++;
    else if ((p.estado === "papa_a" && esA) || (p.estado === "papa_b" && esB)) hijos++;
    else padres++;
  }
  return { hijos, padres, disputando };
}

export default function OsrRankingCategoria({ temporadaId, categoria }: Props) {
  const [filas, setFilas] = useState<OsrRankingFila[]>([]);
  const [paternidades, setPaternidades] = useState<OsrParPaternidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroRaza, setFiltroRaza] = useState<string>("todas");
  const [filtroTitulo, setFiltroTitulo] = useState<string>("todos");
  const [modal, setModal] = useState<{ userId: string; nick: string; tipo: "hijos" | "padres" } | null>(null);
  const [perfilAbierto, setPerfilAbierto] = useState<{ userId: string; nick: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    (async () => {
      const [resultado, pats] = await Promise.all([
        categoria ? obtenerRankingCategoria(temporadaId, categoria) : obtenerRankingGlobal(temporadaId),
        obtenerPaternidadesHistorial(),
      ]);
      if (!cancelado) {
        setFilas(resultado);
        setPaternidades(pats);
        setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId, categoria]);

  const mmrMaxFiltro = filas[0]?.mmr_evento ?? 0;

  const filasFiltradas = useMemo(() => {
    return filas.filter((f) => {
      if (filtroRaza !== "todas" && f.raza_principal !== filtroRaza) return false;
      if (busqueda.trim() && !(f.nick ?? "").toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
      if (filtroTitulo !== "todos") {
        const conteo = contarPaternidades(f.user_id, paternidades);
        if (filtroTitulo === "papi" && f.mmr_evento !== mmrMaxFiltro) return false;
        if (filtroTitulo === "con_hijos" && conteo.hijos === 0) return false;
        if (filtroTitulo === "disputando" && conteo.disputando === 0) return false;
      }
      return true;
    });
  }, [filas, busqueda, filtroRaza, filtroTitulo, paternidades, mmrMaxFiltro]);

  const titulo = categoria ? `Categoría ${CATEGORIAS_OSR.find((c) => c.value === categoria)?.label}` : "Ranking Global";

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  if (filas.length === 0) {
    return (
      <>
        <h3 className="section-title">{titulo}</h3>
        <p className="detail-empty">
          Todavía no hay jugadores inscriptos {categoria ? "en esta categoría" : "en esta temporada"}. El Papi{" "}
          {categoria ? "de esta categoría" : "Dios"} se va a mostrar acá cuando haya resultados registrados.
        </p>
      </>
    );
  }

  const mmrMax = filas[0]?.mmr_evento ?? 0;

  return (
    <>
      <h3 className="section-title">{titulo}</h3>
      <div className="osr-filtros-ranking">
        <input
          type="text"
          placeholder="Buscar por nick..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select value={filtroRaza} onChange={(e) => setFiltroRaza(e.target.value)}>
          <option value="todas">Todas las razas</option>
          {RAZAS_OSR.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select value={filtroTitulo} onChange={(e) => setFiltroTitulo(e.target.value)}>
          <option value="todos">Todos los títulos</option>
          <option value="papi">Solo el/la Papi</option>
          <option value="con_hijos">Con hijos consolidados</option>
          <option value="disputando">Con paternidades en disputa</option>
        </select>
      </div>
      {filasFiltradas.length === 0 ? (
        <p className="detail-empty">Ningún jugador coincide con la búsqueda.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>Raza</th>
              {categoria === null && <th>Categoría</th>}
              <th>MMR del evento</th>
              <th>
                <Users className="icon-inline" size={14} /> Hijos
              </th>
              <th>
                <Users className="icon-inline" size={14} /> Padres
              </th>
              <th>
                <Swords className="icon-inline" size={14} /> Disputando
              </th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((f) => {
              const conteo = contarPaternidades(f.user_id, paternidades);
              return (
                <tr key={f.jugador_id}>
                  <td>
                    {f.posicion}
                    {f.mmr_evento === mmrMax && (
                      <span className={`osr-insignia-papi ${categoria === null ? "osr-insignia-papi-dios" : ""}`}>
                        <Crown size={12} className="icon-inline" /> {categoria === null ? "Papi Dios" : "Papi"}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setPerfilAbierto({ userId: f.user_id, nick: f.nick ?? "Jugador de RemorApp" })}
                    >
                      {f.nick ?? "Jugador de RemorApp"}
                    </button>
                  </td>
                  <td>
                    <span className={`osr-raza osr-raza-${f.raza_principal}`}>{ETIQUETA_RAZA[f.raza_principal] ?? f.raza_principal}</span>
                  </td>
                  {categoria === null && <td>{CATEGORIAS_OSR.find((c) => c.value === f.categoria)?.label ?? f.categoria}</td>}
                  <td>{f.mmr_evento}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={conteo.hijos === 0}
                      onClick={() => setModal({ userId: f.user_id, nick: f.nick ?? "Jugador de RemorApp", tipo: "hijos" })}
                    >
                      {conteo.hijos}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={conteo.padres === 0}
                      onClick={() => setModal({ userId: f.user_id, nick: f.nick ?? "Jugador de RemorApp", tipo: "padres" })}
                    >
                      {conteo.padres}
                    </button>
                  </td>
                  <td>{conteo.disputando > 0 ? conteo.disputando : "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal && (
        <OsrHijosPadresModal userId={modal.userId} nick={modal.nick} tipo={modal.tipo} onClose={() => setModal(null)} />
      )}
      {perfilAbierto && (
        <OsrPerfilJugadorModal
          userId={perfilAbierto.userId}
          nick={perfilAbierto.nick}
          temporadaId={temporadaId}
          onClose={() => setPerfilAbierto(null)}
        />
      )}
    </>
  );
}
