import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Avatar from "./Avatar";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { dejarDeSilenciarUsuario, obtenerUsuariosSilenciados, silenciarUsuario } from "../lib/chatLideres";
import type { MensajeLider } from "../lib/chatLideres";

interface AutorInfo {
  nick: string | null;
  avatar_url: string | null;
}

interface MensajeConAutor extends MensajeLider {
  profiles: AutorInfo | AutorInfo[] | null;
}

// mensajes_lideres.autor_id -> profiles.id: PostgREST embebe el join,
// pero sin tipos generados puede venir como objeto o como array de 1
// (mismo caso ya documentado en lib/teams.ts).
function extraerAutor(fila: MensajeConAutor): AutorInfo {
  const p = Array.isArray(fila.profiles) ? fila.profiles[0] : fila.profiles;
  return p ?? { nick: null, avatar_url: null };
}

const LIMITE_MENSAJES = 80;

// Chat grupal de todos los líderes/Staff/admin habilitados. El
// silenciado ya se resuelve del lado de la base (la política de
// select de mensajes_lideres excluye a quien silenciaste), así que acá
// no hace falta repetir ese filtro -- alcanza con recargar la lista
// después de silenciar/dejar de silenciar para que la vista quede
// consistente con lo que la base ya está devolviendo.
export default function ChatGrupalLideres() {
  const { user } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeConAutor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [silenciados, setSilenciados] = useState<string[]>([]);
  const [mostrarSilenciados, setMostrarSilenciados] = useState(false);
  const listaRef = useRef<HTMLDivElement | null>(null);

  const cargarMensajes = useCallback(async () => {
    const { data, error } = await supabase
      .from("mensajes_lideres")
      .select("id, autor_id, contenido, created_at, profiles(nick, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(LIMITE_MENSAJES);

    if (error) {
      console.error("Error cargando el chat de líderes:", error);
      setCargando(false);
      return;
    }

    setMensajes(((data ?? []) as unknown as MensajeConAutor[]).slice().reverse());
    setCargando(false);
  }, []);

  useEffect(() => {
    cargarMensajes();
    obtenerUsuariosSilenciados().then(setSilenciados);
  }, [cargarMensajes]);

  // Realtime: mismo patrón (canal + postgres_changes sobre RLS) que ya
  // se usaba en el chat de equipo -- si silencié al autor, la propia
  // política de select de mensajes_lideres ya filtra el INSERT antes
  // de que llegue acá, no hace falta repetirlo del lado del cliente.
  useEffect(() => {
    const canal = supabase
      .channel("chat-lideres-grupal")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes_lideres" }, async (payload) => {
        const nuevo = payload.new as MensajeLider;
        const { data } = await supabase
          .from("profiles")
          .select("nick, avatar_url")
          .eq("id", nuevo.autor_id)
          .maybeSingle();
        setMensajes((prev) => [...prev, { ...nuevo, profiles: data ?? null }]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight });
  }, [mensajes]);

  const handleEnviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const contenido = texto.trim();
    if (!contenido) return;

    if (contieneLenguajeInapropiado(contenido)) {
      toast.error("Ese mensaje contiene lenguaje inapropiado.");
      return;
    }

    setEnviando(true);
    const { error } = await supabase.from("mensajes_lideres").insert({ autor_id: user.id, contenido });
    setEnviando(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setTexto("");
  };

  const handleSilenciar = async (usuarioId: string) => {
    if (!user) return;
    const error = await silenciarUsuario(user.id, usuarioId);
    if (error) {
      toast.error(error);
      return;
    }
    setSilenciados((prev) => [...prev, usuarioId]);
    setMensajes((prev) => prev.filter((m) => m.autor_id !== usuarioId));
    toast.success("Ya no verás los mensajes de esta persona en el chat grupal.");
  };

  const handleDejarDeSilenciar = async (usuarioId: string) => {
    const error = await dejarDeSilenciarUsuario(usuarioId);
    if (error) {
      toast.error(error);
      return;
    }
    setSilenciados((prev) => prev.filter((id) => id !== usuarioId));
    cargarMensajes();
  };

  if (cargando) {
    return <p className="tournament-card-meta">Cargando el chat...</p>;
  }

  return (
    <div className="chat-lideres-grupal">
      <div className="chat-lideres-mensajes" ref={listaRef}>
        {mensajes.length === 0 && <p className="tournament-card-meta">Todavía no hay mensajes.</p>}
        {mensajes.map((m) => {
          const autor = extraerAutor(m);
          const esPropio = m.autor_id === user?.id;
          return (
            <div key={m.id} className={`chat-lideres-mensaje ${esPropio ? "es-propio" : ""}`}>
              <Avatar url={autor.avatar_url} nombre={autor.nick} className="chat-lideres-avatar" />
              <div className="chat-lideres-mensaje-cuerpo">
                <div className="chat-lideres-mensaje-cabecera">
                  <span className="chat-lideres-mensaje-nick">{autor.nick ?? "Jugador"}</span>
                  <span className="chat-lideres-mensaje-hora">
                    {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {!esPropio && (
                    <button
                      type="button"
                      className="chat-lideres-silenciar-btn"
                      onClick={() => handleSilenciar(m.autor_id)}
                    >
                      Silenciar
                    </button>
                  )}
                </div>
                <p className="chat-lideres-mensaje-texto">{m.contenido}</p>
              </div>
            </div>
          );
        })}
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

      <button
        type="button"
        className="chat-lideres-silenciados-toggle"
        onClick={() => setMostrarSilenciados((v) => !v)}
      >
        {mostrarSilenciados ? "Ocultar silenciados" : `Silenciados (${silenciados.length})`}
      </button>

      {mostrarSilenciados && (
        <div className="chat-lideres-silenciados-lista">
          {silenciados.length === 0 && <p className="tournament-card-meta">No has silenciado a nadie.</p>}
          {silenciados.map((id) => (
            <SilenciadoItem key={id} usuarioId={id} onDejarDeSilenciar={() => handleDejarDeSilenciar(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SilenciadoItem({ usuarioId, onDejarDeSilenciar }: { usuarioId: string; onDejarDeSilenciar: () => void }) {
  const [nick, setNick] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("nick")
      .eq("id", usuarioId)
      .maybeSingle()
      .then(({ data }) => setNick(data?.nick ?? null));
  }, [usuarioId]);

  return (
    <div className="chat-lideres-silenciado-item">
      <span>{nick ?? "Jugador"}</span>
      <button type="button" className="btn-link" onClick={onDejarDeSilenciar}>
        Dejar de silenciar
      </button>
    </div>
  );
}
