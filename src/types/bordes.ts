// Catálogo de bordes básicos de avatar (migración 055): 15 colores
// lisos, sin filtro ni animación, con grosor editable -- el nivel
// gratuito de personalización, disponible para cualquier cuenta desde
// el principio (a diferencia del catálogo de skins de efectos, que
// sigue siendo exclusivo del dueño de la plataforma).
export interface BordeBasico {
  id: string;
  nombre: string;
  color_hex: string;
}

export const BORDE_GROSOR_MIN = 1;
export const BORDE_GROSOR_MAX = 8;
