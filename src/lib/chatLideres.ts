import { supabase } from "./supabaseClient";

export interface MensajeLider {
  id: string;
  autor_id: string;
  contenido: string;
  created_at: string;
}

export interface MensajePrivadoLider {
  id: string;
  de_usuario_id: string;
  para_usuario_id: string;
  contenido: string;
  created_at: string;
  leido: boolean;
}

export interface ConversacionPrivadaLider {
  otro_usuario_id: string;
  otro_nick: string | null;
  otro_avatar_url: string | null;
  ultimo_mensaje: string;
  ultimo_mensaje_en: string;
  no_leidos: number;
}

export interface LiderBusqueda {
  id: string;
  nick: string | null;
  unique_id: string | null;
  avatar_url: string | null;
}

// El acceso se reevalúa en cada llamada (la función en la base no
// guarda ningún estado): si el equipo bajó de 15 miembros reales
// desde la última vez que se consultó, acá ya vuelve false.
export async function estaHabilitadoChatLideres(): Promise<boolean> {
  const { data, error } = await supabase.rpc("esta_habilitado_chat_lideres");
  if (error) {
    console.error("Error consultando esta_habilitado_chat_lideres:", error);
    return false;
  }
  return data === true;
}

export async function buscarLideresChat(query: string): Promise<LiderBusqueda[]> {
  const { data, error } = await supabase.rpc("buscar_lideres_chat", { p_query: query });
  if (error) {
    console.error("Error en buscar_lideres_chat:", error);
    return [];
  }
  return (data ?? []) as LiderBusqueda[];
}

export async function obtenerConversacionesChatLideres(): Promise<ConversacionPrivadaLider[]> {
  const { data, error } = await supabase.rpc("mis_conversaciones_chat_lideres");
  if (error) {
    console.error("Error en mis_conversaciones_chat_lideres:", error);
    return [];
  }
  return (data ?? []) as ConversacionPrivadaLider[];
}

export async function obtenerUsuariosSilenciados(): Promise<string[]> {
  const { data, error } = await supabase.from("usuarios_silenciados").select("usuario_silenciado_id");
  if (error) {
    console.error("Error cargando usuarios silenciados:", error);
    return [];
  }
  return (data ?? []).map((fila) => fila.usuario_silenciado_id as string);
}

export async function silenciarUsuario(miId: string, usuarioId: string): Promise<string | null> {
  const { error } = await supabase
    .from("usuarios_silenciados")
    .insert({ silenciado_por: miId, usuario_silenciado_id: usuarioId });
  return error?.message ?? null;
}

export async function dejarDeSilenciarUsuario(usuarioId: string): Promise<string | null> {
  const { error } = await supabase.from("usuarios_silenciados").delete().eq("usuario_silenciado_id", usuarioId);
  return error?.message ?? null;
}

export async function marcarConversacionLeida(miId: string, otroUsuarioId: string): Promise<void> {
  await supabase
    .from("mensajes_privados_lideres")
    .update({ leido: true })
    .eq("de_usuario_id", otroUsuarioId)
    .eq("para_usuario_id", miId)
    .eq("leido", false);
}
