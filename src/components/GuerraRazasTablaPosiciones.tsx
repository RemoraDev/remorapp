import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { RAZAS_GUERRA } from "../types/guerraRazas";
import type {
  CategoriaGuerra,
  GuerraRazasCicloRow,
  GuerraRazasJugadorRow,
  GuerraRazasPuntosJugadorRow,
} from "../types/guerraRazas";

interface Props {
  guerraId: string;
  categoria: CategoriaGuerra;
  jugadores: GuerraRazasJugadorRow[];
}

// Migración 111: página "Tabla de Posiciones" -- jugadores de esta
// categoría ordenados por sus puntos en un ciclo determinado
// (guerra_razas_puntos_jugador, filtrado por numero_ciclo). Por
// defecto muestra el ciclo en curso; el selector de abajo permite
// consultar cualquier ciclo anterior tal como quedó -- el historial
// nunca se borra ni se sobrescribe, cada ciclo guarda sus propias
// filas de puntos (ver el unique(guerra_id, categoria, jugador_id,
// numero_ciclo) en la migración).
export default function GuerraRazasTablaPosiciones({ guerraId, categoria, jugadores }: Props) {
  const [ciclo, setCiclo] = useState<GuerraRazasCicloRow | null>(null);
  const [ciclosDisponibles, setCiclosDisponibles] = useState<number[]>([]);
  const [cicloVisto, setCicloVisto] = useState<number | null>(null);
  const [puntos, setPuntos] = useState<GuerraRazasPuntosJugadorRow[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargarCiclo = useCallback(async () => {
    const { data: cicloData } = await supabase
      .from("guerra_razas_ciclos")
      .select("*")
      .eq("guerra_id", guerraId)
      .eq("categoria", categoria)
      .maybeSingle();
    const cicloActual = (cicloData as GuerraRazasCicloRow | null) ?? null;
    setCiclo(cicloActual);

    // La lista de ciclos ya jugados se deriva de guerra_razas_encuentros
    // (nunca se borra), sumando siempre el ciclo en curso aunque
    // todavía no tenga ningún encuentro finalizado.
    const { data: encuentrosData } = await supabase
      .from("guerra_razas_encuentros")
      .select("numero_ciclo")
      .eq("guerra_id", guerraId)
      .eq("categoria", categoria);
    const numeros = new Set<number>((encuentrosData ?? []).map((e) => e.numero_ciclo as number));
    if (cicloActual) numeros.add(cicloActual.numero_ciclo_actual);
    setCiclosDisponibles(Array.from(numeros).sort((a, b) => b - a));

    setCicloVisto((actual) => actual ?? cicloActual?.numero_ciclo_actual ?? 1);
  }, [guerraId, categoria]);

  const cargarPuntos = useCallback(
    async (numeroCiclo: number) => {
      setCargando(true);
      const { data: puntosData } = await supabase
        .from("guerra_razas_puntos_jugador")
        .select("*")
        .eq("guerra_id", guerraId)
        .eq("categoria", categoria)
        .eq("numero_ciclo", numeroCiclo)
        .order("puntos", { ascending: false });
      setPuntos((puntosData ?? []) as GuerraRazasPuntosJugadorRow[]);
      setCargando(false);
    },
    [guerraId, categoria]
  );

  useEffect(() => {
    setCicloVisto(null);
    cargarCiclo();
  }, [cargarCiclo]);

  useEffect(() => {
    if (cicloVisto !== null) cargarPuntos(cicloVisto);
  }, [cicloVisto, cargarPuntos]);

  useEffect(() => {
    const channel = supabase
      .channel(`guerra-razas-tabla-${guerraId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guerra_razas_ciclos", filter: `guerra_id=eq.${guerraId}` },
        (payload) => {
          const fila = (payload.new ?? payload.old) as GuerraRazasCicloRow;
          if (fila.categoria === categoria) cargarCiclo();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guerra_razas_puntos_jugador", filter: `guerra_id=eq.${guerraId}` },
        (payload) => {
          const fila = (payload.new ?? payload.old) as GuerraRazasPuntosJugadorRow;
          if (fila.categoria === categoria) {
            cargarCiclo();
            if (cicloVisto !== null && fila.numero_ciclo === cicloVisto) cargarPuntos(cicloVisto);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guerraId, categoria, cicloVisto]);

  const esCicloActual = ciclo !== null && cicloVisto === ciclo.numero_ciclo_actual;

  return (
    <div className="guerra-razas-tabla-posiciones">
      <div className="guerra-razas-tabla-cabecera">
        <p className="tournament-card-meta">
          {esCicloActual ? (
            <>
              Ciclo actual: {ciclo?.numero_ciclo_actual ?? 1}
              {ciclo && ciclo.duracion_ciclo_actual > 0 && (
                <>
                  {" "}
                  — {ciclo.encuentros_jugados_en_ciclo} de {ciclo.duracion_ciclo_actual} encuentros jugados
                </>
              )}
            </>
          ) : (
            <>Viendo el ciclo {cicloVisto} (finalizado)</>
          )}
        </p>

        {ciclosDisponibles.length > 1 && (
          <label className="guerra-razas-tabla-selector">
            Ciclo
            <select
              value={cicloVisto ?? ""}
              onChange={(e) => setCicloVisto(Number(e.target.value))}
            >
              {ciclosDisponibles.map((n) => (
                <option key={n} value={n}>
                  Ciclo {n}
                  {ciclo && n === ciclo.numero_ciclo_actual ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {cargando ? (
        <p className="tournament-card-meta">Cargando...</p>
      ) : puntos.length === 0 ? (
        <p className="detail-empty">Todavía no hay puntos cargados en este ciclo.</p>
      ) : (
        <div className="detail-participant-list">
          {puntos.map((p, indice) => {
            const jugador = jugadores.find((j) => j.id === p.jugador_id);
            const raza = RAZAS_GUERRA.find((r) => r.value === jugador?.raza);
            return (
              <div key={p.id} className="detail-participant-item">
                <span className="guerra-razas-tabla-posicion">{indice + 1}</span>
                {jugador?.nombre ?? "Jugador"}
                {raza && <span className="badge badge-format">{raza.label}</span>}
                <span className="guerra-razas-tabla-puntos">{p.puntos} pts</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
