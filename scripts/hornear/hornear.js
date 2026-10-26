// Lógica de la página de horneado.
//
// Vive en un archivo APARTE y no como <script> en línea dentro del
// HTML. Motivo concreto: para un script en línea dentro de un HTML que
// no es la entrada principal, Vite genera un "módulo proxy" cuyo
// registro se pierde al reiniciar el servidor de desarrollo. A partir
// de ahí la página devuelve 500 ("No matching HTML proxy module
// found") y el horneado se queda esperando para siempre. Como archivo
// externo no pasa por ese mecanismo.

import * as THREE from "three/webgpu";
import { escenaProceduralPorId } from "/src/components/fondos/registro.ts";

const params = new URLSearchParams(location.search);
const id = params.get("escena");
// Se rinde al DOBLE y después se reduce: el supermuestreo suaviza
// los bordes de las siluetas mucho mejor que el antialias del
// renderer, y como esto corre una sola vez, el costo no importa.
const ancho = Number(params.get("ancho") || 2200);
const alto = Math.round((ancho * 9) / 16);

const res = { estado: "corriendo", errores: [], pasos: [] };
window.__resultado = res;
window.__render = () => {};
const paso = (m) => { res.pasos.push(m); console.log("PASO: " + m); };
console.error = ((o) => (...a) => { res.errores.push("console.error: " + a.map(String).join(" ")); o(...a); })(console.error);
window.addEventListener("unhandledrejection", (e) => res.errores.push("rejection: " + String(e.reason)));

try {
  const escena = escenaProceduralPorId(id);
  if (!escena) throw new Error(`No hay escena registrada con id "${id}"`);
  paso(`escena: ${escena.etiqueta}`);

  const canvas = document.getElementById("lienzo");
  canvas.width = ancho;
  canvas.height = alto;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(ancho, alto, false);
  await renderer.init();

  if (!renderer.backend?.isWebGPUBackend) throw new Error("no hay backend WebGPU; se abortó para no hornear un render de respaldo");
  // Si Chromium cayó a SwiftShader, el resultado sale distinto al
  // de una GPU real. Mejor avisar que hornear algo que no
  // representa lo que va a ver el usuario.
  try {
    const ad = await navigator.gpu.requestAdapter();
    const info = ad.info || (await ad.requestAdapterInfo?.());
    res.gpu = `${info?.vendor ?? "?"} / ${info?.architecture ?? "?"}`;
    if (/swiftshader|software|llvmpipe/i.test(res.gpu)) res.errores.push("ATENCIÓN: render por software, el horneado no es representativo");
  } catch { res.gpu = "desconocida"; }

  const dev = renderer.backend.device;
  dev.onuncapturederror = (ev) => res.errores.push("WebGPU: " + ev.error.message);

  // Mismos ajustes que usa el componente en vivo, o el horneado
  // saldría con otro color que la escena animada que va encima.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, ancho / alto, 0.1, 500);
  camera.position.set(0, 0, 40);

  const resultado = await escena.construir(scene);
  resultado.alRedimensionar?.(camera);

  // Avanzar hasta el instante elegido. El reloj de las escenas es
  // el uniform "time" de three, que avanza con el reloj real, así
  // que hay que dejar correr los cuadros de verdad.
  const objetivo = escena.segundoCaptura;
  const t0 = performance.now();
  let cuadros = 0;
  while ((performance.now() - t0) / 1000 < objetivo) {
    renderer.render(scene, camera);
    cuadros++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  paso(`${cuadros} cuadros hasta el segundo ${objetivo}`);

  // LA PARTE DELICADA: el contenido de un canvas WebGPU solo se
  // puede leer DENTRO de la misma tarea en la que se renderizó.
  // Desde un setTimeout, o con una captura de pantalla externa,
  // sale negro aunque la escena esté perfecta. Por eso se copia a
  // un canvas 2D acá mismo, pegado al render.
  renderer.render(scene, camera);
  const copia = document.createElement("canvas");
  copia.width = ancho;
  copia.height = alto;
  const ctx = copia.getContext("2d");
  ctx.drawImage(canvas, 0, 0);

  const px = ctx.getImageData(0, 0, Math.min(400, ancho), Math.min(240, alto)).data;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, (px[i] + px[i + 1] + px[i + 2]) / 3);
  if (max < 12) throw new Error("el render salió casi negro; no se hornea");
  res.brilloMax = Math.round(max);

  res.png = copia.toDataURL("image/png");
  res.medidas = `${ancho}x${alto}`;
  res.estado = res.errores.length === 0 ? "OK" : "FALLO";
} catch (e) {
  res.estado = "EXCEPCION";
  res.errores.push(String(e && e.stack ? e.stack : e));
}
document.title = "resultado:" + res.estado;
