// Coincide con el check constraint de profiles.perfil_tipo en
// supabase/schema_tournaments.sql. Puede ser null: el usuario recién
// registrado todavía no eligió su rol (se elige después en /perfil).
export type PerfilTipo = "jugador" | "caster" | "lider_clan";

export const PERFIL_TIPO_OPTIONS: { value: PerfilTipo; label: string }[] = [
  { value: "jugador", label: "Jugador" },
  { value: "caster", label: "Caster" },
  { value: "lider_clan", label: "Líder de clan" },
];
