import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import useChatFijoEscritorio from "../hooks/useChatFijoEscritorio";
import ChatGrupalLideres from "./ChatGrupalLideres";
import ChatPrivadosLideres from "./ChatPrivadosLideres";
import Logo from "./Logo";
import HexPattern from "./HexPattern";

type PestanaChat = "grupal" | "privados";

// Columna derecha del layout de 3 columnas de escritorio (Tauri): para
// quien califica para el chat de líderes (ver useChatFijoEscritorio),
// un panel FIJO y persistente -- no una pantalla a la que hay que
// entrar, se ve mientras se navega cualquier parte de la app. Para
// quien no califica, el mismo borde decorativo que la columna
// izquierda (ver EscritorioColumnaLateral.tsx), nunca vacío.
export default function EscritorioColumnaDerecha() {
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [pestana, setPestana] = useState<PestanaChat>("grupal");
  const habilitado = useChatFijoEscritorio();

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  if (!esEscritorio) return null;

  if (!habilitado) {
    return (
      <div className="escritorio-columna-lateral escritorio-columna-derecha" aria-hidden="true">
        <HexPattern id="escritorio-hex-der" className="hex-pattern escritorio-columna-hex" />
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
