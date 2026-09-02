import { contieneLenguajeInapropiado } from "./profanityFilter";

// Mismo formato que el check constraint profiles_nick_check en la
// migración 011: 3-13 caracteres, letras, números, guion bajo y Ø/ø.
export const NICK_REGEX = /^[A-Za-z0-9_Øø]{3,13}$/;

// Devuelve el mensaje de error (tono informal chileno, como el resto de
// la app) o null si el nick es válido.
export function validarNick(nick: string): string | null {
  if (!NICK_REGEX.test(nick)) {
    return "El nick no puede tener espacios. Usa CarpeDiem en vez de Carpe Diem. Debe tener entre 3 y 13 caracteres: letras, números, guion bajo y Ø/ø.";
  }
  if (contieneLenguajeInapropiado(nick)) {
    return "Ese nick no está permitido. Por favor elige otro.";
  }
  return null;
}
