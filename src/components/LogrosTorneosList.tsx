import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface LogroTorneo {
  id: string;
  nombre: string;
  fechaInicio: string;
  resultado: string;
  esCampeon: boolean;
  ligaNombre: string | null;
  divisionNombre: string | null;
  temporadaNombre: string | null;
}

interface LogrosTorneosListProps {
  teamId: string;
  className?: string;
  // Migración 165, a pedido del usuario: "Logros" solo quiere mostrar
  // las ligas GANADAS (campeón) -- "Finalizados" sigue mostrando
  // todas las participaciones, sin este filtro.
  soloCampeon?: boolean;
}

// Migración 166 (ampliada en la 165): torneos por ligas en los que
// este equipo participó, ya finalizados, con su resultado -- misma
// lógica que cargarHistorialTorneos() de ProfilePage.tsx (ahí es por
// user_id, acá por team_id), pública (tournament_participants_select_publico
// no restringe el select). Suma liga/división/temporada al cartel
// (ej. "Campeón -- StarLeague Latam, Diamond 1-2 · Temporada 5"), a
// pedido del usuario.
export default function LogrosTorneosList({ teamId, className = "", soloCampeon = false }: LogrosTorneosListProps) {
  const [torneos, setTorneos] = useState<LogroTorneo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data: participacionesData } = await supabase
        .from("tournament_participants")
        .select(
          "id, tournament_id, tournaments!tournament_participants_tournament_id_fkey(id, nombre, fecha_inicio, estado, modo, campeon_participant_id, liga_id, division_id)"
        )
        .eq("team_id", teamId);

      if (cancelado) return;

      const finalizadas = (participacionesData ?? [])
        .map((p) => {
          const torneo = Array.isArray(p.tournaments) ? p.tournaments[0] : p.tournaments;
          return {
            participantId: p.id as string,
            torneo: torneo as
              | {
                  id: string;
                  nombre: string;
                  fecha_inicio: string;
                  estado: string;
                  modo: string;
                  campeon_participant_id: string | null;
                  liga_id: string | null;
                  division_id: string | null;
                }
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

      // Liga/división/temporada -- consultas aparte (no embebidas) para
      // no depender de que PostgREST resuelva una relación inversa
      // (temporadas.torneo_id -> tournaments.id) sin ambigüedad.
      const ligaIds = [...new Set(finalizadas.map((p) => p.torneo!.liga_id).filter((id): id is string => !!id))];
      const divisionIds = [...new Set(finalizadas.map((p) => p.torneo!.division_id).filter((id): id is string => !!id))];
      const torneoIds = finalizadas.map((p) => p.torneo!.id);

      const [ligasRes, divisionesRes, temporadasRes] = await Promise.all([
        ligaIds.length > 0
          ? supabase.from("ligas").select("id, nombre").in("id", ligaIds)
          : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
        divisionIds.length > 0
          ? supabase.from("divisiones_liga").select("id, nombre").in("id", divisionIds)
          : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
        torneoIds.length > 0
          ? supabase.from("temporadas").select("torneo_id, nombre").in("torneo_id", torneoIds)
          : Promise.resolve({ data: [] as { torneo_id: string; nombre: string }[] }),
      ]);

      if (cancelado) return;

      const ligaPorId = Object.fromEntries((ligasRes.data ?? []).map((l) => [l.id, l.nombre]));
      const divisionPorId = Object.fromEntries((divisionesRes.data ?? []).map((d) => [d.id, d.nombre]));
      const temporadaPorTorneoId = Object.fromEntries((temporadasRes.data ?? []).map((t) => [t.torneo_id, t.nombre]));

      const lista: LogroTorneo[] = finalizadas.map(({ participantId, torneo }) => {
        const t = torneo!;
        let resultado = "Participó";
        const esCampeon = t.campeon_participant_id === participantId;
        if (esCampeon) {
          resultado = "Campeón 🏆";
        } else if (t.modo === "eliminacion_simple") {
          // Torneo finalizado + no es el campeón = en algún momento
          // perdió (así termina una llave de eliminación).
          resultado = perdioPorParticipante[participantId] ? "Perdió" : "Participó";
        } else {
          const r = resultadosPorParticipante[participantId];
          if (r && r.jugados > 0) resultado = `${r.ganados} victorias, ${r.jugados - r.ganados} derrotas`;
        }
        return {
          id: t.id,
          nombre: t.nombre,
          fechaInicio: t.fecha_inicio,
          resultado,
          esCampeon,
          ligaNombre: t.liga_id ? ligaPorId[t.liga_id] ?? null : null,
          divisionNombre: t.division_id ? divisionPorId[t.division_id] ?? null : null,
          temporadaNombre: temporadaPorTorneoId[t.id] ?? null,
        };
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

  const torneosAMostrar = soloCampeon ? torneos.filter((t) => t.esCampeon) : torneos;

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (torneosAMostrar.length === 0) {
    return (
      <p className="detail-empty">
        {soloCampeon
          ? "Todavía no ganó ninguna liga."
          : "Todavía no participó en ningún torneo por ligas finalizado."}
      </p>
    );
  }

  return (
    <div className={className}>
      {torneosAMostrar.map((t) => (
        <div key={t.id} className="detail-participant-item">
          <Link to={`/tournaments/${t.id}`}>{t.nombre}</Link>
          <span className="reto-status">{t.resultado}</span>
          <span className="tournament-card-meta">
            {" "}
            · {[t.ligaNombre, t.divisionNombre].filter(Boolean).join(" ")}
            {t.temporadaNombre ? ` · ${t.temporadaNombre}` : ""} · {formatFecha(t.fechaInicio)}
          </span>
        </div>
      ))}
    </div>
  );
}
