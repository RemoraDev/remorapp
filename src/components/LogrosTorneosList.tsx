import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface LogroTorneo {
  id: string;
  nombre: string;
  fechaInicio: string;
  resultado: string;
}

interface LogrosTorneosListProps {
  teamId: string;
  className?: string;
}

// Migración 166: torneos por ligas en los que este equipo participó,
// ya finalizados, con su resultado -- misma lógica que
// cargarHistorialTorneos() de ProfilePage.tsx (ahí es por user_id,
// acá por team_id), pública (tournament_participants_select_publico
// no restringe el select). Se muestra en la pestaña "Logros" de la
// ficha pública del equipo, junto a las Clan Wars Amistosas ganadas.
export default function LogrosTorneosList({ teamId, className = "" }: LogrosTorneosListProps) {
  const [torneos, setTorneos] = useState<LogroTorneo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data: participacionesData } = await supabase
        .from("tournament_participants")
        .select(
          "id, tournament_id, tournaments!tournament_participants_tournament_id_fkey(id, nombre, fecha_inicio, estado, modo, campeon_participant_id)"
        )
        .eq("team_id", teamId);

      if (cancelado) return;

      const finalizadas = (participacionesData ?? [])
        .map((p) => {
          const torneo = Array.isArray(p.tournaments) ? p.tournaments[0] : p.tournaments;
          return {
            participantId: p.id as string,
            torneo: torneo as
              | { id: string; nombre: string; fecha_inicio: string; estado: string; modo: string; campeon_participant_id: string | null }
              | undefined,
          };
        })
        .filter((p) => p.torneo?.estado === "finalizado");

      const idsEliminacion = finalizadas.filter((p) => p.torneo!.modo === "eliminacion_simple").map((p) => p.participantId);
      let perdioPorParticipante: Record<string, boolean> = {};
      if (idsEliminacion.length > 0) {
        const { data: partidasData } = await supabase
          .from("bracket_matches")
          .select("participant1_id, participant2_id, winner_id, status")
          .eq("status", "jugado")
          .or(idsEliminacion.map((id) => `participant1_id.eq.${id},participant2_id.eq.${id}`).join(","));
        for (const m of partidasData ?? []) {
          for (const pid of [m.participant1_id, m.participant2_id]) {
            if (pid && idsEliminacion.includes(pid) && m.winner_id !== pid) {
              perdioPorParticipante[pid] = true;
            }
          }
        }
      }

      const idsOtrosModos = finalizadas.filter((p) => p.torneo!.modo !== "eliminacion_simple").map((p) => p.participantId);
      let resultadosPorParticipante: Record<string, { ganados: number; jugados: number }> = {};
      if (idsOtrosModos.length > 0) {
        const { data: resultadosData } = await supabase
          .from("tournament_results")
          .select("participant_id, gano")
          .in("participant_id", idsOtrosModos);
        for (const r of resultadosData ?? []) {
          const actual = resultadosPorParticipante[r.participant_id] ?? { ganados: 0, jugados: 0 };
          actual.jugados += 1;
          if (r.gano) actual.ganados += 1;
          resultadosPorParticipante[r.participant_id] = actual;
        }
      }

      if (cancelado) return;

      const lista: LogroTorneo[] = finalizadas.map(({ participantId, torneo }) => {
        const t = torneo!;
        let resultado = "Participó";
        if (t.campeon_participant_id === participantId) {
          resultado = "Campeón 🏆";
        } else if (t.modo === "eliminacion_simple") {
          // Torneo finalizado + no es el campeón = en algún momento
          // perdió (así termina una llave de eliminación).
          resultado = perdioPorParticipante[participantId] ? "Perdió" : "Participó";
        } else {
          const r = resultadosPorParticipante[participantId];
          if (r && r.jugados > 0) resultado = `${r.ganados} victorias, ${r.jugados - r.ganados} derrotas`;
        }
        return { id: t.id, nombre: t.nombre, fechaInicio: t.fecha_inicio, resultado };
      });

      lista.sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
      setTorneos(lista);
      setCargando(false);
    };

    cargar();
    return () => {
      cancelado = true;
    };
  }, [teamId]);

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (torneos.length === 0) {
    return <p className="detail-empty">Todavía no participó en ningún torneo por ligas finalizado.</p>;
  }

  return (
    <div className={className}>
      {torneos.map((t) => (
        <div key={t.id} className="detail-participant-item">
          <Link to={`/tournaments/${t.id}`}>{t.nombre}</Link>
          <span className="reto-status">{t.resultado}</span>
          <span className="tournament-card-meta"> · {formatFecha(t.fechaInicio)}</span>
        </div>
      ))}
    </div>
  );
}
