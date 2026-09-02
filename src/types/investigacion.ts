// Resultado de investigar_jugador() (migración 025) -- jsonb desde la
// base, con esta forma exacta. Solo para líderes de clan o
// administradores: ver el chequeo de permiso adentro de la función.
export interface InvestigacionIdentidad {
  id: string;
  nick: string | null;
  unique_id: string;
  suspendido: boolean;
  poco_confiable: boolean;
  valentia_jugador: number;
  responsabilidad_cw: number;
  responsabilidad_torneos: number;
  liga_1v1: string;
}

export interface InvestigacionNick {
  nick_anterior: string;
  cambiado_en: string;
}

export interface InvestigacionEquipo {
  team_id: string;
  nombre: string;
  tag: string;
  entrada_en: string | null;
  salida_en: string | null;
  motivo_salida: "expulsado" | "renuncia" | null;
}

export interface InvestigacionReporte {
  clan_war_id: string;
  reportado_por_nombre: string;
  created_at: string;
}

export interface InvestigacionJugador {
  identidad: InvestigacionIdentidad;
  historial_nicks: InvestigacionNick[];
  historial_equipos: InvestigacionEquipo[];
  reportes_no_presentado: InvestigacionReporte[];
}
