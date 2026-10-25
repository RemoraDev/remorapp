import { useEffect, useMemo, useState } from "react";
import {
  obtenerHistorialPartidasTodas,
  obtenerNombresJugadores,
  obtenerRazaPorJugadorId,
  obtenerTodasLasTemporadas,
} from "../../lib/osr";
import type { OsrPartida, OsrTemporada } from "../../types/osr";
import { CATEGORIAS_OSR, RAZAS_OSR } from "../../types/osr";
import { formatFecha } from "../../lib/formatters";
import OsrPerfilJugadorModal from "./OsrPerfilJugadorModal";

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendiente",
  verificada: "Verificada",
  rechazada: "Rechazada",
  corregida: "Corregida",
};

// Sección 14 del documento: filtros por Jugador, Rival, categoría,
// raza principal, fecha, Resultado, temporada y estado de
// verificación -- cruza TODAS las temporadas (el filtro de temporada
// elige una puntual, "todas" por defecto).
export default function OsrHistorial({ temporadaId }: { temporadaId: string }) {
  const [partidas, setPartidas] = useState<OsrPartida[]>([]);
  const [temporadas, setTemporadas] = useState<OsrTemporada[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [razas, setRazas] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [perfilAbierto, setPerfilAbierto] = useState<{ userId: string; nick: string } | null>(null);

  const [filtroJugador, setFiltroJugador] = useState("");
  const [filtroRival, setFiltroRival] = useState("");
  const [filtroResultado, setFiltroResultado] = useState<"todos" | "victoria" | "derrota">("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [filtroRaza, setFiltroRaza] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("todas");
  const [filtroTemporada, setFiltroTemporada] = useState("todas");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [resultado, temps] = await Promise.all([obtenerHistorialPartidasTodas(), obtenerTodasLasTemporadas()]);
      if (cancelado) return;
      setPartidas(resultado);
      setTemporadas(temps);
      setFiltroTemporada(temporadaId);
      const [nombresMap, razasMap] = await Promise.all([
        obtenerNombresJugadores(resultado.flatMap((p) => [p.ganador_user_id, p.perdedor_user_id])),
        obtenerRazaPorJugadorId(resultado.flatMap((p) => [p.jugador_ganador_id, p.jugador_perdedor_id])),
      ]);
      if (!cancelado) {
        setNombres(nombresMap);
        setRazas(razasMap);
        setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [temporadaId]);

  const filtradas = useMemo(() => {
    const jugadorTexto = filtroJugador.trim().toLowerCase();
    const rivalTexto = filtroRival.trim().toLowerCase();
    const desde = filtroDesde ? new Date(filtroDesde).getTime() : null;
    const hasta = filtroHasta ? new Date(filtroHasta).getTime() + 24 * 60 * 60 * 1000 : null;
    return partidas.filter((p) => {
      if (filtroTemporada !== "todas" && p.temporada_id !== filtroTemporada) return false;
      if (filtroEstado !== "todas" && p.estado !== filtroEstado) return false;
      if (filtroCategoria !== "todas" && p.categoria_ganador !== filtroCategoria && p.categoria_perdedor !== filtroCategoria) return false;
      if (filtroRaza !== "todas") {
        const razaGanador = razas[p.jugador_ganador_id];
        const razaPerdedor = razas[p.jugador_perdedor_id];
        if (razaGanador !== filtroRaza && razaPerdedor !== filtroRaza) return false;
      }

      const nombreGanador = (nombres[p.ganador_user_id] ?? "").toLowerCase();
      const nombrePerdedor = (nombres[p.perdedor_user_id] ?? "").toLowerCase();

      if (jugadorTexto && rivalTexto) {
        const directo = nombreGanador.includes(jugadorTexto) && nombrePerdedor.includes(rivalTexto);
        const inverso = nombrePerdedor.includes(jugadorTexto) && nombreGanador.includes(rivalTexto);
        if (!directo && !inverso) return false;
        if (filtroResultado === "victoria" && !nombreGanador.includes(jugadorTexto)) return false;
        if (filtroResultado === "derrota" && !nombrePerdedor.includes(jugadorTexto)) return false;
      } else if (jugadorTexto) {
        if (filtroResultado === "victoria" && !nombreGanador.includes(jugadorTexto)) return false;
        else if (filtroResultado === "derrota" && !nombrePerdedor.includes(jugadorTexto)) return false;
        else if (filtroResultado === "todos" && !nombreGanador.includes(jugadorTexto) && !nombrePerdedor.includes(jugadorTexto)) return false;
      } else if (rivalTexto) {
        if (!nombreGanador.includes(rivalTexto) && !nombrePerdedor.includes(rivalTexto)) return false;
      }

      const fechaMs = new Date(p.fecha).getTime();
      if (desde !== null && fechaMs < desde) return false;
      if (hasta !== null && fechaMs > hasta) return false;
      return true;
    });
  }, [
    partidas,
    filtroTemporada,
    filtroEstado,
    filtroCategoria,
    filtroRaza,
    filtroJugador,
    filtroRival,
    filtroResultado,
    filtroDesde,
    filtroHasta,
    nombres,
    razas,
  ]);

  if (cargando) return <p className="detail-empty">Cargando...</p>;

  return (
    <>
      <h3 className="section-title">Historial de partidas</h3>
      <div className="osr-filtros-historial">
        <input type="text" placeholder="Jugador..." value={filtroJugador} onChange={(e) => setFiltroJugador(e.target.value)} />
        <input type="text" placeholder="Rival..." value={filtroRival} onChange={(e) => setFiltroRival(e.target.value)} />
        <select
          value={filtroResultado}
          onChange={(e) => setFiltroResultado(e.target.value as "todos" | "victoria" | "derrota")}
          disabled={!filtroJugador.trim()}
          title={!filtroJugador.trim() ? "Completá 'Jugador' para filtrar por resultado" : undefined}
        >
          <option value="todos">Cualquier resultado</option>
          <option value="victoria">Victorias del jugador</option>
          <option value="derrota">Derrotas del jugador</option>
        </select>
        <select value={filtroTemporada} onChange={(e) => setFiltroTemporada(e.target.value)}>
          <option value="todas">Todas las temporadas</option>
          {temporadas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="todas">Todas las categorías</option>
          {CATEGORIAS_OSR.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={filtroRaza} onChange={(e) => setFiltroRaza(e.target.value)}>
          <option value="todas">Todas las razas</option>
          {RAZAS_OSR.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todas">Todos los estados</option>
          <option value="verificada">Verificada</option>
          <option value="corregida">Corregida</option>
          <option value="pendiente">Pendiente</option>
          <option value="rechazada">Rechazada</option>
        </select>
        <label className="osr-filtro-fecha">
          Desde
          <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
        </label>
        <label className="osr-filtro-fecha">
          Hasta
          <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
        </label>
      </div>

      {filtradas.length === 0 ? (
        <p className="detail-empty">Ninguna partida coincide con los filtros.</p>
      ) : (
        <table className="group-standings-table ranking-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ganador</th>
              <th>Perdedor</th>
              <th>Puntos</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((p) => (
              <tr key={p.id}>
                <td>{formatFecha(p.fecha)}</td>
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setPerfilAbierto({ userId: p.ganador_user_id, nick: nombres[p.ganador_user_id] ?? "Jugador de RemorApp" })}
                  >
                    {nombres[p.ganador_user_id] ?? "Jugador de RemorApp"}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setPerfilAbierto({ userId: p.perdedor_user_id, nick: nombres[p.perdedor_user_id] ?? "Jugador de RemorApp" })}
                  >
                    {nombres[p.perdedor_user_id] ?? "Jugador de RemorApp"}
                  </button>
                </td>
                <td>
                  {p.estado === "verificada" || p.estado === "corregida" ? (
                    <>
                      +{p.puntos_ganador} / {p.puntos_perdedor}
                    </>
                  ) : (
                    "--"
                  )}
                </td>
                <td>
                  <span className={`osr-estado-partida osr-estado-${p.estado}`}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
