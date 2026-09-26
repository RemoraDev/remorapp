import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { estaHabilitadoChatLideres } from "../lib/chatLideres";
import ChatGrupalLideres from "./ChatGrupalLideres";
import ChatPrivadosLideres from "./ChatPrivadosLideres";
import Logo from "./Logo";

type PestanaChat = "grupal" | "privados";

// Columna derecha del layout de 3 columnas de escritorio (Tauri): para
// quien califica para el chat de líderes (esta_habilitado_chat_lideres()),
// un panel FIJO y persistente -- no una pantalla a la que hay que
// entrar, se ve mientras se navega cualquier parte de la app. Para
// quien no califica, el mismo borde decorativo que la columna
// izquierda (ver EscritorioColumnaLateral.tsx), nunca vacío.
//
// El acceso se reconsulta cada vez que cambia la sesión, igual que en
// ChatLideresPage.tsx: no es un logro guardado, así que alguien que
// deja de calificar simplemente deja de ver el panel la próxima vez
// que este componente se re-evalúa.
export default function EscritorioColumnaDerecha() {
  const { user } = useAuth();
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [habilitado, setHabilitado] = useState(false);
  const [pestana, setPestana] = useState<PestanaChat>("grupal");

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  useEffect(() => {
    if (!esEscritorio || !user) {
      setHabilitado(false);
      return;
    }
    let cancelado = false;
    estaHabilitadoChatLideres().then((valor) => {
      if (!cancelado) setHabilitado(valor);
    });
    return () => {
      cancelado = true;
    };
  }, [esEscritorio, user]);

  if (!esEscritorio) return null;

  if (!habilitado) {
    return (
      <div className="escritorio-columna-lateral escritorio-columna-derecha" aria-hidden="true">
        <Logo />
      </div>
    );
  }

  return (
    <aside className="escritorio-chat-fijo">
      <div className="chat-lideres-tabs escritorio-chat-fijo-tabs">
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
      <div className="escritorio-chat-fijo-cuerpo">
        {pestana === "grupal" ? <ChatGrupalLideres /> : <ChatPrivadosLideres />}
      </div>
    </aside>
  );
}
