// Sonidos cortos sintetizados con Web Audio API -- a pedido del
// usuario, para el Panel de control (abrir el panel / tocar un botón
// del menú). Sin archivos de audio: todo se genera con un oscilador,
// así no hace falta ningún asset nuevo ni su licencia. Si el navegador
// no soporta AudioContext (o lo bloquea hasta el primer gesto del
// usuario), las funciones simplemente no hacen nada -- nunca rompen
// la interacción.
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

function tono(frecuencia: number, duracionMs: number, volumen: number, demoraMs = 0) {
  const ctx = obtenerContexto();
  if (!ctx) return;
  const inicio = ctx.currentTime + demoraMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frecuencia;
  gain.gain.setValueAtTime(volumen, inicio);
  gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracionMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracionMs / 1000);
}

// Al abrir un panel de control (Mi perfil / Mi Clan) -- dos notas
// cortas ascendentes.
export function sonidoAbrirPanel() {
  try {
    tono(660, 90, 0.07);
    tono(880, 100, 0.07, 55);
  } catch {
    // Nunca romper la apertura del panel por esto.
  }
}

// Al tocar cualquier acceso del menú (team-panel-menu-item) -- un
// click corto y discreto.
export function sonidoClickMenu() {
  try {
    tono(520, 55, 0.05);
  } catch {
    // Nunca romper el click por esto.
  }
}
