// Delfin Mode -- voz en tiempo real (LiveKit). Esta URL no es secreta
// (es solo la dirección del servidor WebSocket al que se conecta el
// navegador) -- las credenciales que sí son secretas (API key/secret)
// viven únicamente del lado de la función Edge livekit-token, nunca
// acá. Ver .env.example.
export const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

export function vozConfigurada(): boolean {
  return Boolean(LIVEKIT_URL);
}
