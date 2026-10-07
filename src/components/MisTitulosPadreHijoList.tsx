import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface TituloFila {
  id: string;
  otroNombre: string;
  status: string;
  ganadorSoyYo: boolean | null;
  createdAt: string;
}

interface MisTitulosPadreHijoListProps {
  userId: string;
  className?: string;
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente de respuesta",
  activo: "Activo",
  expirado: "Expirado",
  rechazado: "Rechazado",
};

// Migración 167, a pedido del usuario: "¿Quién es el padre?" (reto de
// título Padre/Hijo entre jugadores) es un minievento PRIVADO -- lo
// ven solo los dos jugadores involucrados, nunca el público (se
// presta para bullying si es visible para cualquiera). La tabla
// titulos_padre_hijo ya tiene esa restricción a nivel de RLS
// (titulos_padre_hijo_select_propio), así que esta lista se arma con
// un select directo, sin pasar por ninguna RPC pública. Proponer uno
// nuevo o responder uno pendiente sigue viviendo en Mi perfil (Logros
// → Títulos), donde ya funciona -- acá solo se muestra el estado.
export default function MisTitulosPadreHijoList({ userId, className = "" }: MisTitulosPadreHijoListProps) {
  const [titulos, setTitulos] = useState<TituloFila[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data } = await supabase
        .from("titulos_padre_hijo")
        .select("id, retador_id, retado_id, status, ganador_id, created_at")
        .eq("tipo", "jugador")
        .order("created_at", { ascending: false });

      if (cancelado) return;

      const filas = data ?? [];
      const otrosIds = [...new Set(filas.map((f) => (f.retador_id === userId ? f.retado_id : f.retador_id)))];

      let nombrePorId: Record<string, string> = {};
      if (otrosIds.length > 0) {
        const { data: perfiles } = await supabase.from("profiles").select("id, nick, unique_id").in("id", otrosIds);
        nombrePorId = Object.fromEntries(
          (perfiles ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
        );
      }

      if (cancelado) return;

      setTitulos(
        filas.map((f) => {
          const otroId = f.retador_id === userId ? f.retado_id : f.retador_id;
          return {
            id: f.id,
            otroNombre: nombrePorId[otroId] ?? "Jugador de RemorApp",
            status: f.status,
            ganadorSoyYo: f.ganador_id ? f.ganador_id === userId : null,
            createdAt: f.created_at,
          };
        })
      );
      setCargando(false);
    };

    cargar();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (titulos.length === 0) {
    return (
      <p className="detail-empty">
        Todavía no tenés ningún reto de "¿Quién es el padre?". Lo proponés desde Mi perfil → Logros → Títulos.
      </p>
    );
  }

  return (
    <div className={className}>
      {titulos.map((t) => (
        <div key={t.id} className="detail-participant-item">
          vs {t.otroNombre}
          <span className="reto-status">
            {t.status === "activo" && t.ganadorSoyYo !== null
              ? t.ganadorSoyYo
                ? "Sos el Padre"
                : "Sos el Hijo"
              : STATUS_LABEL[t.status] ?? t.status}
          </span>
          <span className="tournament-card-meta"> · {formatFecha(t.createdAt)}</span>
        </div>
      ))}
      <Link to="/perfil?tab=logros" className="btn btn-ghost">
        Proponer / responder en Mi perfil
      </Link>
    </div>
  );
}
