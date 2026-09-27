import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { estaHabilitadoChatLideres } from "../lib/chatLideres";

// true cuando la app corre en escritorio (Tauri) Y el usuario califica
// para el chat de líderes -- exactamente cuándo la columna derecha
// muestra el panel de chat FIJO (ver EscritorioColumnaDerecha.tsx).
// Reutilizado por BottomNav.tsx: cuando esto da true, el botón "Chat"
// de la barra inferior no cumple ninguna función (el chat ya está
// siempre visible al costado), así que ese lugar pasa a mostrar
// "Inicio" en su lugar.
export default function useChatFijoEscritorio(): boolean {
  const { user } = useAuth();
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [habilitado, setHabilitado] = useState(false);

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

  return esEscritorio && habilitado;
}
