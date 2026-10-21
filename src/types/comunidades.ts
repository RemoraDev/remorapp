import type { TemaEquipo } from "./teams";

// Comunidades (migración 198, a pedido del usuario): grupos públicos,
// libres de crear y de unirse sin aprobación -- solo quien la creó
// administra (banner, logo, descripción, eliminarla).
export interface ComunidadRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  banner_url: string | null;
  logo_url: string | null;
  creador_id: string;
  creado_en: string;
  // Migración 203, a pedido del usuario: banner lateral aparte del
  // banner superior -- mismo concepto que teams.escritorio_lateral_url.
  banner_lateral_url: string | null;
  // Migración 202, a pedido del usuario: mismo catálogo de 5 paletas
  // que tournaments.tema_equipo (ver TEMAS_EQUIPO en types/teams.ts) --
  // se aplica con el mismo atributo data-tema-equipo en la raíz de la
  // página, los selectores de halcon.css ya son genéricos.
  tema_comunidad: TemaEquipo;
  // Migración 204, a pedido del usuario: ficha del streamer de la
  // comunidad -- reemplaza a "Eventos de la comunidad" en la página
  // pública (esos eventos se siguen viendo en Mis Eventos).
  streamer_horario: string | null;
  streamer_link: string | null;
  streamer_pais: string | null;
  streamer_idioma: string | null;
  streamer_juegos: string | null;
  streamer_bio: string | null;
}

export interface ComunidadMiembroRow {
  id: string;
  comunidad_id: string;
  user_id: string;
  unido_en: string;
}

// Migración 201, a pedido del usuario: un evento (torneo, Race War o
// Clan War Amistosa) vinculado a una comunidad -- ver
// obtenerEventosDeComunidad() en lib/comunidades.ts, usado tanto por
// ComunidadDetailPage.tsx como por MisEventosPage.tsx.
export interface EventoComunidad {
  tipo: "torneo" | "race_war" | "clan_war_amistosa";
  id: string;
  titulo: string;
  fecha: string;
  href: string;
}
