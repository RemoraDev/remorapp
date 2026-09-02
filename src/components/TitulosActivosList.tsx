import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { diasRestantes } from "../types/titulos";
import type { TituloActivo, TituloTipo } from "../types/titulos";

interface TitulosActivosListProps {
  tipo: TituloTipo;
  id: string;
  className?: string;
}

// Títulos Padre/Hijo activos de un equipo o jugador puntual (migración
// 026) -- se acumulan, no se reemplazan: un mismo equipo puede ser
// "Padre de X" e "Hijo de Y" al mismo tiempo. Información pública,
// via titulos_activos_de() (RPC sin restricción de participante).
export default function TitulosActivosList({ tipo, id, className = "" }: TitulosActivosListProps) {
  const [titulos, setTitulos] = useState<{ id: string; texto: string }[]>([]);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      const { data } = await supabase.rpc("titulos_activos_de", { p_tipo: tipo, p_id: id });
      const filas = (data ?? []) as TituloActivo[];

      if (filas.length === 0) {
        if (!cancelado) setTitulos([]);
        return;
      }

      const otroIds = [...new Set(filas.map((f) => f.otro_id))];
      let nombrePorId: Record<string, string> = {};

      if (tipo === "clan") {
        const { data: equipos } = await supabase.from("teams").select("id, tag").in("id", otroIds);
        nombrePorId = Object.fromEntries((equipos ?? []).map((t) => [t.id, t.tag]));
      } else {
        const { data: perfiles } = await supabase.from("profiles").select("id, nick, unique_id").in("id", otroIds);
        nombrePorId = Object.fromEntries(
          (perfiles ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
        );
      }

      if (!cancelado) {
        setTitulos(
          filas.map((f) => ({
            id: f.id,
            texto: `${f.soy_padre ? "Padre" : "Hijo"} de ${nombrePorId[f.otro_id] ?? "?"} (${diasRestantes(
              f.fecha_fin
            )} días)`,
          }))
        );
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [tipo, id]);

  if (titulos.length === 0) return null;

  return (
    <div className={className}>
      {titulos.map((t) => (
        <span key={t.id} className="liga-badge">
          {t.texto}
        </span>
      ))}
    </div>
  );
}
