import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface MiniEventoClan {
  id: string;
  tournamentId: string;
  nombre: string;
  creadoEn: string;
  estado: string;
}

interface MiniEventosClanListProps {
  teamId: string;
  className?: string;
  // Migración 165: la sub-pestaña "Finalizados" de Historial solo
  // quiere las Race War ya terminadas -- "Minieventos" sigue siendo
  // el catálogo completo, sin este filtro.
  soloFinalizadas?: boolean;
}

// Migración 166, ítem 10: Race Wars creadas por este equipo, en su
// propia pestaña dentro de Historial -- antes solo existía
// mis_minieventos_clan() (RPC limitada al auth.uid() del equipo
// propio, usada en RankingPage.tsx), acá se consulta guerra_razas
// directo (guerra_razas_select_publico ya la deja pública) filtrando
// por equipo_creador_id, para que sea visible en la ficha pública de
// CUALQUIER equipo.
export default function MiniEventosClanList({ teamId, className = "", soloFinalizadas = false }: MiniEventosClanListProps) {
  const [eventos, setEventos] = useState<MiniEventoClan[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data } = await supabase
        .from("guerra_razas")
        .select("id, creado_en, tournament_id, tournaments!guerra_razas_tournament_id_fkey(nombre, estado)")
        .eq("equipo_creador_id", teamId)
        .order("creado_en", { ascending: false });

      if (cancelado) return;

      const lista: MiniEventoClan[] = (data ?? []).map((gr) => {
        const torneo = Array.isArray(gr.tournaments) ? gr.tournaments[0] : gr.tournaments;
        const t = torneo as { nombre: string; estado: string } | undefined;
        return {
          id: gr.id as string,
          tournamentId: gr.tournament_id as string,
          nombre: t?.nombre ?? "Race War",
          creadoEn: gr.creado_en as string,
          estado: t?.estado ?? "abierto",
        };
      });

      setEventos(lista);
      setCargando(false);
    };

    cargar();
    return () => {
      cancelado = true;
    };
  }, [teamId]);

  const eventosAMostrar = soloFinalizadas ? eventos.filter((e) => e.estado === "finalizado") : eventos;

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (eventosAMostrar.length === 0) {
    return (
      <p className="detail-empty">
        {soloFinalizadas ? "Todavía no terminó ninguna Race War." : "Todavía no organizó ninguna Race War."}
      </p>
    );
  }

  return (
    <div className={className}>
      {eventosAMostrar.map((ev) => (
        <div key={ev.id} className="detail-participant-item">
          <Link to={`/tournaments/${ev.tournamentId}`}>{ev.nombre}</Link>
          <span className="tournament-card-meta"> · {formatFecha(ev.creadoEn)}</span>
        </div>
      ))}
    </div>
  );
}
