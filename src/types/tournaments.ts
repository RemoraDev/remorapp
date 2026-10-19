// Tipos que reflejan el esquema de supabase/schema_tournaments.sql.
// Separados de src/types.ts porque ese archivo son los tipos del mock
// de la portada (torneos de ejemplo), no datos reales de Supabase.

// Migración 090: "wtl" es un torneo de eliminación normal donde cada
// cruce del bracket entre dos clanes genera una Clan War real en
// formato WTL (varios jugadores, sets separados), en vez de reportarse
// con el click de siempre. Distinto de 2v2/3v3/4v4, que son duelos de
// clan sencillos (una sola partida por cruce).
export type TorneoFormato = "1v1" | "2v2" | "3v3" | "4v4" | "wtl";

export type TorneoModo =
  | "eliminacion_simple"
  | "eliminacion_doble"
  | "todos_contra_todos"
  | "rey_de_la_colina"
  // Migración 069.
  | "suizo"
  | "tabla_posiciones";

export type TorneoEstado = "abierto" | "en_curso" | "finalizado";

// Migración 040: layout de cajas/líneas de la llave y fondo
// "galáctico" detrás -- independientes entre sí, se combinan.
export type EstiloBracket = "clasico" | "esports" | "starcraft_oficial";
// Migración 174, a pedido del usuario: sumó el catálogo de fondos de
// lineup (ver FondoLineup en types/teams.ts) a los que ya tenía la
// llave -- mismas animaciones, CSS compartido bajo data-fondo-bracket
// (ver halcon.css, junto a cada data-fondo-lineup). Migración 179, a
// pedido del usuario: se recorta a solo 3 -- el resto "se elimina de
// RemorApp" (ver migración 179 en supabase/, sigue reseteando
// cualquier torneo viejo con uno de los valores sacados).
export type FondoBracket = "ninguno" | "estrellas" | "estrellado_2";

// Migración 176, a pedido del usuario: "efectos de líneas" -- antes la
// línea de conexión entre rondas era un extra fijo de los estilos
// "esports"/"starcraft_oficial" (o nada en "clasico"). Ahora es su
// propio selector, independiente del estilo de caja -- se puede
// combinar cualquier estilo de bracket con cualquier efecto de línea
// (o "ninguno", para no mostrar líneas). Migración 179, a pedido del
// usuario: "pulso"/"eléctrico"/"arcoíris" se sacan del catálogo.
export type EstiloLineaBracket = "ninguno" | "laser" | "dorado" | "matrix";

// Migración 179, a pedido del usuario: paleta para personalizar el
// color de la línea elegida -- null es "sin personalizar" (cada
// efecto usa su color de siempre, ver halcon.css). Un hex de esta
// lista pisa ese color por CSS custom property (--linea-color).
export const PALETA_COLOR_LINEA_BRACKET: { value: string; label: string }[] = [
  { value: "#38bdf8", label: "Celeste" },
  { value: "#a78bfa", label: "Violeta" },
  { value: "#f472b6", label: "Rosa" },
  { value: "#f87171", label: "Rojo" },
  { value: "#fb923c", label: "Naranja" },
  { value: "#fde047", label: "Dorado" },
  { value: "#4ade80", label: "Verde" },
  { value: "#ffffff", label: "Blanco" },
];

// Migración 181, a pedido del usuario: misma paleta de arriba, para
// personalizar el color del TEXTO (de los nombres dentro de la llave,
// o del título) en vez del color de la línea -- comparten la lista
// porque son los mismos 8 colores de siempre, con otro nombre para que
// se lea claro en cada selector.
export const PALETA_COLOR_TEXTO_BRACKET = PALETA_COLOR_LINEA_BRACKET;

// Migración 181, a pedido del usuario: "modelos" de la franja con el
// nombre del torneo (solo aplica con estilo "esports", la única que
// muestra esta franja) -- 11 variantes, buscadas e inspiradas en
// gráficas reales de transmisiones de esports (diagonal tipo scoreboard,
// cresta hexagonal, cinta con muescas, marco tipo HUD, glitch, placa
// con remaches, etc.). "diagonal" es la de siempre.
export type EstiloTituloBracket =
  | "diagonal"
  | "hexagonal"
  | "chevron"
  | "subrayado"
  | "marco"
  | "cinta"
  | "glitch"
  | "placa"
  | "gradiente"
  | "minimal"
  | "neon_doble";

