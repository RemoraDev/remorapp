import { contieneLenguajeInapropiado } from "./profanityFilter";

// Mismo formato que el check constraint profiles_nick_formato en la
// migración: 3-16 caracteres, solo letras, números y guion bajo.
export const NICK_REGEX = /^[A-Za-z0-9_]{3,16}$/;

// Devuelve el mensaje de error (tono informal chileno, como el resto de
// la app) o null si el nick es válido.
export function validarNick(nick: string): string | null {
  if (!NICK_REGEX.test(nick)) {
    return "Sin espacios wn. Usa CarpeDiem no Carpe Diem. Solo letras, números y guion bajo.";
  }
  if (contieneLenguajeInapropiado(nick)) {
    return "Ese nick no está permitido wn, elige otro.";
  }
  return null;
}
