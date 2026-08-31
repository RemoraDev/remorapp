// Coincide con el check constraint de profiles.perfil_tipo en
// supabase/schema_tournaments.sql. Puede ser null: el usuario recién
// registrado todavía no eligió su rol (se elige después en /perfil).
export type PerfilTipo = "jugador" | "caster" | "lider_clan";

export const PERFIL_TIPO_OPTIONS: { value: PerfilTipo; label: string }[] = [
  { value: "jugador", label: "Jugador" },
  { value: "caster", label: "Caster" },
  { value: "lider_clan", label: "Líder de clan" },
];

// País del jugador (de dónde es), no el servidor de juego al que se
// conecta -- ese es sc2_region. Valores guardados en snake_case sin
// tildes para que no haya líos de comparación/codificación; el label
// es lo que se muestra en pantalla.
export type Country = "chile" | "guatemala" | "puerto_rico" | "argentina" | "peru" | "bolivia";

export const COUNTRY_OPTIONS: { value: Country; label: string }[] = [
  { value: "chile", label: "Chile" },
  { value: "guatemala", label: "Guatemala" },
  { value: "puerto_rico", label: "Puerto Rico" },
  { value: "argentina", label: "Argentina" },
  { value: "peru", label: "Perú" },
  { value: "bolivia", label: "Bolivia" },
];

// Servidor real de StarCraft II al que se conecta el jugador. Lo elige
// libremente el propio jugador (no se detecta por IP) -- sirve para
// más adelante armar torneos entre servidores con distintos horarios.
export type Sc2Region = "america" | "europe" | "asia";

export const SC2_REGION_OPTIONS: { value: Sc2Region; label: string }[] = [
  { value: "america", label: "América" },
  { value: "europe", label: "Europa" },
  { value: "asia", label: "Asia" },
];

// Coincide con la fila completa de profiles tras la migración 003.
export interface Profile {
  id: string;
  nombre: string | null;
  perfil_tipo: PerfilTipo | null;
  es_admin: boolean;
  nick: string | null;
  unique_id: string;
  country: Country | null;
  sc2_region: Sc2Region | null;
  sc2_id: string | null;
  avatar_url: string | null;
  bio: string | null;
  cuenta_validada: boolean;
}

// Los 4 campos que exige el gate de /perfil. Se usa tanto para
// mostrar el aviso bloqueante como para decidir si conviene mostrar
// el resto de la app como "cuenta validada".
export function perfilEstaCompleto(profile: Profile | null): boolean {
  if (!profile) return false;
  return (
    profile.nick !== null &&
    profile.country !== null &&
    profile.sc2_region !== null &&
    profile.sc2_id !== null
  );
}