export const ESTILO_TITULO_BRACKET_OPTIONS: { value: EstiloTituloBracket; label: string }[] = [
  { value: "diagonal", label: "Diagonal" },
  { value: "hexagonal", label: "Hexagonal" },
  { value: "chevron", label: "Flecha" },
  { value: "subrayado", label: "Subrayado" },
  { value: "marco", label: "Marco HUD" },
  { value: "cinta", label: "Cinta" },
  { value: "glitch", label: "Glitch" },
  { value: "placa", label: "Placa" },
  { value: "gradiente", label: "Gradiente" },
  { value: "minimal", label: "Minimal" },
  { value: "neon_doble", label: "Neón doble" },
];

// Migración 182, a pedido del usuario: qué insignia se muestra junto
// al nombre de cada participante dentro de la llave -- antes era fijo
// (el logo del equipo en torneos por equipo, el avatar en 1v1 estilo
// "esports"). "logo_personal" reproduce ese comportamiento de siempre
// (default, no rompe torneos ya creados); "bandera" usa el país del
// perfil (profiles.country) en torneos 1v1, "banner_clan" usa
// teams.banner_url (el banner 4:1 del equipo) en torneos por equipo, y
// "ninguno" no muestra nada junto al nombre.
export type InsigniaBracket = "ninguno" | "bandera" | "banner_clan" | "logo_personal";

export const INSIGNIA_BRACKET_OPTIONS: { value: InsigniaBracket; label: string }[] = [
  { value: "logo_personal", label: "Logo / avatar" },
  { value: "bandera", label: "Bandera del país" },
  { value: "banner_clan", label: "Banner del clan" },
  { value: "ninguno", label: "Ninguno" },
];

// Migración 177, a pedido del usuario (mismo espíritu que "Estructura"
// del lineup, ver EstructuraLineupPicker.tsx): cómo se arma la llave
// en sí, no solo su piel -- independiente de estilo/fondo/línea.
// "clasico" es el de siempre (columnas de izquierda a derecha).
export type EstructuraBracket = "clasico" | "vertical" | "embudo" | "compacta";

export const ESTRUCTURA_BRACKET_OPTIONS: { value: EstructuraBracket; label: string; desc: string }[] = [
  { value: "clasico", label: "Clásico", desc: "Columnas de izquierda a derecha, una por ronda." },
  { value: "vertical", label: "Vertical", desc: "El mismo árbol, rotado: de arriba hacia abajo." },
  {
    value: "embudo",
    label: "Embudo al centro",
    desc: "Las dos mitades del cuadro convergen hacia el medio, la final queda centrada.",
  },
  { value: "compacta", label: "Compacta", desc: "Lista densa por ronda, sin cajas grandes ni líneas." },
];

export const ESTILO_BRACKET_OPTIONS: { value: EstiloBracket; label: string }[] = [
  { value: "clasico", label: "Clásico" },
  { value: "esports", label: "Esports" },
  { value: "starcraft_oficial", label: "StarCraft Oficial" },
];

export const ESTILO_LINEA_BRACKET_OPTIONS: { value: EstiloLineaBracket; label: string }[] = [
  { value: "ninguno", label: "Ninguno" },
  { value: "laser", label: "Láser" },
  { value: "dorado", label: "Dorado" },
  { value: "matrix", label: "Matrix" },
];

export const FONDO_BRACKET_OPTIONS: { value: FondoBracket; label: string }[] = [
  { value: "ninguno", label: "Ninguno" },
  { value: "estrellas", label: "Estrellas" },
  { value: "estrellado_2", label: "Estrellado 2" },
];

