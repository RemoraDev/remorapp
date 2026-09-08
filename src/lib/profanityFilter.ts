// Lista básica de palabras a bloquear en nicks (español e inglés). No es
// exhaustiva -- es un filtro de primera línea pensado para ampliarse más
// adelante, no un sistema de moderación completo.
const PALABRAS_BLOQUEADAS = [
  // Español
  "puta",
  "puto",
  "mierda",
  "pendejo",
  "pendeja",
  "conchatumadre",
  "hueon",
  "weon",
  "maricon",
  "marica",
  "verga",
  "culiao",
  "culiado",
  "chucha",
  "cabron",
  "cabrona",
  "perra",
  "zorra",
  "polla",
  // Inglés
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "slut",
  "dick",
  "cock",
  "pussy",
];

// Reemplazos "leet" más comunes, para atrapar variantes obvias como
// "put4" o "sh1t" antes de comparar contra la lista.
const REEMPLAZOS_LEET: Record<string, string> = {
  "4": "a",
  "3": "e",
  "1": "i",
  "0": "o",
  "5": "s",
  $: "s",
  "@": "a",
};

function normalizar(texto: string): string {
  let resultado = texto.toLowerCase();
  // Quita tildes/diacríticos (ej: "carpé" -> "carpe"): separa la
  // letra de su marca diacrítica (NFD) y borra esa marca con la
  // propiedad Unicode \p{Diacritic}.
  resultado = resultado.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  resultado = resultado
    .split("")
    .map((caracter) => REEMPLAZOS_LEET[caracter] ?? caracter)
    .join("");
  // Deja solo letras y números (sin guion bajo ni otros símbolos).
  resultado = resultado.replace(/[^a-z0-9]/g, "");
  return resultado;
}

export function contieneLenguajeInapropiado(nick: string): boolean {
  const normalizado = normalizar(nick);
  return PALABRAS_BLOQUEADAS.some((palabra) => normalizado.includes(palabra));
}
