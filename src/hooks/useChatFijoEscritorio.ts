import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { estaHabilitadoChatLideres, tengoConversacionPrivadaActiva } from "../lib/chatLideres";

// "completo": califica para el chat de líderes en general (líder de
// clan/staff/dueño) -- ve el panel fijo con las dos pestañas (grupal +
// privados). "privados": no califica en general, pero tiene una
// conversación privada activa (un admin/staff/dueño le escribió
// primero) -- ve el panel fijo, pero solo con esa conversación, sin
// pestaña de chat grupal ni forma de iniciar otras (mismo criterio que
// ChatLideresPage.tsx). null: en la web/celular, o en escritorio sin
// ninguno de los dos casos anteriores.
export type ModoChatFijoEscritorio = "completo" | "privados" | null;

// Reutilizado por BottomNav.tsx: cuando esto NO da null, el botón
// "Chat" de la barra inferior no cumple ninguna función (el chat ya
// está siempre visible al costado), así que ese lugar pasa a mostrar
// "Inicio" en su lugar.
export default function useChatFijoEscritorio(): ModoChatFijoEscritorio {
  const { user } = useAuth();
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [habilitado, setHabilitado] = useState(false);
  const [conversacionActiva, setConversacionActiva] = useState(false);

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  useEffect(() => {
    if (!esEscritorio || !user) {
      setHabilitado(false);
      setConversacionActiva(false);
      return;
    }
    let cancelado = false;
    Promise.all([estaHabilitadoChatLideres(), tengoConversacionPrivadaActiva()]).then(([hab, conv]) => {
      if (!cancelado) {
        setHabilitado(hab);
        setConversacionActiva(conv);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [esEscritorio, user]);

  if (!esEscritorio) return null;
  if (habilitado) return "completo";
  if (conversacionActiva) return "privados";
  return null;
}
