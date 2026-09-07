// Fila devuelta por clan_wars_proximas() (migración 059, extendida en
// la 064 con liga_nombre/division_nombre y en la 066 con status y los
// datos de revelación del lineup): versión pública de una Clan War
// programada, sin las columnas privadas del lineup ni el motivo de
// rechazo -- mismo espíritu que overlay_clan_war().
export interface ClanWarProxima {
  id: string;
  fecha_hora_cet: string;
  formato: "simple" | "wtl";
  status: "aceptada" | "en_curso";
  challenger_nombre: string;
  challenger_tag: string;
  challenger_logo_url: string | null;
  challenged_nombre: string;
  challenged_tag: string;
  challenged_logo_url: string | null;
  // Null cuando la Clan War no tiene una temporada de torneo asociada
  // -- es el caso normal para la inmensa mayoría de las Clan Wars.
  liga_nombre: string | null;
  division_nombre: string | null;
  // Migración 066: el lineup del rival queda oculto hasta que se
  // revela -- ver revelado_lineup_cw() en la base. La tarjeta de
  // Inicio solo es clickeable cuando lineup_revelado es true.
  lineup_visto_bueno_challenger: boolean;
  lineup_visto_bueno_challenged: boolean;
  lineup_revelado: boolean;
}

// Un jugador dentro del lineup revelado -- raza null cuando no la
// cargó en su perfil de StarCraft II, o cuando es un jugador temporal
// (sin cuenta real, ver profile.ts/PerfilJuegoSc2).
export interface LineupPublicoJugador {
  nombre: string;
  posicion: 1 | 2 | 3 | null;
  es_temporal: boolean;
  raza: "Terran" | "Zerg" | "Protoss" | null;
}

// Devuelto por lineup_publico_clan_war() (migración 066, extendida en
// la 067 con raza y fondo) -- la vista a la que lleva la tarjeta de
// Inicio, una vez que el lineup ya se reveló.
export interface LineupPublicoClanWar {
  revelado: boolean;
  formato: "simple" | "wtl";
  status: string;
  fecha_hora_cet: string;
  challenger: { nombre: string; tag: string; logo_url: string | null };
  challenged: { nombre: string; tag: string; logo_url: string | null };
  caster_nombre: string | null;
  caster_link: string | null;
  // Migración 067: fondo de imagen (catalogo_fondos_lineup) tiene
  // prioridad sobre el clásico cuando está presente -- son mutuamente
  // excluyentes, ver cambiar_fondo_lineup_cw()/cambiar_fondo_lineup_imagen_cw().
  fondo_clasico: "ninguno" | "campo_estrellas" | "nebulosa" | "constelacion" | "vortice";
  fondo_imagen_url: string | null;
  lineup_challenger: LineupPublicoJugador[] | null;
  lineup_challenged: LineupPublicoJugador[] | null;
}

// Fila del catálogo de fondos de imagen, administrable desde /admin
// (migración 067).
export interface FondoLineupImagen {
  id: string;
  nombre: string;
  image_url: string;
  created_at: string;
}
