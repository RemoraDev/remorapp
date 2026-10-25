import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { WebGPURenderer, MeshBasicNodeMaterial } from "three/webgpu";
import {
  texture,
  uv,
  time,
  float,
  vec2,
  vec3,
  vec4,
  sin,
  length,
  smoothstep,
  rotateUV,
  uniform,
  wgslFn,
  min as tslMin,
} from "three/tsl";
import { isTauri } from "@tauri-apps/api/core";
import { IMAGEN_FONDO_WEBGPU } from "../types/tournaments";
import type { FondoBracketWebgpu } from "../types/tournaments";

// Migración 213/214, a pedido del usuario: reemplaza por completo al
// motor WebGL anterior (FondoWebgl.tsx, eliminado) -- "no era WebGL,
// era WebGPU", sin ningún respaldo a WebGL. Usa Three.js +
// WebGPURenderer (three/webgpu).
//
// Corrección importante tras probarlo: la primera versión usaba
// THREE.ShaderMaterial (GLSL a mano) para el parpadeo de estrellas --
// se veía todo negro. Investigando el propio build de three/webgpu:
// ShaderMaterial se RE-EXPORTA (existe la clase, no tira error al
// construirla) pero no tiene NINGÚN cableado interno al pipeline de
// nodos de WebGPU -- WebGPURenderer no sabe traducir GLSL crudo de un
// ShaderMaterial clásico, lo renderiza invisible sin ningún error en
// consola. La forma soportada de verdad es TSL (Three Shading
// Language, three/tsl), usada acá vía colorNode sobre
// MeshBasicNodeMaterial.
//
// Segunda corrección, también a pedido del usuario: las primeras 5
// escenas (nebulosa, campo_estelar, aurora, supernova, infierno) eran
// texturas 100% procedurales dibujadas a mano en un <canvas> -- "feas
// y poco modernas". Se reemplazaron por un único fondo basado en una
// foto real (provista por el usuario, convertida a AVIF/códec AV1) con
// efectos de movimiento (zoom, balanceo, viñeta, destellos) calculados
// en GPU vía TSL. El tipo FondoBracketWebgpu sigue teniendo 5 valores
// (no se tocó, para no romper selecciones ya guardadas en la base),
// pero las 5 ahora renderizan la misma escena aprobada -- ver ESCENAS
// más abajo.
//
// Riesgo conocido y sin resolver todavía: a diferencia de WebGL
// (preserveDrawingBuffer:true), WebGPURenderer no tiene un equivalente
// documentado para garantizar que "Compartir imagen" (html-to-image)
// capture el canvas bien -- hay que probarlo en la app real.
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Starfield {
  points: THREE.Points;
  baseColors: Float32Array;
  phases: Float32Array;
}

