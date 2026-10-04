// Sonidos cortos sintetizados con Web Audio API -- a pedido del
// usuario, para el Panel de control (abrir el panel / tocar un botón
// del menú). Sin archivos de audio: todo se genera con un oscilador,
// así no hace falta ningún asset nuevo ni su licencia. Si el navegador
// no soporta AudioContext (o lo bloquea hasta el primer gesto del
// usuario), las funciones simplemente no hacen nada -- nunca rompen
// la interacción.
//
// Migración 158: el barrido de un solo tono (migración 155) terminó
// sonando parecido al click genérico de Windows -- a pedido del
// usuario, pasa a ser un arpegio de varias notas DISCRETAS (no un
// barrido continuo) con onda diente de sierra (más brillante/áspera
// que la cuadrada), para que se sienta claramente "de videojuego" y
// no un simple click de sistema operativo.
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

// Una nota corta y seca, onda diente de sierra (sawtooth) -- más
// áspera/brillante que una cuadrada o una sinusoide, lectura típica de
// HUD de videojuego.
function nota(frecuencia: number, duracionMs: number, volumen: number, demoraMs = 0) {
  const ctx = obtenerContexto();
  if (!ctx) return;
  const inicio = ctx.currentTime + demoraMs / 1000;
  const fin = inicio + duracionMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(frecuencia, inicio);
  gain.gain.setValueAtTime(0.0001, inicio);
  // Ataque rápido (no instantáneo, para evitar un "click" de corte
  // seco al arrancar) + caída exponencial -- envolvente percusiva.
  gain.gain.exponentialRampToValueAtTime(volumen, inicio + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, fin);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(fin);
}

// Al abrir un panel de control (Mi perfil / Mi Clan) -- arpegio corto
// de tres notas ascendentes, tipo "power up" de HUD de videojuego.
export function sonidoAbrirPanel() {
  try {
    nota(392, 55, 0.05, 0);
    nota(523, 55, 0.05, 50);
    nota(784, 90, 0.06, 100);
  } catch {
    // Nunca romper la apertura del panel por esto.
  }
}

// Al tocar cualquier acceso del menú (team-panel-menu-item) -- dos
// notas muy cortas, tipo "blip" de selección de menú de videojuego.
export function sonidoClickMenu() {
  try {
    nota(660, 28, 0.045, 0);
    nota(990, 32, 0.045, 24);
  } catch {
    // Nunca romper el click por esto.
  }
}
