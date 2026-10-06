// Compartido entre PlayerDetailPage.tsx (Mi perfil) y TeamDetailPage.tsx
// (Mi Clan) -- antes cada archivo tenía su propia copia de
// COLOR_PLATAFORMA_STREAM/extraerNombreCanal, se unifican acá.

// Colores de marca oficiales -- a pedido del usuario, los íconos de
// Stream se ven con su color real en vez de heredar currentColor.
export const COLOR_PLATAFORMA_STREAM: Record<string, string> = {
  Twitch: "#9146FF",
  Discord: "#5865F2",
  YouTube: "#FF0000",
};

// A pedido del usuario: si pega una URL completa (ej.
// "twitch.com/grankefka"), mostrar el nombre de canal/usuario en vez
// del nombre genérico de la plataforma.
export function extraerNombreCanal(valor: string): string {
  const limpio = valor.trim().split("?")[0].split("#")[0].replace(/\/+$/, "");
  const partes = limpio.split("/").filter(Boolean);
  return partes[partes.length - 1] || valor;
}

const BASE_URL_STREAM: Record<string, string> = {
  Twitch: "https://twitch.tv/",
  Discord: "https://discord.com/users/",
  YouTube: "https://youtube.com/@",
};

// Corrección: el campo de texto pedía "Link de Twitch" pero se
// guardaba tal cual lo tipeado -- en la práctica, la mayoría escribía
// solo su nombre de canal ("grankefka"), no una URL. Como <a href>
// usaba ese valor directo, el link terminaba siendo una ruta relativa
// rota en vez de navegar a la plataforma real, lo que se veía como "no
// es clickeable". Si ya es una URL completa, se respeta tal cual; si
// no, arma la URL real de esa plataforma a partir del nombre.
export function normalizarUrlStream(plataforma: string, valor: string): string {
  const limpio = valor.trim();
  if (/^https?:\/\//i.test(limpio)) return limpio;
  const nombre = limpio.replace(/^@/, "");
  const base = BASE_URL_STREAM[plataforma];
  return base ? `${base}${nombre}` : `https://${limpio}`;
}
