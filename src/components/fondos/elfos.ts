import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SKYLINE_WGSL, SEGMENTO_WGSL } from "./siluetas";
import { crearParticulas, crearPasto } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Ashenvale de noche: el bosque de los elfos nocturnos de Warcraft III.
//
// Lo que lo identifica no es el bosque -- hay bosques en media docena
// de juegos -- sino DOS cosas muy concretas:
//
//   1. el azul. Ashenvale es el único bosque que no es verde: es
//      turquesa y violeta, iluminado por la luna y no por el sol;
//   2. el POZO LUNAR, esa piscina que brilla desde adentro. No hay otro
//      juego con eso, y es lo que vuelve el lugar inconfundible.
//
// El pozo usa el mismo sombreado de agua que la tormenta (Fresnel de
// Schlick + reflejo direccional), pero con la luz saliendo del agua en
// vez de cayendo sobre ella.
//
// OJO: los colores van en espacio LINEAL y se codifican a sRGB, que los
// aclara bastante. Las fuentes de luz van POR ENCIMA de 1 o el mapeo de
// tonos las aplana contra su propio halo.
// Nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const ELFOS_WGSL = wgslFn(
  /* wgsl */ `
  fn elfos( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo nocturno ----------
    var col = mix(
      vec3<f32>( 0.035, 0.085, 0.090 ),
      vec3<f32>( 0.020, 0.026, 0.075 ),
      smoothstep( 0.25, 0.95, uvIn.y )
    );

    // Estrellas entre las copas.
    let gp = p * 52.0;
    let celda = floor( gp );
    let h = hash21( celda );
    let titila = 0.5 + 0.5 * sin( t * ( 0.7 + h * 2.2 ) + h * 40.0 );
    let estrella = smoothstep( 0.10, 0.0, length( fract( gp ) - vec2<f32>( hash21( celda + 3.3 ), hash21( celda + 7.7 ) ) ) ) * step( 0.978, h );
    col = col + vec3<f32>( 0.60, 0.80, 0.85 ) * estrella * titila * smoothstep( 0.35, 0.80, uvIn.y );

    // ---------- La luna ----------
    let luna = vec2<f32>( 0.38, 0.80 );
    let dLuna = length( p - luna );
    col = col + vec3<f32>( 0.20, 0.45, 0.50 ) * smoothstep( 0.40, 0.0, dLuna ) * 0.30;
    // Por encima de 1: así sobrevive al mapeo de tonos y se lee como
    // fuente de luz en vez de como una mancha clara.
    col = mix( col, vec3<f32>( 2.2, 2.4, 2.3 ), smoothstep( 0.055, 0.050, dLuna ) );

    // ---------- Neblina lunar ----------
    // Lo que de verdad dice "Ashenvale": la luz de luna colándose entre
    // los árboles en haces visibles.
    let dir = p - luna;
    let ang = atan2( dir.y, dir.x );
    let haz = fbm2( vec2<f32>( ang * 3.4, t * 0.04 ) );
    let fuerzaHaz = smoothstep( 0.48, 1.0, haz ) * smoothstep( 1.3, 0.05, length( dir ) ) * smoothstep( 0.10, 0.55, uvIn.y );
    col = col + vec3<f32>( 0.28, 0.62, 0.68 ) * fuerzaHaz * 0.22;

    // ---------- Líneas de bosque ----------
    // De LEJOS a CERCA: al revés, la capa lejana tapa a la cercana y se
    // pierde la profundidad.
    for ( var capa = 0; capa < 3; capa = capa + 1 ) {
      let fc = 2.0 - f32( capa );
      let hb = skyline( p.x + fc * 21.3, 2.4 + fc * 1.6, 0.32 - fc * 0.045, 0.10 - fc * 0.018, 0.004 + fc * 0.006, t );
      let m = smoothstep( hb + 0.004, hb - 0.004, uvIn.y );
      let tono = mix( vec3<f32>( 0.012, 0.030, 0.034 ), vec3<f32>( 0.030, 0.070, 0.075 ), fc / 2.0 );
      col = mix( col, mix( tono, col, 0.06 + fc * 0.14 ), m );
    }

    // ---------- Árboles ancestrales ----------
    // Troncos gruesísimos: los árboles de Ashenvale son enormes, y esa
    // escala es parte del reconocimiento. Van a los costados para no
    // tapar el centro.
    let viento = sin( t * 0.30 ) * 0.008;
    var tronco = 0.0;
    var filo = 0.0;
    for ( var i = 0; i < 3; i = i + 1 ) {
      let fi = f32( i );
      let lado = select( -1.0, 1.0, hash21( vec2<f32>( fi, 31.0 ) ) > 0.45 );
      let cx = lado * ( 0.56 + hash21( vec2<f32>( fi, 7.0 ) ) * 0.30 );
      let inclina = ( hash21( vec2<f32>( fi, 17.0 ) ) - 0.5 ) * 0.10;
      let cxx = cx + inclina * ( uvIn.y - 0.35 ) + viento * uvIn.y * uvIn.y;
      let ancho = ( 0.055 + hash21( vec2<f32>( fi, 13.0 ) ) * 0.030 ) * ( 1.0 - uvIn.y * 0.30 );
      let dx = p.x - cxx;
      let masa = smoothstep( ancho, ancho * 0.84, abs( dx ) );
      tronco = max( tronco, masa );
      // Luz de luna en el canto que mira hacia ella.
      let haciaLuna = step( 0.0, dx * select( -1.0, 1.0, luna.x > cxx ) );
      filo = max( filo, masa * smoothstep( ancho * 0.74, ancho, abs( dx ) ) * haciaLuna );
    }
    col = mix( col, vec3<f32>( 0.008, 0.020, 0.024 ), tronco );
    col = col + vec3<f32>( 0.30, 0.62, 0.70 ) * filo * 0.45;

    // ---------- El pozo lunar ----------
    // El elemento que no tiene ningún otro juego. Misma técnica de agua
    // que la tormenta, pero la luz SALE del pozo en vez de caerle
    // encima: por eso el centro es lo más brillante y el borde se
    // apaga.
    let bordePozo = 0.150;
    let mPozo = smoothstep( bordePozo + 0.003, bordePozo - 0.003, uvIn.y );
    let bajo = max( bordePozo - uvIn.y, 0.0012 );
    let prof = 0.075 / bajo;
    let mundo = vec2<f32>( p.x * prof * 2.2, prof );

    var alturaOla = 0.0;
    var pendX = 0.0;
    var pendZ = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      let a = 0.8 + fi * 1.55;
      let d = vec2<f32>( cos( a ), sin( a ) );
      let k = 3.2 * pow( 1.8, fi );
      let amp = 0.055 / pow( 1.8, fi );
      let fase = dot( d, mundo ) * k + t * ( 0.7 + fi * 0.3 );
      alturaOla = alturaOla + sin( fase ) * amp;
      let der = cos( fase ) * amp * k;
      pendX = pendX + der * d.x;
      pendZ = pendZ + der * d.y;
    }
    let detalle = smoothstep( 0.0, 0.050, bajo );
    let normal = normalize( vec3<f32>( -pendX * detalle, 1.0, -pendZ * detalle ) );
    let vista = normalize( vec3<f32>( p.x * 0.75, -0.30 - bajo * 2.6, -1.0 ) );
    let cosV = max( dot( normal, -vista ), 0.0 );
    let fresnel = clamp( 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 ), 0.0, 1.0 );

    // El agua del pozo EMITE. El brillo crece hacia el centro y con la
    // altura de la ola, así las crestas se encienden.
    let haciaCentro = smoothstep( 0.85, 0.0, abs( p.x ) );
    let pulso = 0.82 + 0.18 * sin( t * 0.9 );
    let emision = vec3<f32>( 0.10, 0.70, 0.85 ) * ( 0.45 + smoothstep( -0.03, 0.05, alturaOla ) * 0.9 ) * haciaCentro * pulso;
    let reflejoCielo = vec3<f32>( 0.030, 0.075, 0.095 );
    var colPozo = mix( emision, emision + reflejoCielo, fresnel );
    // Espuma luminosa en las crestas.
    let texturaEspuma = fbm2( mundo * 7.0 + vec2<f32>( t * 0.2, 0.0 ) );
    colPozo = colPozo + vec3<f32>( 0.35, 0.95, 1.0 ) * smoothstep( 0.028, 0.055, alturaOla ) * smoothstep( 0.45, 0.70, texturaEspuma ) * haciaCentro * 0.8;
    col = mix( col, colPozo, mPozo );

    // El resplandor del pozo sube y tiñe el aire y los troncos de
    // alrededor: es lo que lo integra a la escena en vez de dejarlo
    // como un recorte pegado abajo.
    col = col + vec3<f32>( 0.08, 0.40, 0.48 ) * smoothstep( 0.42, 0.14, uvIn.y ) * haciaCentro * pulso * 0.30;

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.10, 0.25, dv ), 0.68 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(SKYLINE_WGSL),
    comoInclude(SEGMENTO_WGSL),
    comoInclude(FBM_WGSL),
    comoInclude(FBM2_WGSL),
    comoInclude(RUIDO_WGSL),
    comoInclude(HASH_WGSL),
  ],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaElfos(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = ELFOS_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Helechos del sotobosque: azulados, no verdes, y cortos para no
  // competir con el pozo.
  const helechos = crearPasto(scene, {
    cantidad: 1100,
    base: [-0.44, -0.54],
    altura: [0.030, 0.090],
    colorBase: [0.006, 0.020, 0.024],
    colorMedio: [0.020, 0.075, 0.075],
    colorPunta: [0.09, 0.32, 0.34],
    viento: 0.7,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Fuegos fatuos: pocos, grandes y lentos. Son espíritus, se miran de
  // a uno; si fueran cientos serían luciérnagas.
  const fatuos = crearParticulas(scene, aspectoUniform, {
    cantidad: 110,
    caida: -0.028,
    deriva: 0.06,
    vaiven: 0.040,
    frecuenciaVaiven: 0.4,
    tamano: [0.0030, 0.0062],
    estirado: 1,
    giro: 2,
    forma: "redonda",
    color: [0.05, 0.22, 0.26],
    colorVivo: [0.40, 1.10, 1.20],
    sesgoBrillo: 1.2,
    profundidad: PROFUNDIDAD_PLANO + 2,
    orden: 2,
  });

  // Esporas finas a la deriva, para que el aire no esté vacío.
  const esporas = crearParticulas(scene, aspectoUniform, {
    cantidad: 420,
    caida: -0.012,
    deriva: 0.10,
    vaiven: 0.022,
    frecuenciaVaiven: 0.6,
    tamano: [0.0009, 0.0018],
    estirado: 1,
    giro: 4,
    forma: "redonda",
    color: [0.04, 0.12, 0.14],
    colorVivo: [0.18, 0.45, 0.50],
    sesgoBrillo: 2.2,
    profundidad: PROFUNDIDAD_PLANO + 3,
    orden: 3,
  });

  return Promise.resolve({
    updater: () => {
      // Todo el movimiento va con el uniform "time" dentro del shader.
    },
    alRedimensionar: (camera) => {
      aspectoUniform.value = camera.aspect;
      const distancia = camera.position.z - plano.position.z;
      const alturaVisible = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      plano.scale.set(alturaVisible * camera.aspect * 1.02, alturaVisible * 1.02, 1);
      helechos.ajustarA(camera);
      fatuos.ajustarA(camera);
      esporas.ajustarA(camera);
    },
  });
}
