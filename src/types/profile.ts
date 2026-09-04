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

// Forma del avatar del usuario (migración 031) -- se respeta en
// cualquier lugar donde se muestre SU avatar (header, listas de
// participantes, miembros de equipo). No afecta a logos de equipo.
export type AvatarForma = "cuadrado" | "redondo";

export const AVATAR_FORMA_OPTIONS: { value: AvatarForma; label: string }[] = [
  { value: "cuadrado", label: "Cuadrado" },
  { value: "redondo", label: "Redondo" },
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

// Un link de transmisión (migración 035) -- "plataforma" es texto
// libre (Twitch, YouTube, Kick, etc.), no un enum cerrado.
export interface LinkTransmision {
  plataforma: string;
  url: string;
}

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
  // Sistema de MMR y ligas oficiales de StarCraft II (migración 020,
  // reemplaza al de experiencia/nivel de la migración 013). mmr_1v1 y
  // mmr_equipos son ratings separados del jugador; banca_rota,
  // nivel_1v1, liga_1v1 y liga_equipos se recalculan solos en la base
  // a partir de esos dos MMR (columnas GENERATED) -- nunca se mandan
  // a mano. nivel_1v1 solo existe para 1v1 por ahora (el de equipos
  // se define en otra fase).
  mmr_1v1: number;
  mmr_equipos: number;
  banca_rota: boolean;
  nivel_1v1: number;
  liga_1v1: string;
  liga_equipos: string;
  // Sistema de Valentía y Responsabilidad -- Fase 1 (migración 024),
  // conectado a Clan Wars. responsabilidad_torneos todavía no se
  // mueve -- eso se conecta con las reglas de asistencia a torneos,
  // en otra fase. poco_confiable es el nombre interno de la columna;
  // el texto visible siempre es "Poco Responsable".
  valentia_jugador: number;
  responsabilidad_cw: number;
  responsabilidad_torneos: number;
  poco_confiable: boolean;
  // Sala de la Fama (migración 030): cuándo llegó por primera vez a
  // Gran Maestro -- null si nunca. Se llena sola, nunca a mano.
  gran_maestro_alcanzado_en: string | null;
  avatar_url: string | null;
  avatar_forma: AvatarForma;
  banner_url: string | null;
  bio: string | null;
  // Links de transmisión (migración 035): array libre de {plataforma,
  // url} -- Twitch, YouTube, Kick, etc. a la vez, sin límite.
  links_transmision: LinkTransmision[];
  // Horario habitual de transmisión (migración 036): texto libre.
  horario_stream: string | null;
  // Carisma (migración 036, rediseñado en la 049): contador de puntos
  // que solo sube, sin tope -- +10 al crear un torneo o proponer una
  // Clan War (si es caster), +1 por like recibido. Ver carisma_log.
  carisma: number;
  cuenta_validada: boolean;
  // Cuenta suspendida desde /admin: no puede crear torneos ni
  // inscribirse (bloqueado también a nivel de RLS, no solo acá).
  suspendido: boolean;
  // Skin de avatar activa (migración 052): id de catalogo_skins_avatar,
  // null si no tiene ninguna. Es solo un puntero -- el catálogo en sí
  // (nombre/descripcion/clave) es privado, exclusivo del dueño de la
  // plataforma por ahora.
  skin_avatar_activa: string | null;
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
