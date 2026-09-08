import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Room, RoomEvent } from "livekit-client";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { LIVEKIT_URL, vozConfigurada } from "../lib/voiceChannel";
import type { MensajeEquipoRow } from "../types/teamChat";

const formatoHora = new Intl.DateTimeFormat("es-CL", { timeStyle: "short" });

interface IdentidadAutor {
  nick: string | null;
  uniqueId: string | null;
}

// Estados del panel de voz -- "pidiendo_permiso" es deliberadamente un
// paso propio, ANTES de intentar conectar a LiveKit: así el navegador
// pide el permiso de micrófono de entrada, independiente de si la
// integración de LiveKit ya está configurada o no (hoy no lo está,
// todavía no existe una cuenta real -- ver lib/voiceChannel.ts).
type EstadoVoz = "inactivo" | "pidiendo_permiso" | "conectando" | "conectado" | "error";

// Delfin Mode -- primera versión real (migración 071): chat de texto
// en tiempo real por equipo, sobre Supabase Realtime (Postgres
// Changes). La voz en tiempo real queda para una fase aparte, todavía
// sin infraestructura externa definida (LiveKit/Agora).
export default function VoicePage() {
  const { user } = useAuth();

  const [equipoActual, setEquipoActual] = useState<EquipoDelUsuario | null>(null);
  const [cargandoEquipo, setCargandoEquipo] = useState(true);

  const [mensajes, setMensajes] = useState<MensajeEquipoRow[]>([]);
  const [identidadesPorAutor, setIdentidadesPorAutor] = useState<Record<string, IdentidadAutor>>({});
  const [cargandoMensajes, setCargandoMensajes] = useState(true);

  const [textoNuevo, setTextoNuevo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const listaMensajesRef = useRef<HTMLDivElement>(null);

  const [estadoVoz, setEstadoVoz] = useState<EstadoVoz>("inactivo");
  const [errorVoz, setErrorVoz] = useState<string | null>(null);
  const [participantesVoz, setParticipantesVoz] = useState<string[]>([]);
  const [silenciado, setSilenciado] = useState(false);
  const salaVozRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!user) {
      setCargandoEquipo(false);
      return;
    }
    setCargandoEquipo(true);
    obtenerEquipoDelUsuario(user.id).then((equipo) => {
      setEquipoActual(equipo);
      setCargandoEquipo(false);
    });
  }, [user]);

  useEffect(() => {
    const teamId = equipoActual?.team_id;
    if (!teamId) {
      setMensajes([]);
      return;
    }

    let activo = true;
    setCargandoMensajes(true);

    // Identidad (Nick#ID) de cada integrante del equipo, resuelta una
    // sola vez -- evita una consulta a profiles por cada mensaje, tanto
    // en la carga inicial como en los que van llegando por Realtime.
    supabase
      .from("team_members")
      .select("user_id, profiles(nick, unique_id)")
      .eq("team_id", teamId)
      .then(({ data }) => {
        if (!activo || !data) return;
        const mapa: Record<string, IdentidadAutor> = {};
        for (const fila of data) {
          const perfil = Array.isArray(fila.profiles) ? fila.profiles[0] : fila.profiles;
          mapa[fila.user_id] = {
            nick: (perfil as { nick?: string } | undefined)?.nick ?? null,
            uniqueId: (perfil as { unique_id?: string } | undefined)?.unique_id ?? null,
          };
        }
        setIdentidadesPorAutor(mapa);
      });

    supabase
      .from("mensajes_equipo")
      .select("id, team_id, autor_id, contenido, created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data, error }) => {
        if (!activo) return;
        if (error) {
          console.error("Error cargando mensajes:", error);
        } else {
          setMensajes(data ?? []);
        }
        setCargandoMensajes(false);
      });

    const canal = supabase
      .channel(`mensajes_equipo:${teamId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_equipo", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const nuevo = payload.new as MensajeEquipoRow;
          setMensajes((actuales) =>
            actuales.some((m) => m.id === nuevo.id) ? actuales : [...actuales, nuevo]
          );
        }
      )
      .subscribe();

    return () => {
      activo = false;
      supabase.removeChannel(canal);
    };
  }, [equipoActual?.team_id]);

  useEffect(() => {
    const contenedor = listaMensajesRef.current;
    if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;
  }, [mensajes]);

  // Si el usuario navega a otra página estando conectado, no dejamos
  // la sala abierta en segundo plano.
  useEffect(() => {
    return () => {
      salaVozRef.current?.disconnect();
    };
  }, []);

  const actualizarParticipantesVoz = () => {
    const sala = salaVozRef.current;
    if (!sala) return;
    const identidades = [
      sala.localParticipant.identity,
      ...Array.from(sala.remoteParticipants.values()).map((p) => p.identity),
    ];
    setParticipantesVoz(identidades);
  };

  const handleUnirseVoz = async () => {
    if (!user || !equipoActual) return;
    setErrorVoz(null);

    // Paso 1: pedir el permiso de micrófono, ANTES de intentar
    // cualquier cosa con LiveKit -- así el usuario ve el diálogo del
    // navegador de entrada, sin depender de si el servidor de voz ya
    // está configurado. Se suelta el track enseguida: la captura real
    // para transmitir la maneja LiveKit más abajo, con
    // setMicrophoneEnabled().
    setEstadoVoz("pidiendo_permiso");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setEstadoVoz("error");
      setErrorVoz("Necesitamos acceso a tu micrófono para unirte por voz. Revisa los permisos del navegador.");
      return;
    }

    if (!vozConfigurada()) {
      setEstadoVoz("error");
      setErrorVoz(
        "La integración de voz todavía no está configurada en este servidor (falta la cuenta de LiveKit)."
      );
      return;
    }

    setEstadoVoz("conectando");
    try {
      const { data, error } = await supabase.functions.invoke("livekit-token", {
        body: { teamId: equipoActual.team_id },
      });
      if (error || !data?.token) throw new Error("Sin token");

      const sala = new Room();
      salaVozRef.current = sala;
      sala.on(RoomEvent.ParticipantConnected, actualizarParticipantesVoz);
      sala.on(RoomEvent.ParticipantDisconnected, actualizarParticipantesVoz);
      sala.on(RoomEvent.Disconnected, () => {
        salaVozRef.current = null;
        setParticipantesVoz([]);
        setSilenciado(false);
        setEstadoVoz("inactivo");
      });

      await sala.connect(LIVEKIT_URL as string, data.token as string);
      await sala.localParticipant.setMicrophoneEnabled(true);
      actualizarParticipantesVoz();
      setEstadoVoz("conectado");
    } catch {
      salaVozRef.current = null;
      setEstadoVoz("error");
      setErrorVoz("No se pudo conectar al canal de voz. Intenta de nuevo más tarde.");
    }
  };

  const handleSalirVoz = async () => {
    await salaVozRef.current?.disconnect();
    salaVozRef.current = null;
    setParticipantesVoz([]);
    setSilenciado(false);
    setEstadoVoz("inactivo");
  };

  const handleToggleSilencio = async () => {
    const sala = salaVozRef.current;
    if (!sala) return;
    const nuevoSilenciado = !silenciado;
    await sala.localParticipant.setMicrophoneEnabled(!nuevoSilenciado);
    setSilenciado(nuevoSilenciado);
  };

  const handleEnviar = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !equipoActual) return;

    const contenido = textoNuevo.trim();
    if (!contenido) return;

    if (contieneLenguajeInapropiado(contenido)) {
      setErrorEnvio("Ese mensaje contiene lenguaje que no está permitido. Por favor, reformúlalo.");
      return;
    }

    setEnviando(true);
    setErrorEnvio(null);

    const { error } = await supabase
      .from("mensajes_equipo")
      .insert({ team_id: equipoActual.team_id, autor_id: user.id, contenido });

    setEnviando(false);

    if (error) {
      // Migración 072: el mismo filtro también está reforzado en la
      // base (check constraint) -- si por lo que sea el chequeo del
      // cliente de arriba lo dejó pasar, el mensaje sigue sin poder
      // guardarse, y esto le da al usuario el mismo aviso claro en
      // vez del error crudo de Postgres.
      if (error.message.includes("mensajes_equipo_contenido_sin_lenguaje_inapropiado")) {
        setErrorEnvio("Ese mensaje contiene lenguaje que no está permitido. Por favor, reformúlalo.");
      } else {
        setErrorEnvio("No se pudo enviar el mensaje. Intenta de nuevo.");
      }
      return;
    }

    setTextoNuevo("");
  };

  if (cargandoEquipo) {
    return (
      <section className="page-placeholder">
        <h1>Delfin Mode</h1>
        <p>Cargando...</p>
      </section>
    );
  }

  if (!equipoActual) {
    return (
      <section className="page-placeholder">
        <h1>Delfin Mode</h1>
        <p>
          Necesitas pertenecer a un clan para usar esta función. Únete a un equipo o crea el tuyo
          desde "Equipos" para acceder al canal de chat de tu clan.
        </p>
      </section>
    );
  }

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Delfin Mode</h1>
        <p className="tournament-card-meta">Canal de {equipoActual.teamTag ?? "tu equipo"}.</p>
      </div>

      <div className="team-voice">
        <div className="team-voice-cabecera">
          <h2 className="detail-subtitle">Voz</h2>
          {(estadoVoz === "inactivo" || estadoVoz === "error") && (
            <button type="button" className="btn btn-primary" onClick={handleUnirseVoz}>
              {estadoVoz === "error" ? "Reintentar" : "Unirse por voz"}
            </button>
          )}
          {estadoVoz === "pidiendo_permiso" && (
            <p className="tournament-card-meta">Solicitando permiso de micrófono...</p>
          )}
          {estadoVoz === "conectando" && <p className="tournament-card-meta">Conectando...</p>}
          {estadoVoz === "conectado" && (
            <div className="team-voice-controles">
              <button type="button" className="btn btn-ghost" onClick={handleToggleSilencio}>
                {silenciado ? "Activar micrófono" : "Silenciarme"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleSalirVoz}>
                Salir
              </button>
            </div>
          )}
        </div>

        {errorVoz && <div className="form-error">{errorVoz}</div>}

        {estadoVoz === "conectado" && (
          <ul className="team-voice-participantes">
            {participantesVoz.map((identidad) => {
              const perfil = identidadesPorAutor[identidad];
              const esUnoMismo = identidad === user?.id;
              const nombre = perfil?.nick ? `${perfil.nick}#${perfil.uniqueId}` : "Jugador de RemorApp";
              return (
                <li key={identidad} className="team-voice-participante">
                  {nombre}
                  {esUnoMismo && " (vos)"}
                  {esUnoMismo && silenciado && <span className="team-voice-silenciado-badge">Silenciado</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="team-chat">
        <div className="team-chat-mensajes" ref={listaMensajesRef}>
          {cargandoMensajes && <p className="detail-empty">Cargando mensajes...</p>}
          {!cargandoMensajes && mensajes.length === 0 && (
            <p className="detail-empty">Todavía no hay mensajes en este canal. Sé el primero en escribir.</p>
          )}
          {mensajes.map((mensaje) => {
            const identidad = identidadesPorAutor[mensaje.autor_id];
            const nombre = identidad?.nick ? `${identidad.nick}#${identidad.uniqueId}` : "Jugador de RemorApp";
            return (
              <div key={mensaje.id} className="team-chat-mensaje">
                <div className="team-chat-mensaje-cabecera">
                  <span className="team-chat-autor">{nombre}</span>
                  <span className="team-chat-hora">{formatoHora.format(new Date(mensaje.created_at))}</span>
                </div>
                <p className="team-chat-texto">{mensaje.contenido}</p>
              </div>
            );
          })}
        </div>

        <form className="team-chat-form" onSubmit={handleEnviar}>
          <input
            className="form-input"
            type="text"
            maxLength={500}
            placeholder="Escribe un mensaje..."
            value={textoNuevo}
            onChange={(e) => setTextoNuevo(e.target.value)}
            disabled={enviando}
          />
          <button type="submit" className="btn btn-primary" disabled={enviando || !textoNuevo.trim()}>
            Enviar
          </button>
        </form>
        {errorEnvio && <div className="form-error">{errorEnvio}</div>}
      </div>
    </section>
  );
}
