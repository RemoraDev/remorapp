import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface Conteos {
  usuarios: number;
  torneosActivos: number;
  torneosFinalizados: number;
}

// Cuenta hacia arriba desde 0 hasta valorFinal, una sola vez (no en
// bucle) -- puro requestAnimationFrame, sin librerías. Respeta
// prefers-reduced-motion mostrando el número final directo, sin
// animar. "activo" espera a que el conteo real ya haya llegado, para
// no animar hacia un 0 que todavía no es el valor real.
function useContadorAnimado(valorFinal: number, activo: boolean): number {
  const [valor, setValor] = useState(0);

  useEffect(() => {
    if (!activo) return;

    const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefiereMenosMovimiento || valorFinal === 0) {
      setValor(valorFinal);
      return;
    }

    const duracionMs = 900;
    const inicio = performance.now();
    let idFrame: number;

    const tick = (ahora: number) => {
      const progreso = Math.min(1, (ahora - inicio) / duracionMs);
      setValor(Math.round(valorFinal * progreso));
      if (progreso < 1) {
        idFrame = requestAnimationFrame(tick);
      }
    };

    idFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(idFrame);
  }, [valorFinal, activo]);

  return valor;
}

// Barra de estadísticas de Inicio: tres conteos simples, consultados
// una sola vez al cargar la página -- a propósito, sin ningún sistema
// de presencia en tiempo real, para mantenerlo liviano.
export default function StatsBar() {
  const [conteos, setConteos] = useState<Conteos | null>(null);

  useEffect(() => {
    (async () => {
      // profiles solo tiene grant de SELECT por lista explícita de
      // columnas (nunca la tabla completa, ver migración 017) -- pedir
      // "*" ahí falla la expansión de Postgres (necesita permiso sobre
      // TODAS las columnas para expandir el asterisco) y el conteo
      // vuelve null en vez de tirar un error visible. "id" sí está
      // en la lista, así que alcanza para contar filas.
      const [usuariosRes, activosRes, finalizadosRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("tournaments")
          .select("*", { count: "exact", head: true })
          .in("estado", ["abierto", "en_curso"]),
        supabase.from("tournaments").select("*", { count: "exact", head: true }).eq("estado", "finalizado"),
      ]);

      setConteos({
        usuarios: usuariosRes.count ?? 0,
        torneosActivos: activosRes.count ?? 0,
        torneosFinalizados: finalizadosRes.count ?? 0,
      });
    })();
  }, []);

  const cargado = conteos !== null;
  const usuariosAnimado = useContadorAnimado(conteos?.usuarios ?? 0, cargado);
  const activosAnimado = useContadorAnimado(conteos?.torneosActivos ?? 0, cargado);
  const finalizadosAnimado = useContadorAnimado(conteos?.torneosFinalizados ?? 0, cargado);

  return (
    <div className="stats-bar">
      <div className="stats-bar-item">
        <span className="stats-bar-number">{usuariosAnimado}</span>
        <span className="stats-bar-label">Usuarios registrados</span>
      </div>
      <div className="stats-bar-item">
        <span className="stats-bar-number">{activosAnimado}</span>
        <span className="stats-bar-label">Torneos activos</span>
      </div>
      <div className="stats-bar-item">
        <span className="stats-bar-number">{finalizadosAnimado}</span>
        <span className="stats-bar-label">Torneos finalizados</span>
      </div>
    </div>
  );
}
