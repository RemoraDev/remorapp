import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";

interface PodioTorneo {
  id: string;
  nombre: string;
  fechaInicio: string;
  puesto: "Campeón" | "Subcampeón" | "Tercer lugar";
}

interface LogrosTorneosJugadorListProps {
  userId: string;
  className?: string;
}

function extraerUno<T>(valor: T | T[] | null | undefined): T | undefined {
  return Array.isArray(valor) ? valor[0] : valor ?? undefined;
}

// Migración 167, a pedido del usuario: Logros de Mi perfil solo
// muestra podios (1°/2°/3° lugar) de torneos (no Race War, que no
// tiene puesto individual por jugador todavía). Campeón y Tercer
// lugar ya vienen guardados en tournaments; Subcampeón no tiene
// columna propia -- se deriva de la final del bracket (la partida de
// mayor ronda que no es la de tercer lugar), solo para
// eliminacion_simple, que es el único modo con una final bien
// definida.
export default function LogrosTorneosJugadorList({ userId, className = "" }: LogrosTorneosJugadorListProps) {
  const [podios, setPodios] = useState<PodioTorneo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);

    const cargar = async () => {
      const { data: participacionesData } = await supabase
        .from("tournament_participants")
        .select(
          "id, tournament_id, tournaments!tournament_participants_tournament_id_fkey(id, nombre, fecha_inicio, estado, modo, campeon_participant_id, tercer_lugar_participant_id)"
        )
        .eq("user_id", userId);

      if (cancelado) return;

      const finalizadas = (participacionesData ?? [])
        .map((p) => ({
          participantId: p.id as string,
          tournamentId: p.tournament_id as string,
          torneo: extraerUno<{
            id: string;
            nombre: string;
            fecha_inicio: string;
            estado: string;
            modo: string;
            campeon_participant_id: string | null;
            tercer_lugar_participant_id: string | null;
          }>(p.tournaments),
        }))
        .filter((p) => p.torneo?.estado === "finalizado");

      const idsEliminacion = finalizadas
        .filter((p) => p.torneo!.modo === "eliminacion_simple")
        .map((p) => p.tournamentId);

      let subcampeonPorTorneo: Record<string, string> = {};
      if (idsEliminacion.length > 0) {
        const { data: partidasData } = await supabase
          .from("bracket_matches")
          .select("tournament_id, round, es_tercer_lugar, participant1_id, participant2_id, winner_id")
          .in("tournament_id", idsEliminacion)
          .eq("es_tercer_lugar", false)
          .eq("status", "jugado");

        const maxRondaPorTorneo: Record<string, number> = {};
        for (const m of partidasData ?? []) {
          const actual = maxRondaPorTorneo[m.tournament_id] ?? 0;
          if (m.round > actual) maxRondaPorTorneo[m.tournament_id] = m.round;
        }
        for (const m of partidasData ?? []) {
          if (m.round !== maxRondaPorTorneo[m.tournament_id]) continue;
          const perdedor = m.winner_id === m.participant1_id ? m.participant2_id : m.participant1_id;
          if (perdedor) subcampeonPorTorneo[m.tournament_id] = perdedor;
        }
      }

      if (cancelado) return;

      const lista: PodioTorneo[] = [];
      for (const { participantId, tournamentId, torneo } of finalizadas) {
        const t = torneo!;
        if (t.campeon_participant_id === participantId) {
          lista.push({ id: t.id, nombre: t.nombre, fechaInicio: t.fecha_inicio, puesto: "Campeón" });
        } else if (subcampeonPorTorneo[tournamentId] === participantId) {
          lista.push({ id: t.id, nombre: t.nombre, fechaInicio: t.fecha_inicio, puesto: "Subcampeón" });
        } else if (t.tercer_lugar_participant_id === participantId) {
          lista.push({ id: t.id, nombre: t.nombre, fechaInicio: t.fecha_inicio, puesto: "Tercer lugar" });
        }
      }

      lista.sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
      setPodios(lista);
      setCargando(false);
    };

    cargar();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  if (cargando) return <p className="tournament-card-meta">Cargando...</p>;

  if (podios.length === 0) {
    return <p className="detail-empty">Todavía no terminó en el podio de ningún torneo.</p>;
  }

  return (
    <div className={className}>
      {podios.map((t) => (
        <div key={`${t.id}-${t.puesto}`} className="detail-participant-item">
          <Link to={`/tournaments/${t.id}`}>{t.nombre}</Link>
          <span className="reto-status">
            {t.puesto === "Campeón" ? "Campeón 🏆" : t.puesto === "Subcampeón" ? "Subcampeón 🥈" : "Tercer lugar 🥉"}
          </span>
          <span className="tournament-card-meta"> · {formatFecha(t.fechaInicio)}</span>
        </div>
      ))}
    </div>
  );
}
