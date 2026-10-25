import { supabase } from "./supabaseClient";
import type {
  CategoriaOsr,
  OsrJugador,
  OsrParPaternidad,
  OsrPartida,
  OsrRankingFila,
  OsrRankingRaza,
  OsrTemporada,
  OsrTop5Mascota,
  OsrTop5PapiDios,
  OsrTop5PapiRegador,
  OsrTop5Padrastro,
} from "../types/osr";

// "¿Quién es tu papi?" -- wrappers delgados sobre los RPC de la
// migración 214, mismo estilo que src/lib/hallOfFame.ts: la lógica de
// negocio vive en SQL (security definer donde corresponde), acá solo
// se llama y se tipa la respuesta.

export async function obtenerTemporadaActiva(): Promise<OsrTemporada | null> {
  const { data } = await supabase.from("osr_temporadas").select("*").eq("activa", true).maybeSingle();
  return (data as OsrTemporada | null) ?? null;
}

export async function esModeradorOsr(): Promise<boolean> {
  const { data, error } = await supabase.rpc("es_moderador_osr");
  if (error) return false;
  return !!data;
}

export async function obtenerNombresJugadores(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const { data } = await supabase.from("profiles").select("id, nick, unique_id").in("id", ids);
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"]));
}

export async function obtenerJugadoresTemporada(temporadaId: string): Promise<OsrJugador[]> {
  const { data } = await supabase.from("osr_jugadores").select("*").eq("temporada_id", temporadaId).eq("activo", true);
  return (data ?? []) as OsrJugador[];
}

// Para el Panel de moderador -- incluye también los desactivados, para
// poder reactivarlos.
export async function obtenerJugadoresTemporadaTodos(temporadaId: string): Promise<OsrJugador[]> {
  const { data } = await supabase.from("osr_jugadores").select("*").eq("temporada_id", temporadaId);
  return (data ?? []) as OsrJugador[];
}

export async function obtenerRankingCategoria(temporadaId: string, categoria: CategoriaOsr): Promise<OsrRankingFila[]> {
  const { data, error } = await supabase.rpc("osr_ranking_categoria", {
    p_temporada_id: temporadaId,
    p_categoria: categoria,
  });
  if (error) return [];
  return (data ?? []) as OsrRankingFila[];
}

