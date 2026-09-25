// Tipos que reflejan supabase/migration_102_guerra_de_razas.sql --
// marcador en vivo con temática StarCraft II (Protoss/Terran/Zerg),
// complemento opcional de un torneo.

export type RazaGuerra = "protoss" | "terran" | "zerg";

export type CategoriaGuerra = "3500" | "4000" | "4500" | "5000" | "sin_limite";

export const CATEGORIAS_GUERRA: { value: CategoriaGuerra; label: string }[] = [
  { value: "3500", label: "3500" },
  { value: "4000", label: "4000" },
  { value: "4500", label: "4500" },
  { value: "5000", label: "5000" },
  { value: "sin_limite", label: "Sin límite" },
];

export const RAZAS_GUERRA: { value: RazaGuerra; label: string }[] = [
  { value: "protoss", label: "Protoss" },
  { value: "terran", label: "Terran" },
  { value: "zerg", label: "Zerg" },
];

// Migración 110: a quién se le aplica el brillo neón ("ninguno" es el
// default, sin efecto) y con qué color.
export type EfectoNeon = "ninguno" | "ganador" | "todas";
export type EfectoNeonColor = "cyan" | "magenta" | "dorado";

export const EFECTO_NEON_OPTIONS: { value: EfectoNeon; label: string }[] = [
  { value: "ninguno", label: "Sin efecto" },
  { value: "ganador", label: "Solo la raza que va ganando" },
  { value: "todas", label: "Las 3 razas" },
];

export const EFECTO_NEON_COLOR_OPTIONS: { value: EfectoNeonColor; label: string }[] = [
  { value: "cyan", label: "Cian" },
  { value: "magenta", label: "Magenta" },
  { value: "dorado", label: "Dorado" },
];

export interface GuerraRazasRow {
  id: string;
  tournament_id: string;
  creado_por: string;
  puntos_protoss: number;
  puntos_terran: number;
  puntos_zerg: number;
  imagen_protoss_url: string | null;
  imagen_terran_url: string | null;
  imagen_zerg_url: string | null;
  creado_en: string;
  efecto_neon: EfectoNeon;
  efecto_neon_color: EfectoNeonColor;
}

export interface GuerraRazasJugadorRow {
  id: string;
  guerra_id: string;
  categoria: CategoriaGuerra;
  raza: RazaGuerra;
  nombre: string;
  elegido: boolean;
  creado_en: string;
}
