import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import type { MensajeEquipoRow } from "../types/teamChat";

const formatoHora = new Intl.DateTimeFormat("es-CL", { timeStyle: "short" });

interface IdentidadAutor {
  nick: string | null;
  uniqueId: string | null;
}

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
      setErrorEnvio("No se pudo enviar el mensaje. Intenta de nuevo.");
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
        <p className="tournament-card-meta">
          Canal de texto de {equipoActual.teamTag ?? "tu equipo"}. La comunicación por voz en tiempo
          real todavía está en desarrollo.
        </p>
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
