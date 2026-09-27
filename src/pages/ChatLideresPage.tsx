import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { estaHabilitadoChatLideres, tengoConversacionPrivadaActiva } from "../lib/chatLideres";
import ChatGrupalLideres from "../components/ChatGrupalLideres";
import ChatPrivadosLideres from "../components/ChatPrivadosLideres";

type PestanaChat = "grupal" | "privados";

// Migración 105: chat de líderes -- el acceso se reconsulta cada vez
// que se entra a esta página (esta_habilitado_chat_lideres() no es un
// logro guardado), así que alguien que hoy califica y mañana no,
// simplemente deja de poder abrir esto la próxima vez que lo intente.
//
// Migración 118: alguien que NO califica en general puede, aun así,
// tener una conversación privada activa -- porque un admin/staff/dueño
// le escribió primero (ver la política de insert en la base). En ese
// caso se muestra SOLO la pestaña de Mensajes privados, sin Chat
// grupal ni la posibilidad de iniciar conversaciones nuevas (el
// buscador de buscar_lideres_chat() ya le devuelve vacío igual).
export default function ChatLideresPage() {
  const { user, loading } = useAuth();
  const [verificando, setVerificando] = useState(true);
  const [habilitado, setHabilitado] = useState(false);
  const [conversacionActiva, setConversacionActiva] = useState(false);
  const [pestana, setPestana] = useState<PestanaChat>("grupal");

  useEffect(() => {
    if (!user) {
      setVerificando(false);
      return;
    }
    setVerificando(true);
    Promise.all([estaHabilitadoChatLideres(), tengoConversacionPrivadaActiva()]).then(([hab, conv]) => {
      setHabilitado(hab);
      setConversacionActiva(conv);
      setPestana(hab ? "grupal" : "privados");
      setVerificando(false);
    });
  }, [user]);

  if (!loading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para ver el chat de líderes</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  if (loading || verificando) {
    return (
      <section className="section section-page">
        <p className="tournament-card-meta">Cargando...</p>
      </section>
    );
  }

  if (!habilitado && !conversacionActiva) {
    return (
      <section className="page-placeholder">
        <h1>Chat de líderes</h1>
        <p>Necesitas ser líder de un clan con 15 o más jugadores reales para acceder a este chat.</p>
      </section>
    );
  }

  return (
    <section className="section section-page chat-lideres-page">
      <h1 className="section-title">Chat de líderes</h1>

      {habilitado && (
        <div className="chat-lideres-tabs">
          <button
            type="button"
            className={`chat-lideres-tab ${pestana === "grupal" ? "is-active" : ""}`}
            onClick={() => setPestana("grupal")}
          >
            Chat grupal
          </button>
          <button
            type="button"
            className={`chat-lideres-tab ${pestana === "privados" ? "is-active" : ""}`}
            onClick={() => setPestana("privados")}
          >
            Mensajes privados
          </button>
        </div>
      )}

      {pestana === "grupal" ? <ChatGrupalLideres /> : <ChatPrivadosLideres />}
    </section>
  );
}
