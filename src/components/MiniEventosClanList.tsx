import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface MiniEventoClan {
  id: string;
  tournamentId: string;
  nombre: string;
  creadoEn: string;
}

interface MiniEventosClanListProps {
  teamId: string;
  className?: string;
}

// Migración 166, ítem 10: Race Wars creadas por este equipo, en su
// propia pestaña dentro de Historial -- antes solo existía
// mis_minieventos_clan() (RPC limitada al auth.uid() del equipo
// propio, usada en RankingPage.tsx), acá se consulta guerra_razas
// directo (guerra_razas_select_publico ya la deja pública) filtrando
// por equipo_creador_id, para que sea visible en la ficha pública de
// CUALQUIER equipo.
export default function MiniEventosClanList({ teamId, className = "" }: MiniEventosClanListProps) {
  const [eventos, setEventos] = useState<MiniEventoClan[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data } = await supabase
        .from("guerra_razas")
        .select("id, creado_en, tournament_id, tournaments!guerra_razas_tournament_id_fkey(nombre)")
        .eq("equipo_creador_id", teamId)
        .order("creado_en", { ascending: false });

      if (cancelado) return;

      const lista: MiniEventoClan[] = (data ?? []).map((gr) => {
        const torneo = Array.isArray(gr.tournaments) ? gr.tournaments[0] : gr.tournaments;
        return {
          id: gr.id as string,
          tournamentId: gr.tournament_id as string,
          nombre: (torneo as { nombre: string } | undefined)?.nombre ?? "Race War",
          creadoEn: gr.creado_en as string,
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

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (eventos.length === 0) {
    return <p className="detail-empty">Todavía no organizó ninguna Race War.</p>;
  }

  return (
    <div className={className}>
      {eventos.map((ev) => (
        <div key={ev.id} className="detail-participant-item">
          <Link to={`/tournaments/${ev.tournamentId}`}>{ev.nombre}</Link>
          <span className="tournament-card-meta"> · {formatFecha(ev.creadoEn)}</span>
        </div>
      ))}
    </div>
  );
}
