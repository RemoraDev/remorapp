import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { ARBOL_PELADO_WGSL, SEGMENTO_WGSL } from "./siluetas";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Noche de Halloween: luna enorme, árboles pelados recortados, niebla
// baja y calabazas encendidas.
//
// Esta escena es la que mejor encaja con lo que Blizzard descubrió al
// hacer Warcraft III: silueta audaz y color plano. Halloween ES eso --
// una forma negra contra una luna naranja. Nada de buscar detalle:
// lo que se reconoce es el CONTORNO.
//
// Paleta corta a propósito: naranja, violeta y negro. Tres colores.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const HALLOWEEN_WGSL = wgslFn(
  /* wgsl */ `
  fn halloween( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo ----------
    // Violeta profundo arriba, naranja sucio hacia el horizonte.
    // Mucho más oscuro que la primera versión: Halloween es una noche,
    // no un atardecer. Con el cielo claro las siluetas dejan de
    // recortarse y todo queda pastel.
    var col = mix(
      vec3<f32>( 0.26, 0.085, 0.045 ),
      vec3<f32>( 0.045, 0.020, 0.075 ),
      smoothstep( 0.10, 0.72, uvIn.y )
    );

    // ---------- La luna ----------
    // Grande y baja: es el elemento que manda en el cuadro y lo que
    // recorta las siluetas.
    let luna = vec2<f32>( 0.20, 0.60 );
    let dLuna = length( p - luna );
    let radioLuna = 0.185;
    // Halos CORTOS. En la primera versión el externo llegaba a 0.95, o
    // sea casi todo el cuadro, y sumaba luz en cada píxel: el cielo
    // entero quedaba lavado. Es el mismo error que ya cometí con el
    // halo de los planetas.
    col = col + vec3<f32>( 1.0, 0.45, 0.12 ) * smoothstep( 0.42, 0.0, dLuna ) * 0.16;
    col = col + vec3<f32>( 1.0, 0.56, 0.18 ) * smoothstep( 0.24, 0.0, dLuna ) * 0.26;
    // El disco, con manchas (los "mares" lunares) para que no sea un
    // círculo plano.
    let manchas = fbm( ( p - luna ) * 9.0 );
    let discoLuna = smoothstep( radioLuna, radioLuna - 0.004, dLuna );
    col = mix( col, mix( vec3<f32>( 1.0, 0.70, 0.30 ), vec3<f32>( 0.88, 0.52, 0.20 ), manchas ), discoLuna );

    // ---------- Nubes cruzando la luna ----------
    // Jirones finos y rápidos: una nube pasando delante de la luna es
    // la imagen de Halloween por excelencia.
    let qn = vec2<f32>( p.x * 1.6 + t * 0.075, uvIn.y * 4.0 );
    let jiron = fbm( qn );
    let bandaNube = smoothstep( 0.50, 0.70, jiron ) * smoothstep( 0.30, 0.90, uvIn.y );
    col = mix( col, vec3<f32>( 0.14, 0.07, 0.17 ), bandaNube * 0.80 );
    // Borde iluminado por detrás, solo cerca de la luna.
    col = col + vec3<f32>( 1.0, 0.55, 0.18 ) * bandaNube * smoothstep( 0.70, 0.0, dLuna ) * 0.30;

    // ---------- Colinas ----------
    let hColina = 0.145 + fbm2( vec2<f32>( p.x * 1.2, 4.0 ) ) * 0.055;
    let mColina = smoothstep( hColina + 0.004, hColina - 0.004, uvIn.y );

    // ---------- Árboles pelados ----------
    // Cuatro, repartidos y de distinto tamaño. Van POR DELANTE de la
    // colina y recortados contra la luna.
    let viento = sin( t * 0.55 ) * 0.014 + sin( t * 0.33 + 1.1 ) * 0.008;
    var ramas = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      let bx = ( hash21( vec2<f32>( fi, 71.0 ) ) - 0.5 ) * 1.55;
      let alturaArbol = 0.30 + hash21( vec2<f32>( fi, 79.0 ) ) * 0.26;
      ramas = max( ramas, arbolPelado( p, vec2<f32>( bx, hColina - 0.02 ), alturaArbol, fi + 1.0, viento ) );
    }

    col = mix( col, vec3<f32>( 0.030, 0.018, 0.045 ), mColina );
    col = mix( col, vec3<f32>( 0.016, 0.010, 0.028 ), ramas );

    // ---------- Calabazas ----------
    // Dos luces anaranjadas al ras del suelo. Chicas, pero son lo que
    // dice "Halloween" y no "noche de otoño".
    for ( var i = 0; i < 2; i = i + 1 ) {
      let fi = f32( i );
      let cx = ( hash21( vec2<f32>( fi, 91.0 ) ) - 0.5 ) * 1.25;
      let cy = hColina - 0.030;
      let d = length( vec2<f32>( ( p.x - cx ) * 1.5, uvIn.y - cy ) );
      // Titileo de vela: irregular, no un seno limpio.
      let vela = 0.72 + 0.28 * sin( t * ( 5.0 + fi * 2.0 ) ) * sin( t * ( 1.7 + fi ) );
      col = col + vec3<f32>( 1.0, 0.45, 0.08 ) * smoothstep( 0.030, 0.0, d ) * vela;
      col = col + vec3<f32>( 1.0, 0.38, 0.06 ) * smoothstep( 0.11, 0.0, d ) * vela * 0.22;
    }

    // ---------- Niebla baja ----------
    // Va DESPUÉS de los árboles para que les tape los pies: una niebla
    // que pasa por detrás de los troncos no se lee como niebla.
    let niebla = fbm2( vec2<f32>( p.x * 1.8 + t * 0.045, uvIn.y * 7.0 + t * 0.02 ) );
    let bandaNiebla = smoothstep( 0.22, 0.03, uvIn.y ) * smoothstep( 0.40, 0.75, niebla );
    col = mix( col, vec3<f32>( 0.30, 0.20, 0.34 ), bandaNiebla * 0.70 );

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.10, 0.25, dv ), 0.70 );

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

export function crearEscenaHalloween(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = HALLOWEEN_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Brasas subiendo desde las calabazas: la MISMA primitiva de la
  // lluvia y la nieve, con la caída en negativo para que suban.
  const brasas = crearParticulas(scene, aspectoUniform, {
    cantidad: 260,
    caida: -0.065,
    deriva: 0.07,
    vaiven: 0.020,
    frecuenciaVaiven: 0.9,
    tamano: [0.0016, 0.0032],
    estirado: 1.6,
    giro: 5,
    color: [0.55, 0.18, 0.04],
    colorVivo: [1.0, 0.58, 0.16],
    sesgoBrillo: 2.4,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
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
      brasas.ajustarA(camera);
    },
  });
}
