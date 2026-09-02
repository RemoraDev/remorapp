import type { Sc2Region } from "./profile";

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  sc2_regions: Sc2Region[];
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  // Sistema de MMR y ligas oficiales de StarCraft II (migración 020,
  // reemplaza al de experiencia/nivel de la migración 013). mmr es el
  // rating del clan como unidad (nace en 1441, Bronce 1); banca_rota y
  // liga se recalculan solos en la base a partir de mmr (columnas
  // GENERATED) -- nunca se mandan a mano.
  mmr: number;
  banca_rota: boolean;
  liga: string;
  // Sistema de Valentía y Responsabilidad -- Fase 1 (migración 024).
  // Sube al aceptar un reto o al proponerlo cuando el rival rechaza;
  // baja al rechazar un reto propio.
  valentia: number;
  is_public: boolean;
  invite_code: string;
  owner_id: string;
  created_at: string;
  // Migración 019: el dueño era el único miembro y salió del equipo
  // -- la fila queda, pero deja de aparecer en el buscador público.
  disuelto: boolean;
  // Apariencia del equipo (migración 033): una de las 7 paletas fijas
  // de TEMAS_EQUIPO, aplicada solo a la página pública de este equipo.
  tema_equipo: TemaEquipo;
}

// Apariencia del equipo (migración 033): 7 paletas fijas, sin editor
// de color libre -- "cian" es la opción por defecto (el acento
// original de toda la app). El nombre de cada valor coincide con el
// check constraint de teams.tema_equipo.
export type TemaEquipo = "cian" | "purpura" | "esmeralda" | "ambar" | "rosa" | "carmesi" | "azul";

export const TEMAS_EQUIPO: { value: TemaEquipo; label: string; color: string }[] = [
  { value: "cian", label: "Cian", color: "#22d3ee" },
  { value: "purpura", label: "Púrpura", color: "#a78bfa" },
  { value: "esmeralda", label: "Esmeralda", color: "#34d399" },
  { value: "ambar", label: "Ámbar", color: "#fbbf24" },
  { value: "rosa", label: "Rosa", color: "#f472b6" },
  { value: "carmesi", label: "Carmesí", color: "#fb7185" },
  { value: "azul", label: "Azul", color: "#60a5fa" },
];

// Jugador temporal (migración 033): un puesto del roster sin cuenta
// real todavía. reemplazado_por queda null hasta que el líder lo
// reemplaza a mano por una cuenta real (nunca automático) -- la fila
// nunca se borra, así que sigue siendo un registro de que ese puesto
// empezó siendo temporal.
export interface TeamTempPlayerRow {
  id: string;
  team_id: string;
  nick_temporal: string;
  creado_por: string;
  created_at: string;
  reemplazado_por: string | null;
}

export type TeamMemberRole = "owner" | "jugador";

export interface TeamMemberRow {
  user_id: string;
  team_id: string;
  roles: TeamMemberRole[];
  joined_at: string;
}

export type InvitationStatus = "pendiente" | "aceptada" | "rechazada";

export interface TeamInvitationRow {
  id: string;
  team_id: string;
  invited_user_id: string;
  invited_by: string;
  status: InvitationStatus;
  created_at: string;
}

export type TeamKickMotivo = "expulsado" | "renuncia";

export interface TeamKickLogRow {
  id: string;
  team_id: string;
  user_id: string;
  kicked_by: string;
  kicked_at: string;
  motivo: TeamKickMotivo;
}

// Clan Wars -- Fase 1 (migración 021), Fase 2 (migración 022) y Fase
// 3 (migración 023): proponer/responder retos, el check-in antes de
// la guerra, y el resultado con ajuste de MMR. Coincide con los check
// constraints de clan_wars en supabase/schema_tournaments.sql.
export type ClanWarStatus =
  | "pendiente"
  | "aceptada"
  | "rechazada"
  | "cancelada"
  | "en_curso"
  | "finalizada"
  | "empatada";

export type ClanWarMotivoRechazo =
  | "Falta de jugadores"
  | "Conflicto de horario"
  | "Ya tenemos guerra ese día"
  | "Roster incompleto"
  | "Otro";

export const CLAN_WAR_MOTIVO_RECHAZO_OPTIONS: ClanWarMotivoRechazo[] = [
  "Falta de jugadores",
  "Conflicto de horario",
  "Ya tenemos guerra ese día",
  "Roster incompleto",
  "Otro",
];

export interface ClanWarRow {
  id: string;
  challenger_team_id: string;
  challenged_team_id: string;
  // Guardado como instante absoluto (timestamptz), no como una hora
  // local fijada a CET -- ver la explicación larga en la migración
  // 021. "CET" es solo el huso horario de referencia que se usa para
  // mostrarla, no la forma en la que se guarda.
  fecha_hora_cet: string;
  status: ClanWarStatus;
  motivo_rechazo: ClanWarMotivoRechazo | null;
  motivo_detalle: string | null;
  created_at: string;
  // Fase 2 (migración 022, check-in). check_in_abierto no se usa
  // desde el frontend -- la ventana se calcula comparando
  // fecha_hora_cet con la hora actual, ver lib/clanWars.ts.
  check_in_abierto: boolean;
  challenger_confirmado: boolean;
  challenged_confirmado: boolean;
  caster_nombre: string | null;
  caster_link: string | null;
  // Nullable hasta que el organizador lo define -- obligatorio antes
  // de que la guerra pueda pasar a 'en_curso'.
  tiene_delay: boolean | null;
  // Fase 3 (migración 023, resultado). Mismo patrón de doble
  // confirmación que challenger_confirmado/challenged_confirmado,
  // pero para el cierre de la guerra.
  challenger_cierre_confirmado: boolean;
  challenged_cierre_confirmado: boolean;
  // Solo se llena cuando status = 'finalizada' -- en 'empatada' queda
  // null, nadie ganó la CW completa.
  ganador_team_id: string | null;
}

export type ClanWarMatchStatus = "pendiente" | "jugado";

export interface ClanWarMatchRow {
  id: string;
  clan_war_id: string;
  jugador_challenger_id: string;
  jugador_challenged_id: string;
  ganador_id: string | null;
  status: ClanWarMatchStatus;
  created_at: string;
}

export type ClanWarReporteMotivo = "cuenta_no_coincide" | "sospecha_smurf" | "no_se_presento";

export const CLAN_WAR_REPORTE_MOTIVO_OPTIONS: { value: ClanWarReporteMotivo; label: string }[] = [
  { value: "cuenta_no_coincide", label: "Cuenta no coincide" },
  { value: "sospecha_smurf", label: "Sospecha de smurf" },
  { value: "no_se_presento", label: "No se presentó" },
];

export interface ClanWarReporteRow {
  id: string;
  clan_war_id: string;
  reportado_por: string;
  jugador_afectado_id: string;
  motivo: ClanWarReporteMotivo;
  created_at: string;
}
