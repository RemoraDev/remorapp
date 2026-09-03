import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import type { EstiloBracket, FondoBracket } from "../types/tournaments";

interface PartidaDestacada {
  nombreChallenger: string;
  logoChallenger: string | null;
  nombreChallenged: string;
  logoChallenged: string | null;
  round: number;
  status: "pendiente" | "jugado" | "en_disputa";
  ganadorEsChallenger: boolean | null;
}

interface TorneoOverlay {
  nombre: string;
  estiloBracket: EstiloBracket;
  fondoBracket: FondoBracket;
}

const INTERVALO_MS = 7000;

// Overlay de Torneo para OBS (migración 044): a diferencia del de
// Clan War, no hace falta ninguna función nueva en la base --
// tournaments, bracket_matches, tournament_participants y teams ya
// son de lectura pública desde hace varias migraciones, así que esta
// página consulta esas tablas directo.
export default function OverlayTorneoPage() {
  const { id } = useParams<{ id: string }>();
  const [torneo, setTorneo] = useState<TorneoOverlay | null>(null);
  const [partida, setPartida] = useState<PartidaDestacada | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    document.body.classList.add("overlay-obs");
    return () => {
      document.body.classList.remove("overlay-obs");
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;

    const cargar = async () => {
      const { data: torneoData, error: torneoError } = await supabase
        .from("tournaments")
        .select("nombre, estilo_bracket, fondo_bracket, formato")
        .eq("id", id)
        .single();

      if (cancelado) return;

      if (torneoError || !torneoData) {
        setNoEncontrado(true);
        setCargando(false);
        return;
      }

      setTorneo({
        nombre: torneoData.nombre,
        estiloBracket: torneoData.estilo_bracket,
        fondoBracket: torneoData.fondo_bracket,
      });

      // Partida destacada: la próxima pendiente con los dos
      // participantes ya definidos (round más bajo primero); si no
      // hay ninguna pendiente, la última jugada -- siempre se muestra
      // algo mientras haya llave.
      const { data: pendientes } = await supabase
        .from("bracket_matches")
        .select("participant1_id, participant2_id, round, status, winner_id")
        .eq("tournament_id", id)
        .eq("status", "pendiente")
        .not("participant1_id", "is", null)
        .not("participant2_id", "is", null)
        .order("round", { ascending: true })
        .order("match_number", { ascending: true })
        .limit(1);

      let match = pendientes?.[0] ?? null;

      if (!match) {
        const { data: jugadas } = await supabase
          .from("bracket_matches")
          .select("participant1_id, participant2_id, round, status, winner_id")
          .eq("tournament_id", id)
          .eq("status", "jugado")
          .order("round", { ascending: false })
          .order("match_number", { ascending: false })
          .limit(1);
        match = jugadas?.[0] ?? null;
      }

      if (cancelado) return;

      if (!match) {
        setPartida(null);
        setCargando(false);
        return;
      }

      const { data: participantesData } = await supabase
        .from("tournament_participants")
        .select("id, user_id, team_id")
        .in("id", [match.participant1_id, match.participant2_id]);

      const userIds = (participantesData ?? []).map((p) => p.user_id).filter((v): v is string => !!v);
      const teamIds = (participantesData ?? []).map((p) => p.team_id).filter((v): v is string => !!v);

      const [perfilesRes, equiposRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from("profiles").select("id, nick, unique_id, avatar_url").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; nick: string | null; unique_id: string | null; avatar_url: string | null }[] }),
        teamIds.length > 0
          ? supabase.from("teams").select("id, name, logo_url").in("id", teamIds)
          : Promise.resolve({ data: [] as { id: string; name: string; logo_url: string | null }[] }),
      ]);

      const nombrePorParticipante: Record<string, string> = {};
      const logoPorParticipante: Record<string, string | null> = {};
      for (const p of participantesData ?? []) {
        if (p.user_id) {
          const perfil = perfilesRes.data?.find((x) => x.id === p.user_id);
          nombrePorParticipante[p.id] = perfil?.nick ? `${perfil.nick}#${perfil.unique_id}` : "Jugador de RemorApp";
          logoPorParticipante[p.id] = perfil?.avatar_url ?? null;
        } else if (p.team_id) {
          const equipo = equiposRes.data?.find((x) => x.id === p.team_id);
          nombrePorParticipante[p.id] = equipo?.name ?? "Equipo de RemorApp";
          logoPorParticipante[p.id] = equipo?.logo_url ?? null;
        }
      }

      if (cancelado) return;

      setPartida({
        nombreChallenger: nombrePorParticipante[match.participant1_id as string] ?? "BYE",
        logoChallenger: logoPorParticipante[match.participant1_id as string] ?? null,
        nombreChallenged: nombrePorParticipante[match.participant2_id as string] ?? "BYE",
        logoChallenged: logoPorParticipante[match.participant2_id as string] ?? null,
        round: match.round,
        status: match.status,
        ganadorEsChallenger: match.winner_id ? match.winner_id === match.participant1_id : null,
      });
      setCargando(false);
    };

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [id]);

  if (cargando) return null;

  if (noEncontrado || !torneo) {
    return (
      <div className="overlay-page">
        <p className="overlay-error">Torneo no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="overlay-page" data-estilo-bracket={torneo.estiloBracket} data-fondo-bracket={torneo.fondoBracket}>
      <p className="overlay-torneo-nombre">{torneo.nombre}</p>

      {!partida ? (
        <p className="overlay-error">Todavía no hay una llave generada.</p>
      ) : (
        <div className="bracket-match overlay-torneo-match">
          <div className={`bracket-slot ${partida.ganadorEsChallenger === true ? "winner" : partida.ganadorEsChallenger === false ? "loser" : ""}`}>
            {partida.logoChallenger && <img src={partida.logoChallenger} alt="" className="bracket-slot-logo" />}
            {partida.nombreChallenger}
          </div>
          <div className={`bracket-slot ${partida.ganadorEsChallenger === false ? "winner" : partida.ganadorEsChallenger === true ? "loser" : ""}`}>
            {partida.logoChallenged && <img src={partida.logoChallenged} alt="" className="bracket-slot-logo" />}
            {partida.nombreChallenged}
          </div>
        </div>
      )}
    </div>
  );
}
