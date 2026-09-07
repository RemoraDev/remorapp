// Delfin Mode -- chat de texto por equipo (migración 071). Primera
// versión real: solo texto en tiempo real vía Supabase Realtime. La
// voz queda para una fase aparte, todavía sin infraestructura
// definida (LiveKit/Agora).
export interface MensajeEquipoRow {
  id: string;
  team_id: string;
  autor_id: string;
  contenido: string;
  created_at: string;
}