export async function obtenerRankingGlobal(temporadaId: string): Promise<OsrRankingFila[]> {
  const { data, error } = await supabase.rpc("osr_ranking_global", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrRankingFila[];
}

export async function obtenerRankingRazas(temporadaId: string): Promise<OsrRankingRaza[]> {
  const { data, error } = await supabase.rpc("osr_ranking_razas", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrRankingRaza[];
}

export async function obtenerPaternidadesTemporada(temporadaId: string): Promise<OsrParPaternidad[]> {
  const { data, error } = await supabase.rpc("osr_paternidades_temporada", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrParPaternidad[];
}

export async function obtenerPaternidadesHistorial(): Promise<OsrParPaternidad[]> {
  const { data, error } = await supabase.rpc("osr_paternidades_historial");
  if (error) return [];
  return (data ?? []) as OsrParPaternidad[];
}

export async function obtenerTop5PapiDios(temporadaId: string): Promise<OsrTop5PapiDios[]> {
  const { data, error } = await supabase.rpc("osr_top5_papi_dios", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrTop5PapiDios[];
}

export async function obtenerTop5PapiRegador(temporadaId: string): Promise<OsrTop5PapiRegador[]> {
  const { data, error } = await supabase.rpc("osr_top5_papi_regador", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrTop5PapiRegador[];
}

export async function obtenerTop5Mascota(temporadaId: string): Promise<OsrTop5Mascota[]> {
  const { data, error } = await supabase.rpc("osr_top5_mascota", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrTop5Mascota[];
}

export async function obtenerTop5Padrastro(temporadaId: string): Promise<OsrTop5Padrastro[]> {
  const { data, error } = await supabase.rpc("osr_titulo_padrastro", { p_temporada_id: temporadaId });
  if (error) return [];
  return (data ?? []) as OsrTop5Padrastro[];
}

export async function obtenerHistorialPartidas(temporadaId: string): Promise<OsrPartida[]> {
  const { data } = await supabase
    .from("osr_partidas")
    .select("*")
    .eq("temporada_id", temporadaId)
    .order("fecha", { ascending: false })
    .limit(200);
  return (data ?? []) as OsrPartida[];
}

// Cruza TODAS las temporadas (filtro "Temporada" del historial -- la
// RLS ya deja ver solo verificada/corregida al público, todo al
// moderador).
export async function obtenerHistorialPartidasTodas(): Promise<OsrPartida[]> {
  const { data } = await supabase.from("osr_partidas").select("*").order("fecha", { ascending: false }).limit(500);
  return (data ?? []) as OsrPartida[];
}

export async function obtenerRazaPorJugadorId(jugadorIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(jugadorIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const { data } = await supabase.from("osr_jugadores").select("id, raza_principal").in("id", ids);
  return Object.fromEntries((data ?? []).map((j) => [j.id, j.raza_principal]));
}

// ---------- Etapa 2: panel de moderador ----------

export async function obtenerPartidasPendientes(temporadaId: string): Promise<OsrPartida[]> {
  const { data } = await supabase
    .from("osr_partidas")
    .select("*")
    .eq("temporada_id", temporadaId)
    .eq("estado", "pendiente")
    .order("fecha", { ascending: true });
  return (data ?? []) as OsrPartida[];
}

export async function obtenerPartidasVerificadas(temporadaId: string): Promise<OsrPartida[]> {
  const { data } = await supabase
    .from("osr_partidas")
    .select("*")
    .eq("temporada_id", temporadaId)
    .in("estado", ["verificada", "corregida"])
    .order("fecha", { ascending: false })
    .limit(200);
  return (data ?? []) as OsrPartida[];
}

export async function esDuenoEquipoOsr(): Promise<boolean> {
  const { data, error } = await supabase.rpc("osr_es_dueno_equipo_osr");
  if (error) return false;
  return !!data;
}

export async function registrarPartida(params: {
  temporadaId: string;
  ganadorUserId: string;
  perdedorUserId: string;
  fecha: string;
  fuenteVerificacion?: string;
  evidenciaUrl?: string;
  observaciones?: string;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_registrar_partida", {
    p_temporada_id: params.temporadaId,
    p_ganador_user_id: params.ganadorUserId,
    p_perdedor_user_id: params.perdedorUserId,
    p_fecha: params.fecha,
    p_fuente_verificacion: params.fuenteVerificacion ?? null,
    p_evidencia_url: params.evidenciaUrl ?? null,
    p_observaciones: params.observaciones ?? null,
  });
  return { error: error?.message ?? null };
}

export async function verificarPartida(partidaId: string, aprobar: boolean, motivo?: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_verificar_partida", {
    p_partida_id: partidaId,
    p_aprobar: aprobar,
    p_motivo: motivo ?? null,
  });
  return { error: error?.message ?? null };
}

export async function corregirPartida(params: {
  partidaId: string;
  nuevoGanadorUserId: string;
  nuevoPerdedorUserId: string;
  nuevaFecha: string;
  motivo: string;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_corregir_partida", {
    p_partida_id: params.partidaId,
    p_nuevo_ganador_user_id: params.nuevoGanadorUserId,
    p_nuevo_perdedor_user_id: params.nuevoPerdedorUserId,
    p_nueva_fecha: params.nuevaFecha,
    p_motivo: params.motivo,
  });
  return { error: error?.message ?? null };
}

export async function eliminarPartida(partidaId: string, motivo: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_eliminar_partida", { p_partida_id: partidaId, p_motivo: motivo });
  return { error: error?.message ?? null };
}

export async function inscribirJugador(params: {
  temporadaId: string;
  userId: string;
  raza: string;
  categoria: string;
  mmrOficial: number;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_inscribir_jugador", {
    p_temporada_id: params.temporadaId,
    p_user_id: params.userId,
    p_raza: params.raza,
    p_categoria: params.categoria,
    p_mmr_oficial: params.mmrOficial,
  });
  return { error: error?.message ?? null };
}

export async function abrirTemporada(nombre: string): Promise<{ error: string | null; id: string | null }> {
  const { data, error } = await supabase.rpc("osr_abrir_temporada", { p_nombre: nombre });
  return { error: error?.message ?? null, id: (data as string) ?? null };
}

export async function agregarModeradorOsr(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_agregar_moderador", { p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function quitarModeradorOsr(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_quitar_moderador", { p_user_id: userId });
  return { error: error?.message ?? null };
}

// ---------- Completar documento: hijos/padres, temporadas, auditoría ----------

export interface OsrHijoOPadre {
  user_id: string;
  nick: string | null;
  victorias_jugador: number;
  victorias_otro: number;
  diferencia: number;
  categoria_actual: string | null;
}

export async function obtenerHijosDe(userId: string): Promise<OsrHijoOPadre[]> {
  const { data, error } = await supabase.rpc("osr_hijos_de", { p_user_id: userId });
  if (error) return [];
  return (data ?? []).map((f: any) => ({
    user_id: f.hijo_user_id,
    nick: f.nick,
    victorias_jugador: f.victorias_jugador,
    victorias_otro: f.victorias_hijo,
    diferencia: f.diferencia,
    categoria_actual: f.categoria_actual,
  }));
}

export async function obtenerPadresDe(userId: string): Promise<OsrHijoOPadre[]> {
  const { data, error } = await supabase.rpc("osr_padres_de", { p_user_id: userId });
  if (error) return [];
  return (data ?? []).map((f: any) => ({
    user_id: f.padre_user_id,
    nick: f.nick,
    victorias_jugador: f.victorias_jugador,
    victorias_otro: f.victorias_padre,
    diferencia: f.diferencia,
    categoria_actual: f.categoria_actual,
  }));
}

export async function obtenerTodasLasTemporadas(): Promise<OsrTemporada[]> {
  const { data } = await supabase.from("osr_temporadas").select("*").order("creada_en", { ascending: false });
  return (data ?? []) as OsrTemporada[];
}

export interface OsrEstadisticasGenerales {
  jugadores_activos: number;
  partidas_verificadas: number;
  partidas_pendientes: number;
  partidas_rechazadas: number;
  paternidades_consolidadas: number;
  paternidades_disputadas: number;
}

export async function obtenerEstadisticasGenerales(temporadaId: string): Promise<OsrEstadisticasGenerales | null> {
  const { data, error } = await supabase.rpc("osr_estadisticas_generales", { p_temporada_id: temporadaId }).maybeSingle();
  if (error || !data) return null;
  return data as OsrEstadisticasGenerales;
}

export async function activarJugador(jugadorId: string, activo: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("osr_activar_jugador", { p_jugador_id: jugadorId, p_activo: activo });
  return { error: error?.message ?? null };
}

export interface OsrAuditoriaFila {
  id: string;
  partida_id: string;
  accion: string;
  motivo: string | null;
  moderador_id: string;
  creado_en: string;
}

export async function obtenerAuditoria(temporadaId: string): Promise<OsrAuditoriaFila[]> {
  const { data: partidas } = await supabase.from("osr_partidas").select("id").eq("temporada_id", temporadaId);
  const idsPartidas = (partidas ?? []).map((p) => p.id);
  if (idsPartidas.length === 0) return [];
  const { data } = await supabase
    .from("osr_partidas_auditoria")
    .select("id, partida_id, accion, motivo, moderador_id, creado_en")
    .in("partida_id", idsPartidas)
    .order("creado_en", { ascending: false })
    .limit(300);
  return (data ?? []) as OsrAuditoriaFila[];
}
