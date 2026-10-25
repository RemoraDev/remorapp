// "¿Quién es tu papi?" -- competencia interna del clan ØLD SCHOOL
// REBØRN (migración 214). Etapa 1: estructura, base de datos y
// lectura de rankings/paternidades/títulos. El registro/verificación
// de partidas desde la app queda para la etapa 2 (ver nota al
// principio de supabase/migration_214_osr_quien_es_tu_papi.sql).
export const ID_EQUIPO_OSR = "de0df7cf-ec44-43c3-9e24-cfde9f2161e2";

export type RazaOsr = "terran" | "zerg" | "protoss";

export type CategoriaOsr = "3500" | "4000" | "4500" | "5000" | "5500" | "sin_limite";

export const CATEGORIAS_OSR: { value: CategoriaOsr; label: string }[] = [
  { value: "3500", label: "3500" },
  { value: "4000", label: "4000" },
  { value: "4500", label: "4500" },
  { value: "5000", label: "5000" },
  { value: "5500", label: "5500" },
  { value: "sin_limite", label: "Sin límite" },
];

export const RAZAS_OSR: { value: RazaOsr; label: string }[] = [
  { value: "terran", label: "Terran" },
  { value: "zerg", label: "Zerg" },
  { value: "protoss", label: "Protoss" },
];

export type EstadoPartidaOsr = "pendiente" | "verificada" | "rechazada" | "corregida";

export interface OsrTemporada {
  id: string;
  nombre: string;
  activa: boolean;
  creada_en: string;
  cerrada_en: string | null;
}

export interface OsrJugador {
  id: string;
  temporada_id: string;
  user_id: string;
  raza_principal: RazaOsr;
  categoria: CategoriaOsr;
  mmr_oficial_inicial: number;
  mmr_evento: number;
  activo: boolean;
  creado_en: string;
}

export interface OsrPartida {
  id: string;
  temporada_id: string;
  jugador_ganador_id: string;
  jugador_perdedor_id: string;
  ganador_user_id: string;
  perdedor_user_id: string;
  fecha: string;
  categoria_ganador: CategoriaOsr;
  categoria_perdedor: CategoriaOsr;
  mmr_ganador_antes: number;
  mmr_ganador_despues: number;
  mmr_perdedor_antes: number;
  mmr_perdedor_despues: number;
  puntos_ganador: number;
  puntos_perdedor: number;
  fuente_verificacion: string | null;
  evidencia_url: string | null;
  moderador_id: string | null;
  estado: EstadoPartidaOsr;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

// Fila de osr_ranking_categoria()/osr_ranking_global() (RPC).
export interface OsrRankingFila {
  jugador_id: string;
  user_id: string;
  nick: string | null;
  raza_principal: RazaOsr;
  categoria?: CategoriaOsr;
  mmr_evento: number;
  posicion: number;
}

// Fila de osr_ranking_razas() (RPC).
export interface OsrRankingRaza {
  raza_principal: RazaOsr;
  jugadores: number;
  mmr_total: number;
  mmr_promedio: number;
}

// Fila de osr_paternidades_historial()/osr_paternidades_temporada() (RPC).
export interface OsrParPaternidad {
  jugador_a: string;
  jugador_b: string;
  victorias_a: number;
  victorias_b: number;
  diferencia: number;
  estado: "papa_a" | "papa_b" | "disputando";
}

export interface OsrTop5PapiDios {
  user_id: string;
  nick: string | null;
  mmr_evento: number;
  diferencia_con_lider: number;
  posicion: number;
}

export interface OsrTop5PapiRegador {
  user_id: string;
  nick: string | null;
  hijos: number;
  padres: number;
  mmr_evento: number;
  posicion: number;
}

export interface OsrTop5Mascota {
  user_id: string;
  nick: string | null;
  mmr_evento: number;
  padres: number;
  hijos: number;
  posicion: number;
}

export interface OsrTop5Padrastro {
  candidato_user_id: string;
  rival_user_id: string;
  victorias_candidato: number;
  victorias_rival: number;
  diferencia: number;
  mmr_evento: number;
  posicion: number;
}
