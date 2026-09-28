import type { FondoLineup } from "./teams";

// Migración 127 (clasico/cascada) y 130 (enfrentamientos/poster):
// maqueta con la que se arma la tarjeta del lineup -- "clasico"
// (equipos lado a lado, una fila por enfrentamiento), "cascada" (un
// equipo arriba en fila horizontal, marcador grande al centro, el
// otro equipo abajo), "enfrentamientos" (un duelo 1 vs 1 por tarjeta
// chica, lado a lado) o "poster" (split vertical al estilo cartel de
// versus, un "VS" grande al centro). Ver TarjetaLineupClanWar.tsx.
export type EstructuraLineup = "clasico" | "cascada" | "enfrentamientos" | "poster";

// Migración 129: relación de aspecto de la tarjeta -- "16:9" es el
// default de siempre, pensado sobre todo para quien usa
// /overlay/clan-war/:id como fuente de navegador en OBS.
export type AspectoLineup = "4:3" | "16:9" | "16:10" | "21:9";

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
  // Migración 125: stream propio de cada equipo (reemplaza al campo
  // compartido caster_nombre/caster_link para la gestión diaria) --
  // null cuando ese equipo no cargó nada, se muestra solo en ese caso.
  challenger_stream_link: string | null;
  challenger_stream_delay: boolean | null;
  challenged_stream_link: string | null;
  challenged_stream_delay: boolean | null;
  // Migración 067: fondo de imagen (catalogo_fondos_lineup) tiene
  // prioridad sobre el clásico cuando está presente -- son mutuamente
  // excluyentes, ver cambiar_fondo_lineup_cw()/cambiar_fondo_lineup_imagen_cw().
  fondo_clasico: FondoLineup;
  fondo_imagen_url: string | null;
  estructura: EstructuraLineup;
  aspecto: AspectoLineup;
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

// Devuelto por lineup_editor_clan_war() (migración 123): todo lo que
// necesita el editor de la página pública del evento (/clan-war/:id)
// para el capitán/dueño que llama -- mi lado del lineup completo, más
// el roster elegible y los temporales para el formulario de "agregar".
// Del lado rival solo trae posición + si esa posición ya tiene a
// alguien anotado, nunca el nombre, salvo que lineup_revelado sea true.
export interface LineupEditorJugadorElegible {
  jugador_id: string;
  nombre: string;
  es_mercenario: boolean;
  es_aliado: boolean;
}

export interface LineupEditorTemporal {
  id: string;
  nick_temporal: string;
}

export interface LineupEditorEntryPropio {
  id: string;
  nombre: string;
  posicion: 1 | 2 | 3 | null;
  es_temporal: boolean;
  es_suplente: boolean;
  link_verificacion: string | null;
}

// Del lado rival, antes de revelarse: nombre/es_temporal/link_verificacion
// vienen en null aunque la fila exista -- solo posicion/es_suplente son
// siempre reales (así se sabe "ocupado" sin saber quién).
export interface LineupEditorEntryRival {
  posicion: 1 | 2 | 3 | null;
  es_suplente: boolean;
  nombre: string | null;
  es_temporal: boolean | null;
  link_verificacion: string | null;
}

export interface LineupEditorClanWar {
  mi_team_id: string;
  soy_challenger: boolean;
  rival_team_id: string;
  rival_nombre: string;
  formato: "simple" | "wtl";
  status: string;
  es_de_torneo: boolean;
  jugadores_por_set: number;
  fondo_lineup: FondoLineup;
  fondo_lineup_imagen_id: string | null;
  estructura_lineup: EstructuraLineup;
  aspecto_lineup: AspectoLineup;
  fecha_hora_cet: string;
  lineup_plazo_extendido_hasta: string | null;
  ventana_revelacion_minutos: number;
  lineup_revelado: boolean;
  lineup_aprobado: boolean;
  mi_visto_bueno: boolean;
  visto_bueno_rival: boolean;
  // Migración 125: stream propio -- editable acá mismo; el del rival
  // es de solo lectura (visible siempre para el editor, a diferencia
  // de la tarjeta pública, que lo omite si no está cargado).
  mi_stream_link: string | null;
  mi_stream_delay: boolean | null;
  rival_stream_link: string | null;
  rival_stream_delay: boolean | null;
  roster_elegible: LineupEditorJugadorElegible[];
  temporales_propios: LineupEditorTemporal[];
  lineup_propio: LineupEditorEntryPropio[];
  lineup_rival: LineupEditorEntryRival[];
}
