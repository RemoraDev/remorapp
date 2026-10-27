// Capturas del banco de pruebas del motor de fondos.
//
// Uso:
//   node scripts/capturar-motor.mjs <carpeta-salida> <nombre=query> [...]
//
// Ejemplo:
//   node scripts/capturar-motor.mjs docs/capturas/hito-2 \
//     mediodia="hora=12&nubes=0.55" noche="hora=1&fase=1"
//
// DOS DECISIONES QUE NO SON DETALLE:
//
// 1. UN SOLO NAVEGADOR para todas las capturas, y matarlo POR PERFIL.
//    Antes se abría uno por captura y se mataba con taskkill sobre el
//    árbol de procesos; como Edge headless se re-emparenta, el padre
//    moría y los hijos no. Quedaron 509 procesos huérfanos corriendo y
//    calentaron la GPU hasta que la máquina se apagó. La marca fiable
//    de que un proceso es nuestro es el nombre de la carpeta temporal
//    de perfil en su línea de comandos; eso además garantiza no tocar
//    el navegador que el usuario tenga abierto.
//
// 2. La captura se pide con window.__capturar(), que lee el canvas
//    DENTRO de la tarea de su propio render. Un canvas WebGPU no se
//    puede leer desde un setTimeout ni con Page.captureScreenshot: sale
//    negro. Eso ya costó horas de diagnóstico equivocado.

import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [carpeta, ...pedidos] = process.argv.slice(2);
if (!carpeta || pedidos.length === 0) {
  console.error("uso: node scripts/capturar-motor.mjs <carpeta> <nombre=query> [...]");
  process.exit(2);
}

const BASE = process.env.MOTOR_URL ?? "http://localhost:5173/scripts/motor/index.html";
const PUERTO = 9556;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ANCHO = 1600;
const ALTO = 900;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(carpeta, { recursive: true });

const perfil = mkdtempSync(join(tmpdir(), "motor-"));
const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${PUERTO}`,
    `--user-data-dir=${perfil}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    // SwiftShader como red de seguridad: sin GPU real igual se puede
    // evaluar la IMAGEN. El tiempo medido acá no sirve para nada -- eso
    // se mide adentro de Tauri, sobre la GPU dedicada.
    "--enable-unsafe-swiftshader",
    "--enable-features=Vulkan",
  ],
  { stdio: "ignore" },
);

// Se busca por el NOMBRE de la carpeta temporal y no por la ruta
// completa: la ruta lleva barras invertidas, y escaparlas a través de
// cmd, PowerShell y el comodín -like es una fuente de errores sin
// ninguna ventaja. El nombre ya es único porque lo genera mkdtemp.
const psPerfil = (accion) =>
  'powershell -NoProfile -Command "' +
  "Get-CimInstance Win32_Process -Filter \\\"Name='msedge.exe'\\\" | " +
  `Where-Object { $_.CommandLine -like '*${basename(perfil)}*' } | ` +
  accion +
  '"';

let matado = false;
const matar = () => {
  if (matado) return;
  matado = true;
  try {
    execSync(psPerfil("ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"), {
      stdio: "ignore",
    });
  } catch {
    /* si PowerShell no está, queda el taskkill de abajo */
  }
  try {
    execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" });
  } catch {
    try {
      edge.kill();
    } catch {
      /* ya no está */
    }
  }
};
process.on("exit", matar);
process.on("SIGINT", () => {
  matar();
  process.exit(130);
});

let objetivos = null;
for (let i = 0; i < 60 && !objetivos; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/json/list`);
    const j = await r.json();
    if (j.length) objetivos = j;
  } catch {
    await dormir(500);
  }
}
if (!objetivos) {
  console.error("Edge no abrió el puerto de depuración");
  process.exit(1);
}

const ws = new WebSocket(objetivos.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((ok, mal) => {
  ws.addEventListener("open", ok);
  ws.addEventListener("error", mal);
});

let id = 0;
const pend = new Map();
let logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined && pend.has(m.id)) {
    const { ok, mal } = pend.get(m.id);
    pend.delete(m.id);
    if (m.error) mal(new Error(JSON.stringify(m.error)));
    else ok(m.result);
  } else if (m.method === "Runtime.consoleAPICalled") {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  } else if (m.method === "Log.entryAdded") {
    logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  }
});
const enviar = (method, params = {}) =>
  new Promise((ok, mal) => {
    const i = ++id;
    pend.set(i, { ok, mal });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pend.delete(i)) mal(new Error("timeout " + method));
    }, 120000);
  });

await enviar("Runtime.enable");
await enviar("Log.enable");
await enviar("Page.enable");
await enviar("Emulation.setDeviceMetricsOverride", {
  width: ANCHO,
  height: ALTO,
  deviceScaleFactor: 1,
  mobile: false,
});

let fallas = 0;
for (const pedido of pedidos) {
  const corte = pedido.indexOf("=");
  const nombre = pedido.slice(0, corte);
  const query = pedido.slice(corte + 1);
  logs = [];

  // about:blank en el medio fuerza a descartar el módulo anterior: sin
  // eso el navegador puede reusar la página y las opciones viejas.
  await enviar("Page.navigate", { url: "about:blank" });
  await dormir(200);
  await enviar("Page.navigate", { url: `${BASE}?${query}` });

  let r = null;
  for (let i = 0; i < 60; i++) {
    await dormir(1000);
    try {
      const ev = await enviar("Runtime.evaluate", {
        expression: 'window.__resultado ? JSON.stringify(window.__resultado) : "null"',
        returnByValue: true,
      });
      const o = JSON.parse(ev.result.value);
      if (o && o.estado !== "corriendo") {
        r = o;
        break;
      }
    } catch {
      /* la página puede estar recargando */
    }
  }

  if (!r || r.estado !== "OK") {
    fallas++;
    console.error(`FALLO ${nombre}: ${r ? r.estado : "tiempo agotado"}`);
    console.error((r?.errores ?? []).join("\n") || logs.slice(-10).join("\n"));
    continue;
  }

  const ev = await enviar("Runtime.evaluate", {
    expression: "window.__capturar()",
    awaitPromise: true,
    returnByValue: true,
  });
  const salida = join(carpeta, `${nombre}.png`);
  writeFileSync(salida, Buffer.from(String(ev.result.value).split(",")[1], "base64"));
  console.log(`${nombre}: ${salida}  gpu=${r.gpu}  ms=${r.msGpu === null ? "n/d" : r.msGpu.toFixed(3)}`);
}

ws.close();
matar();

// Comprobación de huérfanos: se cuentan solo los de NUESTRO perfil. Los
// procesos del navegador que el usuario tenga abierto no son asunto de
// este script, y contarlos daría un aviso falso en cada corrida.
await dormir(500);
try {
  const n = Number(
    execSync(psPerfil("Measure-Object | Select-Object -ExpandProperty Count"), { encoding: "utf8" }).trim(),
  );
  if (n > 0) console.warn(`AVISO: quedaron ${n} proceso(s) de Edge de este script sin morir.`);
  else console.log("sin huérfanos.");
} catch {
  console.warn("no se pudo verificar huérfanos; revisar a mano.");
}

process.exit(fallas > 0 ? 1 : 0);
