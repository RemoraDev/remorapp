// Banco de pruebas del motor. Lo abre un humano para mirar, y lo
// conduce el script de capturas para evaluarlo.
import { crearDispositivo } from "/src/motor/dispositivo.ts";
import { Cielo } from "/src/motor/cielo/cielo.ts";

const res = { estado: "corriendo", errores: [], pasos: [] };
window.__resultado = res;
const paso = (m) => { res.pasos.push(m); console.log("PASO: " + m); };
console.error = ((o) => (...a) => { res.errores.push("console.error: " + a.map(String).join(" ")); o(...a); })(console.error);
window.addEventListener("unhandledrejection", (e) => res.errores.push("rejection: " + String(e.reason)));

const params = new URLSearchParams(location.search);
// Hora del día: lo que más cambia el cielo, así que es el primer
// parámetro que conviene poder barrer para evaluar la atmósfera.
const hora = Number(params.get("hora") ?? 7.5);
const anchoPedido = Number(params.get("ancho") ?? 0);

const lienzo = document.getElementById("lienzo");
const hud = document.getElementById("hud");

try {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ancho = Math.round(anchoPedido || window.innerWidth * dpr);
  const alto = Math.round(anchoPedido ? (anchoPedido * 9) / 16 : window.innerHeight * dpr);
  lienzo.width = ancho;
  lienzo.height = alto;

  const d = await crearDispositivo({ canvas: lienzo, altoRendimiento: true });
  paso(`GPU: ${d.info}  |  medicion: ${d.puedeMedir ? "si" : "no"}`);
  res.gpu = d.info;
  res.puedeMedir = d.puedeMedir;

  d.device.onuncapturederror = (ev) => res.errores.push("WebGPU: " + ev.error.message);
  d.device.lost.then((info) => res.errores.push("device lost: " + info.message));

  const cielo = new Cielo(d, { hora });
  paso(`escena armada, hora ${hora}`);

  const t0 = performance.now();
  let cuadros = 0;
  let ultimoHud = 0;

  function bucle() {
    const t = (performance.now() - t0) / 1000;
    cielo.render(ancho, alto, t);
    cuadros++;

    if (performance.now() - ultimoHud > 250) {
      ultimoHud = performance.now();
      const ms = cielo.medidor.promedioMs;
      res.msGpu = ms;
      res.cuadros = cuadros;
      hud.textContent =
        `${d.info}\n${ancho}x${alto}\nhora ${hora.toFixed(1)}\n` +
        `GPU: ${ms === null ? "midiendo..." : ms.toFixed(2) + " ms"}\ncuadros: ${cuadros}`;
    }
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);

  // Lo mismo que aprendí con las escenas anteriores: un canvas WebGPU
  // solo se puede leer DENTRO de la tarea de su render, nunca desde un
  // setTimeout ni con una captura externa. Por eso la imagen se copia a
  // un canvas 2D justo después de dibujar.
  window.__capturar = () =>
    new Promise((ok) => {
      requestAnimationFrame(() => {
        cielo.render(ancho, alto, (performance.now() - t0) / 1000);
        const aux = document.createElement("canvas");
        aux.width = ancho;
        aux.height = alto;
        aux.getContext("2d").drawImage(lienzo, 0, 0);
        ok(aux.toDataURL("image/png"));
      });
    });

  // Dejar correr unos cuadros antes de declararlo listo: el primero
  // incluye compilar pipelines y generar las tablas.
  setTimeout(() => {
    res.estado = res.errores.length === 0 ? "OK" : "FALLO";
    document.title = "resultado:" + res.estado;
  }, 3000);
} catch (e) {
  res.estado = "EXCEPCION";
  res.errores.push(String(e && e.stack ? e.stack : e));
  document.getElementById("error").textContent = String(e && e.stack ? e.stack : e);
  document.title = "resultado:EXCEPCION";
}
