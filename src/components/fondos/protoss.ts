import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SKYLINE_WGSL } from "./siluetas";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Aiur: el mundo natal protoss de StarCraft.
//
// Buscando material encontré el dato que define esta escena, y no es el
// que uno esperaría: los cristales khaydarin son AZULES, los protoss
// los usaban para construir plataformas flotantes, y en Aiur había
// masas de tierra con tantos cristales incrustados que FLOTABAN SOLAS.
// Y Aiur no es un desierto de templos: es selva tropical con tormentas.
//
// Así que la escena no es "templo dorado genérico" sino selva con islas
// de roca flotando, sostenidas por cristal azul, y el oro reservado a
// la arquitectura. Ese contraste oro/cian es la firma protoss: ninguno
// de los dos colores solo alcanza.
//
// OJO: los colores van en espacio LINEAL y se codifican a sRGB, que los
// aclara bastante. Las fuentes de luz van POR ENCIMA de 1 o el mapeo de
// tonos las aplana contra su propio halo.
// Nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const PROTOSS_WGSL = wgslFn(
  /* wgsl */ `
  fn protoss( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo ----------
    // Ámbar abajo, turquesa arriba. Las dos mitades de la paleta
    // protoss puestas ya en el fondo.
    var col = mix(
      vec3<f32>( 0.38, 0.21, 0.055 ),
      vec3<f32>( 0.035, 0.115, 0.145 ),
      smoothstep( 0.15, 0.85, uvIn.y )
    );

    // Nubes altas de tormenta, que es el clima propio de Aiur.
    let qn = vec2<f32>( p.x * 1.6 + t * 0.028, uvIn.y * 3.4 );
    let nube = fbm( qn );
    let nubeArriba = fbm( qn + vec2<f32>( 0.0, 0.16 ) );
    let alto = smoothstep( 0.42, 0.98, uvIn.y );
    let cuerpoNube = smoothstep( 0.50, 0.60, nube ) * alto;
    let filoNube = clamp( ( nubeArriba - nube ) * 7.0, 0.0, 1.0 );
    col = mix( col, vec3<f32>( 0.045, 0.085, 0.105 ), cuerpoNube * 0.75 );
    col = col + vec3<f32>( 0.35, 0.55, 0.60 ) * cuerpoNube * filoNube * 0.35;

    // ---------- Selva de fondo ----------
    for ( var capa = 0; capa < 2; capa = capa + 1 ) {
      let fc = 1.0 - f32( capa );
      let hb = skyline( p.x + fc * 27.0, 3.0 + fc * 1.8, 0.225 - fc * 0.035, 0.085 - fc * 0.020, 0.005, t );
      let m = smoothstep( hb + 0.004, hb - 0.004, uvIn.y );
      let verde = mix( vec3<f32>( 0.014, 0.038, 0.030 ), vec3<f32>( 0.035, 0.075, 0.060 ), fc );
      col = mix( col, mix( verde, col, 0.08 + fc * 0.18 ), m );
    }

    // ---------- Islas flotantes ----------
    // El elemento que no tiene ningún otro juego: roca suspendida en el
    // aire por el cristal que lleva incrustado. Cada isla es una cuña
    // -- plana arriba, en punta abajo -- porque es un pedazo de corteza
    // arrancado, no una piedra redonda.
    var roca = 0.0;
    var luzRoca = 0.0;
    var cristal = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      let ix = ( hash21( vec2<f32>( fi, 401.0 ) ) - 0.5 ) * 1.55;
      let iy = 0.42 + hash21( vec2<f32>( fi, 409.0 ) ) * 0.30;
      let ancho = 0.075 + hash21( vec2<f32>( fi, 419.0 ) ) * 0.065;
      // Flotan: suben y bajan muy lento, cada una con su fase.
      let flota = sin( t * 0.28 + fi * 2.1 ) * 0.012;
      let cy = iy + flota;
      let dx = p.x - ix;
      let rel = uvIn.y - cy;

      // Cuerpo: arriba plano, abajo afilado.
      let perfil = select(
        ancho * ( 1.0 - clamp( -rel / ( ancho * 1.5 ), 0.0, 1.0 ) ),
        ancho * ( 1.0 - clamp( rel / ( ancho * 0.30 ), 0.0, 1.0 ) * 0.25 ),
        rel > 0.0
      );
      let dentro = step( abs( dx ), perfil ) * step( -ancho * 1.5, rel ) * step( rel, ancho * 0.30 );
      if ( dentro > 0.5 ) {
        roca = 1.0;
        // Volumen: la cara de arriba recibe luz, la panza queda oscura.
        luzRoca = clamp( 0.18 + 0.82 * smoothstep( -ancho * 0.9, ancho * 0.25, rel ), 0.10, 1.0 );
      }

      // El cristal: una veta que cuelga de la panza de la isla y
      // brilla. Es lo que explica por qué la roca está en el aire.
      let cxTop = cy - ancho * 0.55;
      let relC = cxTop - uvIn.y;
      let anchoC = ancho * 0.16 * ( 1.0 - clamp( relC / ( ancho * 1.5 ), 0.0, 1.0 ) );
      cristal = max( cristal, step( abs( dx ), anchoC ) * step( 0.0, relC ) * step( relC, ancho * 1.5 ) );
    }

    col = mix( col, mix( vec3<f32>( 0.030, 0.022, 0.016 ), vec3<f32>( 0.175, 0.125, 0.075 ), luzRoca ), roca );
    // El cristal POR ENCIMA de 1: es una fuente de luz, no una piedra
    // celeste. Con 1.0 se aplanaría contra su propio halo.
    col = mix( col, vec3<f32>( 0.10, 1.15, 1.45 ), cristal );

    // ---------- Obeliscos dorados ----------
    // Arquitectura protoss: formas esbeltas que se afinan hacia arriba
    // y terminan en punta, con una veta de energía en el eje.
    var oro = 0.0;
    var luzOro = 0.0;
    var vetaE = 0.0;
    for ( var i = 0; i < 3; i = i + 1 ) {
      let fi = f32( i );
      let ox = ( hash21( vec2<f32>( fi, 503.0 ) ) - 0.5 ) * 1.30;
      let base = 0.145;
      let altoO = 0.22 + hash21( vec2<f32>( fi, 509.0 ) ) * 0.17;
      let relO = uvIn.y - base;
      let frac = clamp( relO / altoO, 0.0, 1.0 );
      // Se afina con una curva, no lineal: eso es lo que da la silueta
      // estilizada en vez de un simple triángulo.
      let anchoO = ( 0.030 + hash21( vec2<f32>( fi, 521.0 ) ) * 0.016 ) * pow( 1.0 - frac, 0.55 );
      let dxO = p.x - ox;
      let dentroO = step( abs( dxO ), anchoO ) * step( 0.0, relO ) * step( relO, altoO );
      if ( dentroO > 0.5 ) {
        oro = 1.0;
        let n = dxO / max( anchoO, 0.0001 );
        luzOro = clamp( 0.22 + 0.78 * ( 0.5 - n * 0.55 ), 0.10, 1.0 );
        // La veta de energía recorre el eje y late.
        vetaE = smoothstep( 0.30, 0.0, abs( n ) ) * ( 0.55 + 0.45 * sin( t * 1.6 - relO * 24.0 + fi ) );
      }
    }
    col = mix( col, mix( vec3<f32>( 0.055, 0.032, 0.008 ), vec3<f32>( 0.52, 0.34, 0.075 ), luzOro ), oro );
    col = col + vec3<f32>( 0.08, 0.80, 1.00 ) * vetaE * oro * 0.55;

    // ---------- Suelo ----------
    let hSuelo = 0.145;
    let mSuelo = smoothstep( hSuelo + 0.004, hSuelo - 0.004, uvIn.y );
    let suelo = mix( vec3<f32>( 0.030, 0.052, 0.040 ), vec3<f32>( 0.060, 0.090, 0.065 ), smoothstep( 0.145, 0.0, uvIn.y ) );
    col = mix( col, suelo, mSuelo );
    // Vetas de cristal asomando del terreno: la razón por la que este
    // lugar es protoss y no una selva cualquiera.
    let veta = fbm2( vec2<f32>( p.x * 5.0, uvIn.y * 11.0 ) );
    let grieta = smoothstep( 0.030, 0.0, abs( veta - 0.5 ) ) * mSuelo;
    col = col + vec3<f32>( 0.20, 0.85, 1.0 ) * grieta * ( 0.6 + 0.4 * sin( t * 1.1 + p.x * 3.0 ) ) * 0.60;

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.12, 0.28, dv ), 0.62 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(SKYLINE_WGSL),
    comoInclude(FBM_WGSL),
    comoInclude(FBM2_WGSL),
    comoInclude(RUIDO_WGSL),
    comoInclude(HASH_WGSL),
  ],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaProtoss(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = PROTOSS_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Motas de energía psiónica subiendo: cian, porque es la contracara
  // del oro de la arquitectura.
  const energia = crearParticulas(scene, aspectoUniform, {
    cantidad: 320,
    caida: -0.055,
    deriva: 0.05,
    vaiven: 0.022,
    frecuenciaVaiven: 0.7,
    tamano: [0.0014, 0.0032],
    estirado: 1.5,
    giro: 3,
    forma: "redonda",
    color: [0.05, 0.28, 0.34],
    colorVivo: [0.22, 0.85, 1.05],
    sesgoBrillo: 2.0,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Esquirlas de cristal flotando: la misma primitiva con forma de hoja
  // y casi sin caída, que a este tamaño se lee como astilla suspendida.
  const esquirlas = crearParticulas(scene, aspectoUniform, {
    cantidad: 120,
    caida: -0.016,
    deriva: 0.08,
    vaiven: 0.030,
    frecuenciaVaiven: 0.35,
    tamano: [0.0022, 0.0048],
    estirado: 2.4,
    giro: 6,
    forma: "hoja",
    color: [0.08, 0.30, 0.38],
    colorVivo: [0.30, 0.95, 1.15],
    sesgoBrillo: 1.4,
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
      energia.ajustarA(camera);
      esquirlas.ajustarA(camera);
    },
  });
}
