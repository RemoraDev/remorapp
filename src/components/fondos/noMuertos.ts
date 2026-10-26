import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { ARBOL_PELADO_WGSL, SEGMENTO_WGSL } from "./siluetas";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Tierras malditas: el paisaje de los No Muertos de Warcraft III.
//
// La marca registrada de esa facción no son los esqueletos sino la
// PLAGA: el suelo enfermo, de un gris verdoso que no existe en la
// naturaleza. Quien jugó WC3 reconoce ese verde antes que cualquier
// otra cosa, así que acá es el protagonista y todo lo demás lo
// acompaña.
//
// Ningún elemento es original mío por casualidad: árboles muertos,
// lápidas inclinadas, niebla pesada y espíritus. Son los anclajes que
// hacen decir "esto es Northrend" sin copiar nada de Blizzard.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const NO_MUERTOS_WGSL = wgslFn(
  /* wgsl */ `
  fn noMuertos( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo enfermo ----------
    // Verde pútrido cerca del horizonte, gris violáceo arriba. El verde
    // NO va arriba: si domina el cielo entero satura y deja de dar
    // asco, que es justo el efecto buscado.
    var col = mix(
      vec3<f32>( 0.16, 0.26, 0.14 ),
      vec3<f32>( 0.065, 0.065, 0.095 ),
      smoothstep( 0.12, 0.70, uvIn.y )
    );

    // ---------- Nubes espesas ----------
    // Bajas y pesadas, girando lento: el cielo de la plaga nunca está
    // despejado.
    let qn = vec2<f32>( p.x * 1.7 + t * 0.030, uvIn.y * 3.6 + t * 0.010 );
    let nube = fbm( qn );
    let nubeAbajo = fbm( qn - vec2<f32>( 0.0, 0.20 ) );
    let cuerpo = smoothstep( 0.44, 0.64, nube ) * smoothstep( 0.22, 0.95, uvIn.y );
    col = mix( col, vec3<f32>( 0.085, 0.105, 0.085 ), cuerpo * 0.85 );
    // Resplandor verdoso en el filo inferior: la luz de la plaga viene
    // del suelo, no del cielo.
    let filo = clamp( ( nubeAbajo - nube ) * 6.0, 0.0, 1.0 );
    col = col + vec3<f32>( 0.32, 0.62, 0.22 ) * cuerpo * filo * 0.30;

    // ---------- Suelo infectado ----------
    let hSuelo = 0.185 + fbm2( vec2<f32>( p.x * 1.3, 7.0 ) ) * 0.050;
    let mSuelo = smoothstep( hSuelo + 0.004, hSuelo - 0.004, uvIn.y );

    // ---------- Lápidas ----------
    // Inclinadas y de distinto alto: un cementerio abandonado, no un
    // cementerio cuidado. Van antes que los árboles para que queden
    // detrás.
    var lapidas = 0.0;
    for ( var i = 0; i < 7; i = i + 1 ) {
      let fi = f32( i );
      let lx = ( hash21( vec2<f32>( fi, 101.0 ) ) - 0.5 ) * 1.75;
      let alto = 0.030 + hash21( vec2<f32>( fi, 103.0 ) ) * 0.045;
      let ancho = alto * ( 0.30 + hash21( vec2<f32>( fi, 107.0 ) ) * 0.16 );
      let cae = ( hash21( vec2<f32>( fi, 109.0 ) ) - 0.5 ) * 0.55;
      let rel = uvIn.y - ( hSuelo - 0.012 );
      // La inclinación desplaza la lápida con la altura.
      let dx = abs( p.x - lx - cae * rel );
      // Cuerpo rectangular MÁS tapa redondeada. Un rectángulo pelado
      // se lee como un papel parado; el arco de arriba es lo que
      // convierte la forma en lápida de un vistazo.
      let cuerpo = step( dx, ancho ) * step( 0.0, rel ) * step( rel, alto - ancho );
      let dTapa = length( vec2<f32>( dx, rel - ( alto - ancho ) ) );
      let tapa = step( dTapa, ancho ) * step( alto - ancho, rel );
      lapidas = max( lapidas, max( cuerpo, tapa ) );
    }

    // ---------- Árboles muertos ----------
    let viento = sin( t * 0.42 ) * 0.011 + sin( t * 0.27 + 2.1 ) * 0.007;
    var ramas = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      let bx = ( hash21( vec2<f32>( fi, 113.0 ) ) - 0.5 ) * 1.70;
      let alturaArbol = 0.26 + hash21( vec2<f32>( fi, 127.0 ) ) * 0.28;
      ramas = max( ramas, arbolPelado( p, vec2<f32>( bx, hSuelo - 0.02 ), alturaArbol, fi + 5.0, viento ) );
    }

    // Suelo: gris verdoso, más claro hacia abajo.
    let suelo = mix( vec3<f32>( 0.085, 0.105, 0.070 ), vec3<f32>( 0.145, 0.165, 0.100 ), smoothstep( 0.18, 0.0, uvIn.y ) );
    col = mix( col, suelo, mSuelo );
    col = mix( col, vec3<f32>( 0.185, 0.200, 0.175 ), lapidas );
    col = mix( col, vec3<f32>( 0.030, 0.038, 0.026 ), ramas );

    // ---------- Grietas de plaga ----------
    // Vetas verdes brillantes que recorren el suelo, latiendo. Es lo
    // que hace que la tierra parezca infectada y no solo oscura.
    let veta = fbm( vec2<f32>( p.x * 5.5, uvIn.y * 9.0 + t * 0.05 ) );
    // abs() alrededor de un valor medio deja una LÍNEA fina donde el
    // ruido cruza ese valor, en vez de una mancha.
    let grieta = smoothstep( 0.045, 0.0, abs( veta - 0.5 ) ) * mSuelo;
    let late = 0.65 + 0.35 * sin( t * 1.3 + p.x * 3.0 );
    col = col + vec3<f32>( 0.22, 0.85, 0.18 ) * grieta * late * 0.55;

    // ---------- Niebla ----------
    // Pesada y a ras del suelo, por delante de todo: les tapa los pies
    // a los árboles y a las lápidas, que es lo que la hace leer como
    // niebla y no como un velo de fondo.
    let niebla = fbm2( vec2<f32>( p.x * 1.6 + t * 0.040, uvIn.y * 6.0 + t * 0.018 ) );
    let banda = smoothstep( 0.30, 0.02, uvIn.y ) * smoothstep( 0.38, 0.78, niebla );
    col = mix( col, vec3<f32>( 0.20, 0.30, 0.20 ), banda * 0.80 );

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.10, 0.25, dv ), 0.72 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(ARBOL_PELADO_WGSL),
    comoInclude(SEGMENTO_WGSL),
    comoInclude(FBM_WGSL),
    comoInclude(FBM2_WGSL),
    comoInclude(RUIDO_WGSL),
    comoInclude(HASH_WGSL),
  ],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaNoMuertos(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = NO_MUERTOS_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Espíritus: la misma partícula de siempre, subiendo muy lento y con
  // mucho vaivén. Pocas y grandes a propósito -- un alma en pena se
  // mira de a una; si fueran cientos serían luciérnagas.
  const espiritus = crearParticulas(scene, aspectoUniform, {
    cantidad: 90,
    caida: -0.030,
    deriva: 0.05,
    vaiven: 0.035,
    frecuenciaVaiven: 0.45,
    tamano: [0.0022, 0.0042],
    estirado: 1.8,
    giro: 3,
    color: [0.06, 0.22, 0.06],
    colorVivo: [0.30, 0.75, 0.26],
    sesgoBrillo: 1.3,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Y ceniza cayendo, muy tenue, para que el aire no esté vacío.
  const ceniza = crearParticulas(scene, aspectoUniform, {
    cantidad: 350,
    caida: 0.035,
    deriva: 0.08,
    vaiven: 0.018,
    frecuenciaVaiven: 0.6,
    tamano: [0.0007, 0.0013],
    estirado: 1,
    giro: 5,
    color: [0.11, 0.13, 0.10],
    colorVivo: [0.24, 0.27, 0.21],
    sesgoBrillo: 2,
    profundidad: PROFUNDIDAD_PLANO + 2,
    orden: 2,
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
      espiritus.ajustarA(camera);
      ceniza.ajustarA(camera);
    },
  });
}