export interface MapRow {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface TournamentRow {
  id: string;
  nombre: string;
  juego: string;
  formato: TorneoFormato;
  modo: TorneoModo;
  publico: boolean;
  pozo_premio: number | null;
  cupos_totales: number;
  cupos_ocupados: number;
  fecha_inicio: string;
  estado: TorneoEstado;
  creador_id: string;
  confirmado_por_staff: boolean;
  creado_en: string;
  // Se llena sola cuando se juega la final de la llave (ver
  // avanzar_ganador() en supabase/migration_006_bracket.sql).
  campeon_participant_id: string | null;
  // Migración 180, a pedido del usuario: cuándo pasó a "finalizado" --
  // un trigger lo completa solo (ver set_finalizado_en_torneo() en la
  // base), sin tocar las varias funciones que ya ponían estado =
  // 'finalizado' por su cuenta (avanzar_ganador, finalizar_leaderboard,
  // etc.).
  finalizado_en: string | null;
  // Migración 046: partido por el tercer lugar entre los perdedores
  // de semifinal, en paralelo a la final. Mismo patrón de llenado que
  // campeon_participant_id, se completa solo cuando se juega.
  tiene_tercer_lugar: boolean;
  tercer_lugar_participant_id: string | null;
  // Migración 101: solo aplica cuando modo = 'eliminacion_doble' -- si
  // el campeón de la llave de perdedores le gana la Gran Final al
  // invicto de ganadores, se juega un partido de reset (default,
  // comportamiento de siempre) o la Gran Final queda como partido único.
  gran_final_con_reset: boolean;
  // Check-in antes de generar la llave (migración 010): mientras está
  // en true, los inscritos pueden confirmar que van a jugar.
  check_in_abierto: boolean;
  estilo_bracket: EstiloBracket;
  fondo_bracket: FondoBracket;
  estilo_linea_bracket: EstiloLineaBracket;
  estructura_bracket: EstructuraBracket;
  color_linea_bracket: string | null;
  estilo_titulo_bracket: EstiloTituloBracket;
  color_texto_bracket: string | null;
  color_texto_titulo_bracket: string | null;
  insignia_bracket: InsigniaBracket;
  // Migración 041: etapa de grupos previa a la llave eliminatoria.
  tiene_fase_grupos: boolean;
  cantidad_grupos: number | null;
  avanzan_por_grupo: number | null;
  fase_actual: "grupos" | "eliminacion";
  // Migración 057: formato de liga "First Stand" -- 7 clanes, fixture
  // round-robin completo (todos contra todos) y playoffs top 4.
  formato_liga: "first_stand" | null;
  puntos_victoria_2_0: number;
  puntos_victoria_2_1: number;
  // Migración 087: formato de las Clan Wars que genera el fixture de
  // liga (First Stand o Todos contra todos) -- "simple" (partida por
  // partida) o "wtl" (3 sets fijos por posición), esta última solo
  // disponible en 3v3.
  formato_clan_war: "simple" | "wtl";
  // Migración 089: minutos antes de fecha_hora_cet en que se revela y
  // se traba la edición del lineup de cada Clan War de este torneo
  // (antes fijo en 30 para todos, ver plazo_edicion_lineup_cw()).
  ventana_revelacion_minutos: number;
  // Migración 090: solo aplican a un torneo formato "wtl" -- cuántos
  // jugadores por set (posiciones del lineup) y cuántos mapas gana
  // cada set. El resto de los formatos WTL (First Stand, Todos contra
  // todos) siguen fijos en 3 y 2 por default, sin exponer el campo.
  jugadores_por_set: number;
  mapas_por_set: number;
  // Migración 060: liga y división para el ranking de clanes --
  // independiente de formato_liga (que es el formato de competencia,
  // no la liga). division_id, si está elegida, siempre pertenece a
  // liga_id (validado en la base por un trigger).
  liga_id: string | null;
  division_id: string | null;
  // Migración 114: solo cuenta para el Ranking de clanes/jugadores si
  // liga_id no es null Y esta columna está en true -- el staff, un
  // admin o el dueño de la plataforma la aprueban a mano desde el
  // Panel de Administración (pestaña "Torneos"). Default false,
  // incluso para torneos ya existentes.
  aprobado_para_ranking: boolean;
  // Migración 069: Suizo -- si el organizador no la fija a mano al
  // crear el torneo, generar_torneo_suizo() la calcula sola.
  swiss_rondas_totales: number | null;
  // Migración 069: opciones avanzadas del formulario de creación.
  mostrar_nombres_ronda_personalizados: boolean;
  ocultar_numeros_semilla: boolean;
  ocultar_bracket_publico: boolean;
  reglas_semillas: "aleatorio" | "tradicional";
  permite_autoreporte: boolean;
  excluido_de_busqueda: boolean;
  mostrar_posiciones: boolean;
  // Migración 095: límite de anticipación de 60 días para fecha_inicio,
  // extensible solo por un administrador (admin_extender_plazo_torneo()).
  plazo_extendido_por: string | null;
  plazo_extendido_en: string | null;
  // Migración 095: vencimiento automático de torneos sin actividad --
  // ver evaluar_vencimiento_torneo() y reactivar_torneo_candidato().
  candidato_eliminacion_desde: string | null;
  ultima_reactivacion_en: string | null;
  // Migración 144: reglamento en PDF, opcional -- subido en cualquier
  // momento desde el Panel de organizador, mostrado embebido con
  // PDF.js (ver VisorPdf.tsx).
  pdf_reglamento_url: string | null;
}

// Migración 041: etapa de grupos.
export interface TournamentGroupRow {
  id: string;
  tournament_id: string;
  nombre: string;
  created_at: string;
}

export interface TournamentGroupMatchRow {
  id: string;
  group_id: string;
  participant1_id: string;
  // Migración 085: null es un bye real (Suizo con cantidad impar de
  // inscritos) -- un partido así ya nace con status "jugado" y
  // ganador_id = participant1_id, no es un hueco esperando resultado.
  participant2_id: string | null;
  ganador_id: string | null;
  status: "pendiente" | "jugado";
  // Migración 057: jornada del fixture de First Stand (1 a 7). Queda
  // en null para la etapa de grupos "clásica" (varios grupos), que no
  // organiza sus partidos por jornada.
  jornada: number | null;
  // Migración 057: resultado detallado (0, 1 o 2 mapas ganados) para
  // distinguir un 2-0 de un 2-1 -- necesario para el sistema de
  // puntos de First Stand. Queda en null para partidos reportados sin
  // este detalle.
  resultado_participant1: number | null;
  resultado_participant2: number | null;
  // Migración 083: en un torneo de liga por equipos, este partido se
  // juega como una Clan War real (lineup, check-in, aprobación de los
  // dos capitanes) -- no null significa que el resultado se carga
  // desde ahí, no con el botón "Ganó X" de siempre.
  clan_war_id: string | null;
}

// Resultado de la función posiciones_grupos() -- una fila por
// participante, ya ordenada (puntos desc, diferencia de mapas como
// desempate, orden de inscripción como último desempate).
export interface PosicionGrupo {
  group_id: string;
  group_nombre: string;
  participant_id: string;
  ganados: number;
  // Migración 083: solo puede ser mayor a 0 en un torneo de liga por
  // equipos (Clan War formato simple, que sí admite empate) -- en
  // cualquier otro modo siempre da 0.
  empatados: number;
  jugados: number;
  // Migración 057: puntos según puntos_victoria_2_0/puntos_victoria_2_1
  // del torneo, y diferencia de mapas ganados/perdidos como desempate.
  puntos: number;
  dif_mapas: number;
  inscrito_en: string;
}

export interface TournamentMapRow {
  id: string;
  tournament_id: string;
  map_id: string;
  es_veteable: boolean;
  vetado: boolean;
}

// user_id y team_id son mutuamente excluyentes (ver migración 009):
// en un torneo 1v1 se inscribe un jugador (user_id), en uno 2v2/3v3/4v4
// se inscribe un equipo completo (team_id) -- nunca los dos juntos.
export interface TournamentParticipantRow {
  id: string;
  tournament_id: string;
  user_id: string | null;
  team_id: string | null;
  inscrito_en: string;
  checked_in: boolean;
  checked_in_at: string | null;
  // Migración 069: solo tiene sentido en un torneo modo "tabla_posiciones"
  // -- el organizador lo carga directo, sin partidos de por medio.
  puntos_leaderboard: number;
}

export interface TournamentResultRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  gano: boolean;
  puntaje: number | null;
  creado_en: string;
}

// Migración 109: fila devuelta por eventos_publicos() -- une torneo
// por ligas, Race War y Clan War Amistosa en un solo listado. Los
// campos que no aplican a un tipo dado vienen null (formato/modo/cupos
// /pozo_premio son propios de "torneo" nada más).
export type EventoTipo = "torneo" | "race_war" | "clan_war_amistosa";

export interface EventoPublico {
  tipo: EventoTipo;
  id: string;
  titulo: string;
  formato: TorneoFormato | null;
  modo: TorneoModo | null;
  fecha: string;
  cupos_totales: number | null;
  cupos_ocupados: number | null;
  pozo_premio: number | null;
}
