// Títulos Padre/Hijo -- entre clanes y entre jugadores 1v1 (migración
// 026). Coincide con los check constraints de titulos_padre_hijo en
// supabase/schema_tournaments.sql.
export type TituloTipo = "clan" | "jugador";
export type TituloStatus = "pendiente" | "activo" | "expirado" | "rechazado";

export interface TituloPadreHijoRow {
  id: string;
  tipo: TituloTipo;
  // team_id o profile_id según tipo -- polimórfico, sin foreign key.
  retador_id: string;
  retado_id: string;
  duracion_dias: number;
  caster_nombre: string | null;
  caster_link: string | null;
  status: TituloStatus;
  // Aceptar no cambia el status (sigue 'pendiente' hasta el
  // enfrentamiento real) -- esta es la única forma de saber si ya se
  // acordó.
  aceptado: boolean;
  ganador_id: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  created_at: string;
}

// Fila que devuelve titulos_activos_de() (RPC pública) -- ya resuelta
// desde el punto de vista de un equipo o jugador puntual: quién es el
// otro lado, y si soy Padre o Hijo.
export interface TituloActivo {
  id: string;
  otro_id: string;
  soy_padre: boolean;
  fecha_fin: string;
}

export function diasRestantes(fechaFin: string): number {
  const ms = new Date(fechaFin).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// Fila que devuelve titulos_activos_todos() (RPC pública, Sala de la
// Fama, migración 030) -- todos los títulos activos de un tipo de una
// sola vez, sin resolver todavía (el frontend decide, para cada
// equipo/jugador, cuál de estos lo involucra).
export interface TituloActivoTodos {
  id: string;
  retador_id: string;
  retado_id: string;
  ganador_id: string;
  duracion_dias: number;
  fecha_inicio: string;
  fecha_fin: string;
}
