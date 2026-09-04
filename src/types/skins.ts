// Catálogo de skins de avatar (migración 052). Por ahora exclusivo
// del dueño de la plataforma: catalogo_skins_avatar solo es legible
// vía RLS cuando es_dueno_plataforma() es verdadero, así que para
// cualquier otra cuenta la consulta a esta tabla vuelve vacía.

// Las 10 claves técnicas -- coinciden 1 a 1 con las filas insertadas
// en la migración 052. Sirven para elegir qué CSS/SVG renderiza
// AvatarSkin, independiente del texto de "nombre".
export type SkinAvatarClave =
  | "fuego_electricidad"
  | "demoniaca"
  | "elfica"
  | "orca"
  | "sagrada"
  | "cristal_negro"
  | "gatitos"
  | "zerg"
  | "protoss"
  | "terran";

export interface SkinAvatar {
  id: string;
  clave: SkinAvatarClave;
  nombre: string;
  descripcion: string;
}
