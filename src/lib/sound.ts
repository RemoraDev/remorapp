// Sonidos cortos sintetizados con Web Audio API -- a pedido del
// usuario, para el Panel de control (abrir el panel / tocar un botón
// del menú). Sin archivos de audio: todo se genera con un oscilador,
// así no hace falta ningún asset nuevo ni su licencia. Si el navegador
// no soporta AudioContext (o lo bloquea hasta el primer gesto del
// usuario), las funciones simplemente no hacen nada -- nunca rompen
// la interacción.
//
// Migración 155: pasaron de ser dos notas suaves (sine) a ondas
// cuadradas con barrido de frecuencia -- a pedido del usuario, quería
// algo "más gaming/electrónico" (el sonido típico de HUD/menú de
// videojuego) en vez de un timbre suave tipo campanita.
let audioCtx: AudioContext | null = null;

function obtenerContexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

// Barrido de frecuencia (de -> hasta) con onda cuadrada -- el timbre
// "chiptune"/retro-gamer, mucho más electrónico que una sinusoide lisa.
function barrido(desde: number, hasta: number, duracionMs: number, volumen: number, demoraMs = 0) {
  const ctx = obtenerContexto();
  if (!ctx) return;
  const inicio = ctx.currentTime + demoraMs / 1000;
  const fin = inicio + duracionMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(desde, inicio);
  osc.frequency.exponentialRampToValueAtTime(Math.max(hasta, 1), fin);
  gain.gain.setValueAtTime(volumen, inicio);
  gain.gain.exponentialRampToValueAtTime(0.0001, fin);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(fin);
}

// Al abrir un panel de control (Mi perfil / Mi Clan) -- dos barridos
// ascendentes cortos, tipo "power up" de HUD de videojuego.
export function sonidoAbrirPanel() {
  try {
    barrido(220, 520, 70, 0.05);
    barrido(440, 1040, 90, 0.05, 55);
  } catch {
    // Nunca romper la apertura del panel por esto.
  }
}

// Al tocar cualquier acceso del menú (team-panel-menu-item) -- un
// "tick" corto y seco, tipo selección de menú de videojuego.
export function sonidoClickMenu() {
  try {
    barrido(700, 900, 35, 0.045);
  } catch {
    // Nunca romper el click por esto.
  }
}
