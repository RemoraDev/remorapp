import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import useChatFijoEscritorio from "../hooks/useChatFijoEscritorio";
import ChatGrupalLideres from "./ChatGrupalLideres";
import ChatPrivadosLideres from "./ChatPrivadosLideres";
import HexPattern from "./HexPattern";

type PestanaChat = "grupal" | "privados";

// Columna derecha del layout de 3 columnas de escritorio (Tauri): para
// quien califica para el chat de líderes en general, un panel FIJO y
// persistente con las dos pestañas -- no una pantalla a la que hay que
// entrar, se ve mientras se navega cualquier parte de la app. Para
// quien no califica pero tiene una conversación privada activa (un
// admin/staff/dueño le escribió primero), el mismo panel fijo, pero
// solo con esa conversación -- así el dueño puede usar esto para
// atender consultas de cualquier jugador, no solo de otros líderes.
// Para quien no tiene ni una cosa ni la otra, el mismo borde
// decorativo que la columna izquierda (ver EscritorioColumnaLateral.tsx),
// nunca vacío.
export default function EscritorioColumnaDerecha() {
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [pestana, setPestana] = useState<PestanaChat>("grupal");
  const modo = useChatFijoEscritorio();

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  if (!esEscritorio) return null;

  if (modo === null) {
    return (
      <div className="escritorio-columna-lateral escritorio-columna-derecha" aria-hidden="true">
        <div className="escritorio-columna-glow" />
        <HexPattern id="escritorio-hex-der" className="hex-pattern escritorio-columna-hex" />
      </div>
    );
  }

  if (modo === "privados") {
    return (
      <aside className="escritorio-chat-fijo">
        <div className="escritorio-chat-fijo-cuerpo">
          <ChatPrivadosLideres />
        </div>
      </aside>
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
