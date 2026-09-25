import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Avatar from "./Avatar";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { buscarLideresChat, marcarConversacionLeida, obtenerConversacionesChatLideres } from "../lib/chatLideres";
import type { ConversacionPrivadaLider, LiderBusqueda, MensajePrivadoLider } from "../lib/chatLideres";

type Destino = LiderBusqueda | ConversacionPrivadaLider;

function esConversacion(destino: Destino): destino is ConversacionPrivadaLider {
  return "otro_usuario_id" in destino;
}

function idDe(destino: Destino): string {
  return esConversacion(destino) ? destino.otro_usuario_id : destino.id;
}

function nickDe(destino: Destino): string | null {
  return esConversacion(destino) ? destino.otro_nick : destino.nick;
}

function avatarDe(destino: Destino): string | null {
  return esConversacion(destino) ? destino.otro_avatar_url : destino.avatar_url;
}

// Mensajes privados entre dos personas habilitadas hoy. La lista de
// conversaciones (última línea + no leídos) se recarga completa en
// cada evento de Realtime relevante en vez de mantenerse a mano --
// dado el volumen esperado (líderes/Staff, no el total de usuarios),
// no vale la pena la complejidad de ir mezclando el estado a mano.
export default function ChatPrivadosLideres() {
  const { user } = useAuth();
  const [conversaciones, setConversaciones] = useState<ConversacionPrivadaLider[]>([]);
  const [cargando, setCargando] = useState(true);
  const [conversacionAbierta, setConversacionAbierta] = useState<Destino | null>(null);
  const [mensajes, setMensajes] = useState<MensajePrivadoLider[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<LiderBusqueda[]>([]);
  const listaRef = useRef<HTMLDivElement | null>(null);
  // Ref para que el canal de Realtime (suscrito una sola vez) siempre
  // vea cuál es la conversación abierta ACTUAL sin tener que
  // resuscribirse cada vez que se cambia de conversación.
  const conversacionAbiertaRef = useRef<Destino | null>(null);

  const recargarConversaciones = useCallback(async () => {
    const data = await obtenerConversacionesChatLideres();
    setConversaciones(data);
    setCargando(false);
  }, []);

  useEffect(() => {
    recargarConversaciones();
  }, [recargarConversaciones]);

  useEffect(() => {
    conversacionAbiertaRef.current = conversacionAbierta;
  }, [conversacionAbierta]);

  const abrirConversacion = useCallback(
    async (destino: Destino) => {
      if (!user) return;
      setConversacionAbierta(destino);
      setResultados([]);
      setBusqueda("");

      const id = idDe(destino);
      const { data, error } = await supabase
        .from("mensajes_privados_lideres")
        .select("id, de_usuario_id, para_usuario_id, contenido, created_at, leido")
        .or(
          `and(de_usuario_id.eq.${user.id},para_usuario_id.eq.${id}),and(de_usuario_id.eq.${id},para_usuario_id.eq.${user.id})`
        )
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error cargando la conversación:", error);
        return;
      }

      setMensajes((data ?? []) as MensajePrivadoLider[]);
      await marcarConversacionLeida(user.id, id);
      recargarConversaciones();
    },
    [user, recargarConversaciones]
  );

  useEffect(() => {
    if (!user) return;
    const canal = supabase
      .channel("chat-lideres-privados")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_privados_lideres" },
        async (payload) => {
          const nuevo = payload.new as MensajePrivadoLider;
          const abierta = conversacionAbiertaRef.current;
          const abiertaId = abierta ? idDe(abierta) : null;
          const perteneceAConversacionAbierta =
            abiertaId !== null && (nuevo.de_usuario_id === abiertaId || nuevo.para_usuario_id === abiertaId);

          if (perteneceAConversacionAbierta) {
            setMensajes((prev) => [...prev, nuevo]);
            if (nuevo.para_usuario_id === user.id) {
              await marcarConversacionLeida(user.id, nuevo.de_usuario_id);
            }
          }

          recargarConversaciones();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [user, recargarConversaciones]);

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight });
  }, [mensajes]);

  useEffect(() => {
    if (!busqueda.trim()) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => {
      buscarLideresChat(busqueda.trim()).then(setResultados);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const handleEnviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !conversacionAbierta) return;

    const contenido = texto.trim();
    if (!contenido) return;

    if (contieneLenguajeInapropiado(contenido)) {
      toast.error("Ese mensaje contiene lenguaje inapropiado.");
      return;
    }

    setEnviando(true);
    const { error } = await supabase.from("mensajes_privados_lideres").insert({
      de_usuario_id: user.id,
      para_usuario_id: idDe(conversacionAbierta),
      contenido,
    });
    setEnviando(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setTexto("");
  };

  if (cargando) {
    return <p className="tournament-card-meta">Cargando...</p>;
  }

  if (conversacionAbierta) {
    return (
      <div className="chat-lideres-privado-hilo">
        <button
          type="button"
          className="btn-link chat-lideres-volver"
          onClick={() => setConversacionAbierta(null)}
        >
          ← Volver a conversaciones
        </button>
        <div className="chat-lideres-privado-titulo">
          <Avatar
            url={avatarDe(conversacionAbierta)}
            nombre={nickDe(conversacionAbierta)}
            className="chat-lideres-avatar"
          />
          <span>{nickDe(conversacionAbierta) ?? "Jugador"}</span>
        </div>
        <div className="chat-lideres-mensajes" ref={listaRef}>
          {mensajes.length === 0 && <p className="tournament-card-meta">Todavía no hay mensajes.</p>}
          {mensajes.map((m) => (
            <div key={m.id} className={`chat-lideres-mensaje ${m.de_usuario_id === user?.id ? "es-propio" : ""}`}>
              <div className="chat-lideres-mensaje-cuerpo">
                <p className="chat-lideres-mensaje-texto">{m.contenido}</p>
                <span className="chat-lideres-mensaje-hora">
                  {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ))}
        </div>
        <form className="chat-lideres-form" onSubmit={handleEnviar}>
          <input
            type="text"
            className="form-input"
            placeholder="Escribe un mensaje..."
            value={texto}
            maxLength={500}
            onChange={(e) => setTexto(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={enviando || !texto.trim()}>
            Enviar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-lideres-privados-lista">
      <input
        type="text"
        className="form-input"
        placeholder="Buscar un líder o Staff para empezar una conversación..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />
      {resultados.length > 0 && (
        <div className="chat-lideres-resultados">
          {resultados.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chat-lideres-resultado-item"
              onClick={() => abrirConversacion(r)}
            >
              <Avatar url={r.avatar_url} nombre={r.nick} className="chat-lideres-avatar" />
              <span>{r.nick ?? "Jugador"}</span>
            </button>
          ))}
        </div>
      )}

      {conversaciones.length === 0 && !busqueda && (
        <p className="tournament-card-meta">No tienes conversaciones todavía. Busca a alguien arriba para empezar.</p>
      )}

      <div className="chat-lideres-conversaciones-lista">
        {conversaciones.map((c) => (
          <button
            key={c.otro_usuario_id}
            type="button"
            className="chat-lideres-conversacion-item"
            onClick={() => abrirConversacion(c)}
          >
            <Avatar url={c.otro_avatar_url} nombre={c.otro_nick} className="chat-lideres-avatar" />
            <div className="chat-lideres-conversacion-info">
              <span className="chat-lideres-conversacion-nick">{c.otro_nick ?? "Jugador"}</span>
              <span className="chat-lideres-conversacion-preview">{c.ultimo_mensaje}</span>
            </div>
            {c.no_leidos > 0 && <span className="chat-lideres-badge">{c.no_leidos}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