// Campo de estrellas con parpadeo real, independiente por partícula --
// el color base de cada una se escala cada frame por un seno con fase
// propia (actualizado en JS, no en GPU) para que no titilen todas
// juntas. PointsMaterial no soporta tamaño por punto sin un shader
// propio, así que la variación de tamaño se logra con VARIAS capas
// (near/far), cada una con su propio tamaño fijo.
function makeStarfield(count: number, spread: number, depth: number, size: number, warmChance: number): Starfield {
  const positions = new Float32Array(count * 3);
  const baseColors = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rand(-spread, spread);
    positions[i * 3 + 1] = rand(-spread * 0.6, spread * 0.6);
    positions[i * 3 + 2] = rand(-depth, depth * 0.2);
    const warm = Math.random() < warmChance;
    const cool = Math.random() < 0.25 && !warm;
    const r = warm ? 1 : cool ? 0.75 : 0.95;
    const g = warm ? 0.78 : cool ? 0.85 : 0.95;
    const b = warm ? 0.55 : cool ? 1 : 0.95;
    baseColors[i * 3] = r;
    baseColors[i * 3 + 1] = g;
    baseColors[i * 3 + 2] = b;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    phases[i] = rand(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  return { points, baseColors, phases };
}

function updateTwinkle(star: Starfield, t: number) {
  const colorAttr = star.points.geometry.getAttribute("color") as THREE.BufferAttribute;
  const arr = colorAttr.array as Float32Array;
  const { baseColors, phases } = star;
  for (let i = 0; i < phases.length; i++) {
    const twinkle = 0.45 + 0.55 * Math.sin(t * (1.2 + phases[i]) + phases[i] * 10);
    arr[i * 3] = baseColors[i * 3] * twinkle;
    arr[i * 3 + 1] = baseColors[i * 3 + 1] * twinkle;
    arr[i * 3 + 2] = baseColors[i * 3 + 2] * twinkle;
  }
  colorAttr.needsUpdate = true;
}

type Updater = (t: number) => void;

interface ResultadoEscena {
  updater: Updater;
  // Se llama después de redimensionar() -- deja que la escena
  // recalcule tamaños que dependen del aspecto real de la cámara
  // (pantalla normal vs. pantalla completa, cambios de tamaño de
  // ventana, etc.), en vez de quedar fijos al tamaño que tenía el
  // contenedor cuando se armó la escena.
  alRedimensionar?: (camera: THREE.PerspectiveCamera) => void;
}

const PROFUNDIDAD_PLANO = -80;

// Lluvia de meteoros + cometa esporádico, lejos del plano principal.
// Cada meteoro/cometa es un segmento de línea (cabeza brillante, cola
// apagada vía vertexColors) para que se note como una estela de
// verdad y no solo un punto parpadeando. Todo CPU-driven (igual que el
// parpadeo de estrellas) -- a esta escala de partículas es más simple
// y barato que escribirlo en TSL, y ya está probado que funciona.
function crearCieloDinamico(scene: THREE.Scene): Updater {
  interface Particula {
    activo: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vida: number;
    vidaTotal: number;
  }

  const MAX_METEOROS = 10;
  const meteoroPos = new Float32Array(MAX_METEOROS * 2 * 3);
  const meteoroCol = new Float32Array(MAX_METEOROS * 2 * 3);
  const meteoroGeo = new THREE.BufferGeometry();
  meteoroGeo.setAttribute("position", new THREE.BufferAttribute(meteoroPos, 3));
  meteoroGeo.setAttribute("color", new THREE.BufferAttribute(meteoroCol, 3));
  const meteoroMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const meteoroLineas = new THREE.LineSegments(meteoroGeo, meteoroMat);
  meteoroLineas.visible = false;
  scene.add(meteoroLineas);
  // true cuando el buffer todavía tiene restos del último meteorito y hay
  // que limpiarlo una vez más (ver el updater, más abajo).
  let meteoroSucio = false;

  const meteoros: Particula[] = Array.from({ length: MAX_METEOROS }, () => ({
    activo: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vida: 0,
    vidaTotal: 1,
  }));

  function lanzarMeteoro(m: Particula) {
    m.activo = true;
    m.x = rand(-150, -50);
    m.y = rand(35, 70);
    m.z = rand(-170, -110);
    const velocidad = rand(70, 100);
    const angulo = rand(-0.55, -0.3);
    m.vx = velocidad * Math.cos(angulo);
    m.vy = velocidad * Math.sin(angulo);
    m.vidaTotal = rand(1.0, 1.8);
    m.vida = m.vidaTotal;
  }

  let proximaLluvia = rand(6, 14);

  // Cometa: una sola partícula, más grande, más lenta, mucho menos
  // frecuente, con cola más larga.
  const cometa: Particula = { activo: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vida: 0, vidaTotal: 1 };
  let proximoCometa = rand(18, 32);

  function lanzarCometa() {
    cometa.activo = true;
    cometa.x = rand(-180, -120);
    cometa.y = rand(-20, 50);
    cometa.z = rand(-200, -140);
    const velocidad = rand(26, 36);
    const angulo = rand(-0.15, 0.1);
    cometa.vx = velocidad * Math.cos(angulo);
    cometa.vy = velocidad * Math.sin(angulo);
    cometa.vidaTotal = rand(6, 9);
    cometa.vida = cometa.vidaTotal;
  }

  const cometaGeo = new THREE.BufferGeometry();
  cometaGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  cometaGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  const cometaMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cometaLinea = new THREE.Line(cometaGeo, cometaMat);
  cometaLinea.visible = false;
  scene.add(cometaLinea);

  const cometaNucleoGeo = new THREE.BufferGeometry();
  cometaNucleoGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const cometaNucleoMat = new THREE.PointsMaterial({
    color: 0xeaf4ff,
    size: 3.2,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const cometaNucleo = new THREE.Points(cometaNucleoGeo, cometaNucleoMat);
  cometaNucleo.visible = false;
  scene.add(cometaNucleo);

  function escribirSegmento(pos: Float32Array, col: Float32Array, i: number, m: Particula, largo: number) {
    const mag = Math.hypot(m.vx, m.vy) || 1;
    const colaX = m.x - (m.vx / mag) * largo;
    const colaY = m.y - (m.vy / mag) * largo;
    const aparecer = Math.min(1, (m.vidaTotal - m.vida) / 0.15);
    const apagarse = Math.min(1, m.vida / 0.3);
    const brillo = m.activo ? aparecer * apagarse : 0;
    pos[i * 6 + 0] = m.x;
    pos[i * 6 + 1] = m.y;
    pos[i * 6 + 2] = m.z;
    col[i * 6 + 0] = brillo;
    col[i * 6 + 1] = brillo;
    col[i * 6 + 2] = brillo;
    pos[i * 6 + 3] = colaX;
    pos[i * 6 + 4] = colaY;
    pos[i * 6 + 5] = m.z;
    col[i * 6 + 3] = 0;
    col[i * 6 + 4] = 0;
    col[i * 6 + 5] = 0;
  }

  let tAnterior = 0;
  return (t) => {
    const dt = Math.max(0, Math.min(0.1, t - tAnterior));
    tAnterior = t;

    proximaLluvia -= dt;
    if (proximaLluvia <= 0) {
      proximaLluvia = rand(16, 30);
      let lanzados = 0;
      const cantidad = Math.floor(rand(4, 8));
      for (const m of meteoros) {
        if (!m.activo && lanzados < cantidad) {
          lanzarMeteoro(m);
          lanzados++;
        }
      }
    }
    proximoCometa -= dt;
    if (proximoCometa <= 0 && !cometa.activo) {
      proximoCometa = rand(35, 60);
      lanzarCometa();
    }

    // Rendimiento: antes esto reescribía los dos atributos y los volvía a
    // subir a la GPU TODOS los frames, aun sin ningún meteorito activo --
    // y los meteoritos solo aparecen unos pocos segundos cada ~20. Ahora
    // solo se toca el buffer cuando hay algo que dibujar (o en el frame en
    // que se apaga el último, para dejarlo limpio).
    let algunoActivo = false;
    meteoros.forEach((m, i) => {
      if (m.activo) {
        m.vida -= dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.vida <= 0) m.activo = false;
        escribirSegmento(meteoroPos, meteoroCol, i, m, 7);
        algunoActivo = true;
      } else if (meteoroSucio) {
        escribirSegmento(meteoroPos, meteoroCol, i, m, 7);
      }
    });
    if (algunoActivo || meteoroSucio) {
      (meteoroGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (meteoroGeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }
    meteoroSucio = algunoActivo;
    meteoroLineas.visible = algunoActivo;

    if (cometa.activo) {
      cometa.vida -= dt;
      cometa.x += cometa.vx * dt;
      cometa.y += cometa.vy * dt;
      if (cometa.vida <= 0) cometa.activo = false;
    }
    cometaLinea.visible = cometa.activo;
    cometaNucleo.visible = cometa.activo;
    if (cometa.activo) {
      escribirSegmento(cometaGeo.getAttribute("position").array as Float32Array, cometaGeo.getAttribute("color").array as Float32Array, 0, cometa, 22);
      (cometaGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (cometaGeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      cometaNucleo.position.set(cometa.x, cometa.y, cometa.z);
      const aparecer = Math.min(1, (cometa.vidaTotal - cometa.vida) / 0.6);
      const apagarse = Math.min(1, cometa.vida / 0.6);
      cometaNucleoMat.opacity = aparecer * apagarse;
    }
  };
}

// ---------------------------------------------------------------------
// "Darle vida" a la foto: atmósfera, nubes en movimiento, aurora y luces
// nocturnas, en WGSL escrito a mano (wgslFn), no componiendo nodos TSL.
//
// Por qué WGSL crudo: con nodos TSL cada operación es un objeto y no hay
// forma de meter una rama; acá puedo saltear por completo el cálculo caro
// en los píxeles que son espacio vacío (la mayoría), y controlar el costo
// instrucción por instrucción. wgslFn recibe los parámetros ya evaluados
// como nodos, así que el muestreo de la textura sigue haciéndose en TSL.
//
// Por qué la geometría sale de la FOTO y no de un disco hardcodeado:
// medí ambas imágenes (scripts/medir-discos-fondos.mjs) ajustando una
// circunferencia al cuerpo del planeta, y el error dio 28-40% del radio
// -- con un planeta parcialmente iluminado, un umbral de brillo recorta
// una MEDIALUNA, y el borde de esa medialuna incluye el terminador, que
// no está sobre el limbo. Un círculo fijo quedaría desalineado. En
// cambio, el gradiente de brillo de la propia foto da gratis:
//   - su MAGNITUD marca el limbo (el borde iluminado del planeta),
//   - su DIRECCIÓN apunta de la sombra hacia la luz (la normal aparente),
//   - su PERPENDICULAR da la tangente al limbo, que es por donde corren
//     las bandas de un planeta real.
// Eso se auto-alinea con la foto, sobrevive al zoom/balanceo Ken Burns, y
// sigue funcionando si mañana se cambian las imágenes.
//
// El parser de wgslFn toma SOLO la primera función de cada bloque (su
// regex está anclado con ^), así que los helpers van por "includes".
//
// El cast: @types/three tipa `includes` como CodeNodeInclude (un objeto
// con build()), pero wgslFn() devuelve una función invocable que envuelve
// al FunctionNode, y pasarla directo es justamente lo que documenta el
// propio build de three en su ejemplo de wgslFn. Los includes se cachean
// por nodo al generarse, así que repetir uno no lo duplica en el WGSL.
type IncludeWgsl = { build(builder: unknown): void };
const comoInclude = (fn: unknown) => fn as IncludeWgsl;
const HASH_WGSL = wgslFn(/* wgsl */ `
  fn hash21( p: vec2<f32> ) -> f32 {
    var p3 = fract( vec3<f32>( p.x, p.y, p.x ) * 0.1031 );
    p3 = p3 + dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
`);

const RUIDO_WGSL = wgslFn(
  /* wgsl */ `
  fn ruido( p: vec2<f32> ) -> f32 {
    let i = floor( p );
    let f = fract( p );
    let u = f * f * ( 3.0 - 2.0 * f );
    let a = hash21( i );
    let b = hash21( i + vec2<f32>( 1.0, 0.0 ) );
    let c = hash21( i + vec2<f32>( 0.0, 1.0 ) );
    let d = hash21( i + vec2<f32>( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }
`,
  [comoInclude(HASH_WGSL)],
);

const darVida = wgslFn(
  /* wgsl */ `
  fn darVida(
    base: vec3<f32>,
    lumDer: f32,
    lumIzq: f32,
    lumAba: f32,
    lumArr: f32,
    rgbAncha: vec3<f32>,
    uvImg: vec2<f32>,
    t: f32,
    vineta: f32,
    colAtmo: vec3<f32>,
    ajustes: vec4<f32>
  ) -> vec4<f32> {
    let lum = dot( base, vec3<f32>( 0.299, 0.587, 0.114 ) );

    // Geometría derivada de la foto (ver nota larga arriba).
    let grad = vec2<f32>( lumDer - lumIzq, lumAba - lumArr );
    let gmag = length( grad );
    let normal = select( vec2<f32>( 0.0, -1.0 ), grad / max( gmag, 0.00001 ), gmag > 0.00001 );
    let tang = vec2<f32>( -normal.y, normal.x );

    // (Ojo: estos bloques WGSL viven dentro de un template literal de JS.
    // Nada de comillas invertidas ni de dólar-llave acá adentro: cortan la
    // cadena en silencio y el shader se emite truncado, sin que tsc ni vite
    // se quejen. Lo caza scripts/revisar-wgsl-fondos.mjs.)
    let limbo = smoothstep( 0.011, 0.10, gmag );

    var col = base * vineta;

    // --- Velo atmosférico: turbulencia lenta, SOLO en la banda del limbo ---
    // Antes esto estampaba "nubes" sobre toda la cara iluminada, y el
    // resultado era una luna con clima: un cuerpo sin atmósfera cubierto de
    // nubes en movimiento. Se ve llamativo y es falso. La atmósfera está
    // donde está el limbo, así que la turbulencia modula el HALO y no la
    // roca: las superficies sólidas quedan tal cual las trae la foto.
    // Además la rama se saltea en el espacio vacío y en el interior de los
    // cuerpos, que entre los dos son casi todos los píxeles del cuadro.
    var halo = limbo;
    if ( ajustes.x > 0.0 && limbo > 0.01 ) {
      // El flujo corre PARALELO al limbo, como las bandas de latitud.
      var p = uvImg * 9.0 + tang * t * 0.035;
      // Warp de dominio: una octava arrastra a la otra -> remolinos en vez
      // de un patrón plano y repetido.
      let w = ruido( p * 0.6 + vec2<f32>( t * 0.015, 0.0 ) );
      p = p + vec2<f32>( w, w * 0.6 ) * 1.1;
      var n = ruido( p );
      // La segunda octava (el detalle fino del velo) sólo en escritorio:
      // es el único efecto caro que queda, así que es lo que define el
      // escalón de calidad.
      if ( ajustes.z > 0.5 ) {
        n = n * 0.65 + ruido( p * 2.4 ) * 0.35;
      }
      halo = limbo * mix( 1.0, 0.45 + 1.1 * n, ajustes.x );
    }

    // --- Atmósfera: dispersión en el limbo, respirando lento ---
    // El (1 - lum) evita quemar el limbo donde la foto YA está al máximo:
    // sumar parejo ahí sólo recorta a blanco y se come el detalle que la
    // foto ya tenía.
    let respira = 0.85 + 0.15 * sin( t * 0.55 );
    col = col + colAtmo * halo * respira * 0.30 * ( 1.0 - 0.75 * lum );

    // --- Floración de lente ---
    // Lo que ya está muy brillante se derrama sobre lo que lo rodea, que es
    // lo que hace una óptica real y lo que separa un render "plano" de una
    // foto. Sale casi gratis: rgbAncha es un nivel bajo de mipmap, o sea un
    // desenfoque de decenas de píxeles por UNA sola lectura de textura.
    col = col + max( rgbAncha - vec3<f32>( 0.42 ), vec3<f32>( 0.0 ) ) * ajustes.y;

    return vec4<f32>( col, 1.0 );
  }
`,
  [comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);

// Calidad: en escritorio (Tauri) se habilitan los efectos más caros. En
// web/mobile se bajan, tal como pidió el usuario ("en mobile sí o sí dará
// lag"). Se evalúa una sola vez al cargar el módulo.
const CALIDAD = isTauri() ? 1 : 0;

// Parámetros de "vida" por foto. Son estéticos, no geométricos: la
// geometría la saca el shader de la imagen, así que esto no se desalinea.
interface AlmaFondo {
  /** Color de la dispersión atmosférica del limbo. */
  atmo: [number, number, number];
  /** Cuánta turbulencia lenta agita el halo (0 = halo liso). */
  velo: number;
  /** Fuerza de la floración de lente sobre las zonas ya brillantes. */
  floracion: number;
}

// Fábrica de escenas basadas en una foto real (no textura procedural
// de canvas) -- a pedido del usuario tras ver que las escenas
// dibujadas a mano se veían "feas y poco modernas". La imagen se sirve
// pre-convertida a AVIF (códec AV1) desde /public/fondos-webgpu/ y los
// efectos sobre ella (zoom lento, balanceo, viñeta, y todo lo de
// darVida()) se calculan en GPU -- NO con CPU por frame, y NO con
// THREE.ShaderMaterial (ver nota al principio del archivo: ese no
// funciona con WebGPURenderer).
function crearEscenaImagen(rutaImagen: string, alma: AlmaFondo): (scene: THREE.Scene) => Promise<ResultadoEscena> {
  return function escena(scene: THREE.Scene): Promise<ResultadoEscena> {
    scene.fog = new THREE.FogExp2("#040611", 0.004);

    // Rendimiento: eran 650. Cada frame updateTwinkle() hace un Math.sin()
    // por estrella y vuelve a subir TODO el atributo de color a la GPU, así
    // que el conteo pega directo en el costo por frame (y se multiplica por
    // instancia). Con 300 el cielo se sigue viendo poblado.
    const estrellas = makeStarfield(300, 170, 60, 1.0, 0.12);
    scene.add(estrellas.points);
    const cielo = crearCieloDinamico(scene);

    // Valor inicial cualquiera -- se corrige en el primer
    // alRedimensionar(), que corre ANTES del primer frame dibujado.
    const aspectoPlanoUniform = uniform(16 / 9);

    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        rutaImagen,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = 4;

          const aspectoImagen = tex.image.width / tex.image.height;
          const centro = vec2(0.5, 0.5);
          const uvOriginal = uv();

          // Encuadre tipo "cover" (como background-size:cover en CSS),
          // sin ramas de JS -- aspectoPlanoUniform cambia en vivo en
          // cada resize/fullscreen, así que el recorte se recalcula en
          // GPU, no queda fijo al aspecto que tenía el contenedor
          // cuando cargó la imagen.
          const ratio = aspectoPlanoUniform.div(aspectoImagen);
          const escalaX = tslMin(ratio, float(1));
          const escalaY = tslMin(float(1).div(ratio), float(1));
          const uvBase = vec2(uvOriginal.x.sub(0.5).mul(escalaX).add(0.5), uvOriginal.y.sub(0.5).mul(escalaY).add(0.5));

          // Zoom tipo "Ken Burns" muy lento + balanceo sutil -- nada de
          // desplazamiento lateral, para no revelar el borde recortado.
          const zoom = float(1.08).add(sin(time.mul(0.045)).mul(0.035));
          const rotacion = sin(time.mul(0.03)).mul(0.012);
          const uvZoom = uvBase.sub(centro).div(zoom).add(centro);
          const uvFinal = rotateUV(uvZoom, rotacion);

          const base = texture(tex, uvFinal);

          // 4 muestras vecinas en cruz (no en diagonal): además de servir
          // para el halo, dan el GRADIENTE de brillo de la foto, que es de
          // donde sale toda la geometría que usa darVida() -- ver la nota
          // larga arriba de VIDA_WGSL.
          // Radio chico a propósito: con 0.014 el gradiente se detectaba en
          // un anillo DESPEGADO del borde real y el halo salía como un arco
          // flotando al lado del cuerpo.
          const RADIO_TAP = 0.005;
          const tap = (dx: number, dy: number) => {
            const m = texture(tex, uvFinal.add(vec2(dx * RADIO_TAP, dy * RADIO_TAP)));
            return m.r.mul(0.299).add(m.g.mul(0.587)).add(m.b.mul(0.114));
          };

          // Viñeta suave hacia los bordes del plano (no de la imagen
          // recortada) para que se funda con el resto de la tarjeta.
          const distCentro = length(uv().sub(centro));
          const vineta = smoothstep(float(0.72), float(0.16), distCentro);

          // Vecindario ANCHO, de un nivel bajo de mipmap: una sola lectura
          // da un desenfoque real de decenas de píxeles, que es lo que
          // alimenta la floración de lente. Hacerlo a taps costaría varias
          // lecturas y aun así sería un vecindario a puntos, no un
          // promedio.
          const borroso = texture(tex, uvFinal).level(float(5));

          const colorFinal = darVida({
            base: base.rgb,
            lumDer: tap(1, 0),
            lumIzq: tap(-1, 0),
            lumAba: tap(0, 1),
            lumArr: tap(0, -1),
            rgbAncha: borroso.rgb,
            uvImg: uvFinal,
            t: time,
            vineta: vineta.mul(0.6).add(0.4),
            colAtmo: vec3(alma.atmo[0], alma.atmo[1], alma.atmo[2]),
            ajustes: vec4(alma.velo, alma.floracion, CALIDAD, 0),
          });

          const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false });
          // darVida() devuelve vec4<f32> (ver su firma), pero wgslFn tipa su
          // retorno como el Node genérico y TS no puede inferir el tipo.
          mat.colorNode = colorFinal as typeof mat.colorNode;

          // Plano unitario (1x1) escalado en cada resize para cubrir
          // exactamente el encuadre de la cámara -- ver
          // alRedimensionar(). Antes tenía un tamaño fijo en mundo
          // (320x180) que no llegaba a cubrir pantallas muy anchas o
          // dejaba de calzar bien en pantalla completa.
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
          plane.position.set(0, 0, PROFUNDIDAD_PLANO);
          scene.add(plane);

          resolve({
            updater: (t) => {
              updateTwinkle(estrellas, t);
              estrellas.points.rotation.y = Math.sin(t * 0.01) * 0.02;
              cielo(t);
            },
            alRedimensionar: (camera) => {
              aspectoPlanoUniform.value = camera.aspect;
              const distancia = camera.position.z - plane.position.z;
              const alturaVisible = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
              const anchoVisible = alturaVisible * camera.aspect;
              const margen = 1.08;
              plane.scale.set(anchoVisible * margen, alturaVisible * margen, 1);
            },
          });
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  };
}

// Las 5 claves del tipo FondoBracketWebgpu (no tocado, ver nota arriba)
// se reparten entre las fotos reales aprobadas hasta ahora -- el resto
// usa "campo_estelar" (Tierra y luna) como default hasta que se sumen
// más fotos.
// Tierra y luna: atmósfera azul de dispersión Rayleigh.
const escenaCampoEstelar = crearEscenaImagen(IMAGEN_FONDO_WEBGPU.campo_estelar, {
  atmo: [0.34, 0.6, 1.0],
  velo: 0.55,
  floracion: 0.55,
});

// Planeta púrpura: atmósfera magenta. Velo más agitado (es un mundo con
// mucha más nubosidad en el limbo) y floración algo menor, porque la foto
// ya trae una nebulosa brillante de fondo y se empasta.
const escenaNebulosa = crearEscenaImagen(IMAGEN_FONDO_WEBGPU.nebulosa, {
  atmo: [0.85, 0.35, 1.0],
  velo: 0.7,
  floracion: 0.45,
});

const ESCENAS: Record<FondoBracketWebgpu, (scene: THREE.Scene) => Promise<ResultadoEscena>> = {
  nebulosa: escenaNebulosa,
  campo_estelar: escenaCampoEstelar,
  aurora: escenaCampoEstelar,
  supernova: escenaCampoEstelar,
  infierno: escenaCampoEstelar,
};

// ~30 FPS. Ver la nota de rendimiento dentro de frame().
const INTERVALO_FRAME = 1000 / 30;

// Tope de renderers WebGPU vivos a la vez en toda la página.
//
// Esto arregla el "lag enorme" reportado: el componente se monta DENTRO de
// bucles (una instancia por fila en la lista de Clan Wars de
// TeamDetailPage, otra por opción en los selectores de fondo), y cada
// instancia levanta su PROPIO WebGPURenderer -- device, canvas, loop de
// render, escena completa con estrellas y meteoritos, y un fragment shader
// con varios samples de textura por píxel. Cinco o seis de esos en
// paralelo funden cualquier GPU modesta.
//
// Pasado el tope, las instancias extra muestran la misma foto como <img>
// estático (mismo encuadre vía CSS): se ve casi igual, cuesta casi nada, y
// no hay riesgo de quedarse sin contextos WebGPU.
const MAX_RENDERERS_VIVOS = 2;
let renderersVivos = 0;

interface Props {
  variante: FondoBracketWebgpu;
}

export default function FondoWebgpu({ variante }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [estatico, setEstatico] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!("gpu" in navigator)) {
      console.warn("Este navegador no soporta WebGPU -- el fondo animado no se muestra.");
      setEstatico(true);
      return;
    }
    // Ver MAX_RENDERERS_VIVOS: si ya hay demasiados fondos animados en la
    // página, esta instancia se queda con la foto estática.
    if (renderersVivos >= MAX_RENDERERS_VIVOS) {
      setEstatico(true);
      return;
    }
    renderersVivos++;
    setEstatico(false);

    let destruido = false;
    let rafId: number | null = null;
    let renderer: WebGPURenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let visible = true;
    // Corrección QA: arrancar en true (no "!document.hidden &&
    // document.hasFocus()") -- ese chequeo se evalúa UNA sola vez, al
    // montar, y document.hasFocus() puede dar false ahí mismo (recién
    // cargada la página, antes de cualquier click adentro, o con
    // DevTools con el foco) sin que ningún evento "focus" futuro lo
    // corrija nunca -- el loop de render quedaba "pausado" desde
    // antes de arrancar y nunca llegaba a dibujar el primer frame.
    // Arrancar siempre en true y dejar que blur/visibilitychange lo
    // pausen más tarde si de verdad corresponde es seguro.
    let conFoco = true;
    const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // performance.now() en vez de THREE.Clock -- la consola lo marca
    // como obsoleto ("Please use THREE.Timer instead"), y Timer no
    // forma parte del build de three/webgpu instalado.
    const inicio = performance.now();
    let ultimoFrame = 0;
    let resultado: ResultadoEscena | null = null;
    let canvasCreado: HTMLCanvasElement | null = null;

    function redimensionar() {
      if (!renderer || !camera || !container) return;
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Rendimiento: antes era min(dpr, 2). En una pantalla con dpr 2 eso
      // son 4x los píxeles a sombrear, y esto es una FOTO desenfocada con
      // zoom lento de decoración -- a dpr 1 se ve prácticamente igual y el
      // fragment shader cuesta la cuarta parte. Es, de lejos, el ajuste de
      // mayor impacto del shader.
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      // Deja que la escena recalcule lo que dependa del aspecto real
      // (el plano de la imagen de fondo) -- así cubre bien tanto en
      // ventana normal como en pantalla completa, y al redimensionar.
      resultado?.alRedimensionar?.(camera);
    }

    function frame() {
      if (destruido || !renderer || !scene || !camera) {
        // Bug real encontrado con QA: si esta función se llama antes
        // de que "await renderer.init()" termine (puede pasar --
        // IntersectionObserver/ResizeObserver disparan su callback
        // inicial casi enseguida, antes de que el renderer termine de
        // inicializar), scene/camera todavía son null acá. Sin este
        // reset, rafId quedaba con un id "gastado" para siempre
        // (nunca se reprogramaba el siguiente frame porque el código
        // de abajo, que sí lo hace, nunca se alcanzaba) -- cualquier
        // llamada LEGÍTIMA posterior a asegurarLoopCorriendo() veía
        // rafId !== null y nunca volvía a programar nada. El fondo
        // quedaba negro para siempre, sin ningún error en consola.
        rafId = null;
        return;
      }
      const ahora = performance.now();
      // Rendimiento: tope de ~30 FPS. Todo lo que se mueve acá es un zoom
      // lentísimo, estrellas titilando y algún meteorito -- a 30 se ve
      // igual de fluido y se corta a la mitad el trabajo de CPU y GPU.
      // Se agenda igual en cada vsync (requestAnimationFrame) pero se
      // saltea el render cuando todavía no pasó el intervalo.
      if (ahora - ultimoFrame < INTERVALO_FRAME) {
        if (visible && conFoco && !prefiereMenosMovimiento) {
          rafId = requestAnimationFrame(frame);
        } else {
          rafId = null;
        }
        return;
      }
      ultimoFrame = ahora;
      const t = (ahora - inicio) / 1000;
      resultado?.updater(t);
      // render(), no renderAsync() -- la consola del navegador lo marcó
      // como obsoleto ("Use render() and await renderer.init()..."), y
      // llamar renderAsync() sin esperar su promesa dentro de un loop de
      // rAF era la causa más probable de que nunca llegara a presentar
      // un frame (quedaba todo negro).
      renderer.render(scene, camera);
      if (visible && conFoco && !prefiereMenosMovimiento) {
        rafId = requestAnimationFrame(frame);
      } else {
        rafId = null;
      }
    }

    function asegurarLoopCorriendo() {
      // scene/camera también tienen que estar listos -- si no, evitamos
      // programar un frame "gastado" en vano (ver el reset de rafId en
      // frame(), más arriba, que resuelve el caso en que esto se llame
      // de todos modos antes de que termine renderer.init()).
      if (rafId === null && visible && conFoco && !destruido && renderer && scene && camera) {
        rafId = requestAnimationFrame(frame);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) asegurarLoopCorriendo();
      },
      { threshold: 0 }
    );
    observer.observe(container);

    const alPerderFoco = () => {
      conFoco = false;
    };
    const alGanarFoco = () => {
      conFoco = true;
      asegurarLoopCorriendo();
    };
    const alCambiarVisibilidad = () => {
      if (document.hidden) alPerderFoco();
      else alGanarFoco();
    };
    window.addEventListener("blur", alPerderFoco);
    window.addEventListener("focus", alGanarFoco);
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    (async () => {
      try {
        const canvas = document.createElement("canvas");
        // Se guarda la referencia afuera para poder sacarlo del DOM en el
        // cleanup -- ver la nota sobre el canvas huérfano, más abajo.
        canvasCreado = canvas;
        renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
        await renderer.init();
        if (destruido) {
          renderer.dispose();
          return;
        }
        // Sin esto, los colores de las escenas (sobre todo las
        // additive-blended, pensadas para verse "HDR") salían
        // demasiado oscuras -- casi invisibles contra el fondo
        // oscuro de siempre. Mismo criterio que el archivo de
        // referencia del usuario.
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        container.appendChild(canvas);

        scene = new THREE.Scene();
        scene.background = new THREE.Color("#06070a");
        camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
        camera.position.set(0, 0, 40);

        resultado = await ESCENAS[variante](scene);
        if (destruido) return;
        redimensionar();

        if (prefiereMenosMovimiento) {
          frame();
        } else {
          asegurarLoopCorriendo();
        }
      } catch (e) {
        console.error("Error armando el fondo WebGPU:", e);
      }
    })();

    const resizeObserver = new ResizeObserver(() => redimensionar());
    resizeObserver.observe(container);

    return () => {
      destruido = true;
      // Libera el cupo tomado al montar (ver MAX_RENDERERS_VIVOS), para que
      // otro fondo pueda animarse cuando este se desmonta.
      renderersVivos = Math.max(0, renderersVivos - 1);
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("blur", alPerderFoco);
      window.removeEventListener("focus", alGanarFoco);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      scene?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer?.dispose();
      // Bug real: el canvas se agregaba con appendChild pero nunca se
      // sacaba. Al cambiar de fondo (cambia "variante" -> corre este
      // cleanup y después se arma la escena nueva), el canvas viejo
      // quedaba en el DOM congelado en su último frame, y el nuevo se
      // agregaba DEBAJO -- como el canvas es display:block al 100% de
      // alto y el contenedor tiene overflow:hidden, el nuevo quedaba
      // recortado fuera de vista. Se seguía viendo el fondo anterior y
      // solo cambiaba recargando la página con F5.
      canvasCreado?.remove();
      canvasCreado = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variante]);

  return (
    <div ref={containerRef} className="fondo-webgl-canvas-wrap" aria-hidden="true">
      {estatico && <img src={IMAGEN_FONDO_WEBGPU[variante]} alt="" className="fondo-webgpu-estatico" />}
    </div>
  );
}
