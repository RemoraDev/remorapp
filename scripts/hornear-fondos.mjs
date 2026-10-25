// Hornea los fondos procedurales: renderiza cada escena una sola vez y
// guarda el resultado en public/fondos-webgpu/<id>.avif.
//
// POR QUÉ EXISTE
// Pintar el cielo y las montañas por píxel, 30 veces por segundo, para
// obtener siempre lo mismo, costaba el 43% de una GPU. Son estáticos:
// se hornean una vez y en vivo cuestan UNA lectura de textura. Además,
// como esto corre sin apuro, se puede rendir al doble de resolución y
// reducir, así que el horneado se ve MEJOR que el cálculo en vivo.
// Y al ser un comando, mejorar una escena deja de ser un trámite manual.
//
// USO
//   npm run dev                      (en otra terminal: hace falta el servidor)
//   node scripts/hornear-fondos.mjs                 -> hornea todas
//   node scripts/hornear-fondos.mjs bosque_elfico   -> hornea una sola
//   node scripts/hornear-fondos.mjs --sin-chequeo-gpu
//
// CUIDADO: esto renderiza de verdad y calienta la GPU. Por eso chequea
// la temperatura antes de arrancar (ver LIMITE_TEMPERATURA): en esta
// máquina un horneado con la GPU ya caliente terminó en un apagón.
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const URL_BASE = "http://localhost:5173";
const SALIDA = "public/fondos-webgpu";
const REGISTRO = "src/components/fondos/registro.ts";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PUERTO = 9444;
// El AVIF que se despacha: ancho final y tope de peso.
const ANCHO_FINAL = 1400;
const MAX_KB = 48;
// Por encima de esto no se hornea nada. Una GPU sana en reposo está muy
// por debajo.
const LIMITE_TEMPERATURA = 75;

const args = process.argv.slice(2);
const sinChequeo = args.includes("--sin-chequeo-gpu");
const soloEstas = args.filter((a) => !a.startsWith("--"));

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function temperaturaGpu() {
  try {
    const salida = execSync("nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number(String(salida).trim().split(/\r?\n/)[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // sin nvidia-smi (otra placa): no se puede chequear
  }
}

// Las escenas salen del registro del propio código, para no llevar acá
// una segunda lista que se desincronice -- ya pasó con FONDOS_WEBGPU y
// costó que un fondo no se mostrara nunca.
function leerRegistro() {
  const fuente = readFileSync(REGISTRO, "utf8");
  return [...fuente.matchAll(/id:\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
}

let idMsg = 0;
function cliente(ws) {
  const pendientes = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined && pendientes.has(m.id)) {
      const { resolve, reject } = pendientes.get(m.id);
      pendientes.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++idMsg;
      pendientes.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pendientes.delete(id)) reject(new Error("timeout en " + method));
      }, 180000);
    });
}

async function main() {
  if (!sinChequeo) {
    const t = temperaturaGpu();
    if (t === null) {
      console.log("No pude leer la temperatura de la GPU. Seguí bajo tu criterio.");
    } else if (t > LIMITE_TEMPERATURA) {
      console.error(`GPU a ${t} °C, por encima del límite de ${LIMITE_TEMPERATURA}. No se hornea nada.`);
      console.error("Dejá que baje, o corré con --sin-chequeo-gpu si sabés lo que hacés.");
      process.exit(1);
    } else {
      console.log(`GPU a ${t} °C: en condiciones.`);
    }
  }

  try {
    await fetch(`${URL_BASE}/`);
  } catch {
    console.error(`No responde ${URL_BASE}. Levantá el servidor con "npm run dev" en otra terminal.`);
    process.exit(1);
  }

  const todas = leerRegistro();
  const objetivo = soloEstas.length ? soloEstas : todas;
  const desconocidas = objetivo.filter((id) => !todas.includes(id));
  if (desconocidas.length) {
    console.error(`No están en el registro: ${desconocidas.join(", ")}`);
    console.error(`Registradas: ${todas.join(", ")}`);
    process.exit(1);
  }

  if (!existsSync(SALIDA)) mkdirSync(SALIDA, { recursive: true });

  const perfil = mkdtempSync(join(tmpdir(), "hornear-"));
  const edge = spawn(
    EDGE,
    [
      `--remote-debugging-port=${PUERTO}`,
      `--user-data-dir=${perfil}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-swiftshader",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  // Chromium deja vivos a todos sus hijos si se mata solo al padre. Ya
  // pasó: quedaron 509 procesos sueltos rindiendo WebGPU, se robaban la
  // GPU y terminaron contribuyendo a un apagón por temperatura. Siempre
  // el ÁRBOL, y siempre pase lo que pase.
  const matarNavegador = () => {
    try {
      execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" });
    } catch {
      try {
        edge.kill();
      } catch {
        /* ya no existe */
      }
    }
  };
  process.on("exit", matarNavegador);
  process.on("SIGINT", () => {
    matarNavegador();
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
    console.error("Edge no expuso el puerto de depuración.");
    process.exit(1);
  }

  const ws = new WebSocket(objetivos.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, mal) => {
    ws.addEventListener("open", ok);
    ws.addEventListener("error", mal);
  });
  const enviar = cliente(ws);
  await enviar("Runtime.enable");
  await enviar("Page.enable");

  let fallos = 0;
  for (const id of objetivo) {
    process.stdout.write(`\n${id}: `);
    await enviar("Page.navigate", { url: `${URL_BASE}/scripts/hornear/index.html?escena=${id}` });

    let r = null;
    for (let i = 0; i < 180; i++) {
      await dormir(1000);
      try {
        const ev = await enviar("Runtime.evaluate", {
          // El PNG se pide aparte: va en base64 y pesa megas, no hay por
          // qué arrastrarlo en cada sondeo.
          expression: 'window.__resultado ? JSON.stringify({ ...window.__resultado, png: undefined }) : "null"',
          returnByValue: true,
        });
        const o = JSON.parse(ev.result.value);
        if (o && o.estado !== "corriendo") {
          r = o;
          break;
        }
      } catch {
        /* la página todavía está cargando */
      }
    }

    if (!r) {
      console.log("TIEMPO AGOTADO");
      fallos++;
      continue;
    }
    if (r.estado !== "OK") {
      console.log(`${r.estado}\n  ${r.errores.join("\n  ")}`);
      fallos++;
      continue;
    }

    const ev = await enviar("Runtime.evaluate", { expression: "window.__resultado.png", returnByValue: true });
    const png = Buffer.from(String(ev.result.value).split(",")[1], "base64");

    // Bajar la calidad hasta entrar en el presupuesto de peso: una app
    // que se abre en pleno stream no puede arrastrar fondos pesados.
    let guardado = null;
    for (const calidad of [58, 50, 44, 38, 32, 26]) {
      const buf = await sharp(png).resize({ width: ANCHO_FINAL }).avif({ quality: calidad, effort: 6 }).toBuffer();
      if (buf.length <= MAX_KB * 1024) {
        guardado = { buf, calidad };
        break;
      }
    }
    if (!guardado) {
      console.log(`no entró en ${MAX_KB} KB ni con la calidad más baja`);
      fallos++;
      continue;
    }

    writeFileSync(join(SALIDA, `${id}.avif`), guardado.buf);
    console.log(
      `${(guardado.buf.length / 1024).toFixed(1)} KB (calidad ${guardado.calidad}, render ${r.medidas}, GPU ${r.gpu})`,
    );
  }

  ws.close();
  const t = temperaturaGpu();
  console.log(`\nListo.${t !== null ? ` GPU a ${t} °C.` : ""}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
