// Coincide con el check constraint de profiles.perfil_tipo en
// supabase/schema_tournaments.sql. Nadie lo elige a mano (migración
// 011): 'jugador' es el default, y pasa solo a 'lider_clan' al crear
// un equipo (ver crear_membresia_owner() en la base). "Caster" no es
// un valor de perfil_tipo -- es la columna es_caster, independiente y
// no excluyente (ver Profile.es_caster más abajo).
export type PerfilTipo = "jugador" | "lider_clan";

export const PERFIL_TIPO_OPTIONS: { value: PerfilTipo; label: string }[] = [
  { value: "jugador", label: "Jugador" },
  { value: "lider_clan", label: "Líder de clan" },
];

// Rango competitivo del jugador -- opcional, no bloqueante. Coincide
// con el check constraint de profiles.liga.
export type Liga =
  | "Bronce 3"
  | "Bronce 2"
  | "Bronce 1"
  | "Plata 3"
  | "Plata 2"
  | "Plata 1"
  | "Oro 3"
  | "Oro 2"
  | "Oro 1"
  | "Platino 3"
  | "Platino 2"
  | "Platino 1"
  | "Diamante 3"
  | "Diamante 2"
  | "Diamante 1"
  | "Master 3"
  | "Master 2"
  | "Master 1"
  | "Gran Maestro";

// Ya son el label -- no hace falta un value/label separado como en
// las otras opciones.
export const LIGA_OPTIONS: Liga[] = [
  "Bronce 3",
  "Bronce 2",
  "Bronce 1",
  "Plata 3",
  "Plata 2",
  "Plata 1",
  "Oro 3",
  "Oro 2",
  "Oro 1",
  "Platino 3",
  "Platino 2",
  "Platino 1",
  "Diamante 3",
  "Diamante 2",
  "Diamante 1",
  "Master 3",
  "Master 2",
  "Master 1",
  "Gran Maestro",
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

// Coincide con la fila completa de profiles tras la migración 004.
export interface Profile {
  id: string;
  nombre: string | null;
  perfil_tipo: PerfilTipo;
  // Independiente de perfil_tipo: alguien puede ser líder de clan Y
  // caster a la vez, no son excluyentes. Lo prende/apaga el propio
  // usuario en /perfil cuando quiera.
  es_caster: boolean;
  es_admin: boolean;
  nick: string | null;
  unique_id: string;
  country: Country | null;
  sc2_region: Sc2Region | null;
  sc2_id: string | null;
  liga: Liga | null;
  // Sistema de experiencia (migración 013, Fase A): xp se acumula
  // jugando torneos, nivel se recalcula solo en la base a partir de
  // xp (columna GENERATED) -- nunca se manda a mano.
  xp: number;
  nivel: number;
  avatar_url: string | null;
  bio: string | null;
  cuenta_validada: boolean;
  // Cuenta suspendida desde /admin: no puede crear torneos ni
  // inscribirse (bloqueado también a nivel de RLS, no solo acá).
  suspendido: boolean;
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
