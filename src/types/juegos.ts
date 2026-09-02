// Perfiles de juego agnósticos (migración 034) -- hoy solo StarCraft
// II tiene UI real, pero la estructura de base ya soporta más juegos
// sin tocar profiles ni agregar columnas nuevas.
export interface CatalogoJuegoRow {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface PerfilJuegoRow {
  id: string;
  user_id: string;
  juego_id: string;
  datos: Record<string, unknown>;
  created_at: string;
}

// Forma de "datos" para el juego 'StarCraft II' puntualmente -- cada
// juego futuro define la suya propia, sin afectar a esta.
export type RazaSc2 = "Terran" | "Zerg" | "Protoss";

export const RAZA_SC2_OPTIONS: RazaSc2[] = ["Terran", "Zerg", "Protoss"];

export interface DatosSc2 {
  raza_principal: RazaSc2 | null;
  raza_secundaria: RazaSc2 | null;
}
