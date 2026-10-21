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
}

export interface ComunidadMiembroRow {
  id: string;
  comunidad_id: string;
  user_id: string;
  unido_en: string;
}
