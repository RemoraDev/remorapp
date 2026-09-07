// Catálogo de skins de avatar (migración 052, reemplazado por completo
// en la migración 054 por el catálogo "Electric": 8 skins, todas
// construidas sobre la misma base técnica -- feTurbulence + feOffset
// animado + feComposite + feBlend + feDisplacementMap -- variando solo
// paleta y parámetros de turbulencia. Por ahora exclusivo del dueño de
// la plataforma: catalogo_skins_avatar solo es legible vía RLS cuando
// es_dueno_plataforma() es verdadero, así que para cualquier otra
// cuenta la consulta a esta tabla vuelve vacía.

// Las 8 claves técnicas -- coinciden 1 a 1 con las filas insertadas en
// la migración 054 y con las claves de CONFIG_ELECTRICO en
// AvatarSkin.tsx. Migración 068: se suman 3 marcos de prestigio
// (Diamante/Master/Gran Master), misma técnica "Electric", con una
// estrella en la esquina que las distingue del resto del catálogo.
export type SkinAvatarClave =
  | "electric"
  | "violet_electric"
  | "cyan_electric"
  | "fire"
  | "blue_fire"
  | "niebla"
  | "frost"
  | "solar"
  | "diamante"
  | "master"
  | "gran_master";

export interface SkinAvatar {
  id: string;
  clave: SkinAvatarClave;
  nombre: string;
  descripcion: string;
}
