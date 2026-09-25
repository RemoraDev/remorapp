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
