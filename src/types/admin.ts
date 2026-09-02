import type { Country, PerfilTipo } from "./profile";

// Fila que devuelve la función admin_listar_usuarios() (RPC). Incluye
// email a propósito -- ese campo no viaja en el Profile normal porque
// no es público (ver el revoke de columna en la migración 004).
export interface AdminUserRow {
  id: string;
  nick: string | null;
  unique_id: string;
  email: string | null;
  country: Country | null;
  perfil_tipo: PerfilTipo | null;
  cuenta_validada: boolean;
  suspendido: boolean;
  es_admin: boolean;
  // Suspensión administrada (migración 028): quién, por qué, cuándo --
  // visible para cualquier administrador, no solo quien la aplicó.
  suspendido_por_nick: string | null;
  suspendido_motivo: string | null;
  suspendido_en: string | null;
}
