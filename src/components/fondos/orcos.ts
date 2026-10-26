import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SEGMENTO_WGSL } from "./siluetas";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Durotar: el desierto rojo de los orcos de Warcraft III.
//
// Lo que identifica a esa tierra son tres cosas, y ninguna es un orco:
// la roca ROJA, las mesetas de cima plana recortadas contra el cielo, y
// los tótems clavados en el suelo. Con esas tres, cualquiera que haya
// jugado la campaña orca sabe dónde está.
//
// Las mesetas son clave y por eso no se hacen con la función de
// coníferas: una meseta tiene la cima PLANA y los lados casi
// verticales. Esa silueta de bloque es la firma del lugar; una colina
// redondeada no lo es.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const ORCOS_WGSL = wgslFn(
  /* wgsl */ `
  fn orcos( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo ----------
    // Ocre encendido abajo, turquesa polvoriento arriba. El contraste
    // cálido-frío es lo que hace que la roca roja se vea roja.
    var col = mix(
      vec3<f32>( 0.62, 0.21, 0.055 ),
      vec3<f32>( 0.055, 0.125, 0.22 ),
      smoothstep( 0.22, 0.85, uvIn.y )
    );

    // Sol bajo y duro, casi blanco de tan caliente.
    let sol = vec2<f32>( 0.30, 0.34 );
    let dSol = length( p - sol );
    // Halo corto. El de 0.38 cubria medio cuadro y lavaba el rojo de la
    // roca, que es justamente lo que identifica a Durotar.
    col = col + vec3<f32>( 1.0, 0.58, 0.20 ) * smoothstep( 0.17, 0.0, dSol ) * 0.35;
    col = mix( col, vec3<f32>( 1.0, 0.94, 0.78 ), smoothstep( 0.052, 0.042, dSol ) );

    // Polvo en suspensión: el aire de Durotar nunca está limpio.
    let polvo = fbm( vec2<f32>( p.x * 1.4 + t * 0.035, uvIn.y * 2.6 ) );
    col = mix( col, vec3<f32>( 0.85, 0.58, 0.34 ), smoothstep( 0.45, 0.85, polvo ) * smoothstep( 0.48, 0.24, uvIn.y ) * 0.18 );

    // ---------- Mesetas ----------
    // Tres capas a distinta distancia. La altura se cuantiza en
    // escalones: eso es lo que da la cima plana, y es toda la
    // diferencia entre una meseta y una loma.
    // De LEJOS a CERCA. Antes iba al revés y, como cada capa pinta todo
    // lo que queda por debajo de su altura, la más lejana (la más
    // lavada contra el cielo) terminaba tapando a las cercanas: por eso
    // toda la roca se veía pálida.
    for ( var capa = 0; capa < 3; capa = capa + 1 ) {
      let fc = 2.0 - f32( capa );
      let escala = 1.5 + fc * 1.3;
      let x = p.x * escala + fc * 23.7;
      let bloque = floor( x );
      // Altura por bloque, constante a lo ancho de todo el bloque.
      let alturaBloque = hash21( vec2<f32>( bloque, 13.0 + fc ) );
      // Algunos bloques quedan al ras: los huecos entre mesetas son
      // tan importantes como las mesetas.
      let hay = step( 0.30, hash21( vec2<f32>( bloque, 29.0 + fc ) ) );
      // Altas de verdad: una meseta de Durotar domina el encuadre. Con
      // la altura anterior quedaban como bordes de vereda.
      let base = 0.34 - fc * 0.055;
      let h = base + alturaBloque * ( 0.30 - fc * 0.065 ) * hay;
      let m = smoothstep( h + 0.003, h - 0.003, uvIn.y );
      // Las lejanas se lavan contra el cielo (perspectiva atmosférica).
      // Rojo profundo, y las lejanas apenas se lavan. Antes se mezclaba
      // tanto con el cielo que la roca perdia el color.
      // Valores bajos a propósito: estos colores están en espacio
      // LINEAL y el renderer los codifica a sRGB, que los aclara
      // bastante. Un 0.30 lineal se ve como 0.58 en pantalla -- era la
      // causa de fondo de que todas las escenas salieran pálidas.
      let roca = mix(
        vec3<f32>( 0.085, 0.022, 0.012 ),
        vec3<f32>( 0.20, 0.065, 0.034 ),
        fc / 2.0
      );
      col = mix( col, mix( roca, col, 0.08 + fc * 0.13 ), m );
    }

    // ---------- Suelo ----------
    let hSuelo = 0.115;
    let mSuelo = smoothstep( hSuelo + 0.004, hSuelo - 0.004, uvIn.y );
    let tierra = mix( vec3<f32>( 0.105, 0.032, 0.015 ), vec3<f32>( 0.21, 0.072, 0.032 ), smoothstep( 0.11, 0.0, uvIn.y ) );
    col = mix( col, tierra, mSuelo );
    // Vetas de tierra agrietada.
    let veta = fbm2( vec2<f32>( p.x * 7.0, uvIn.y * 16.0 ) );
    col = mix( col, vec3<f32>( 0.055, 0.016, 0.008 ), smoothstep( 0.035, 0.0, abs( veta - 0.5 ) ) * mSuelo * 0.7 );

    // ---------- Tótems ----------
    // Postes clavados con travesaños. La silueta de cruz irregular es
    // lo que los distingue de un palo cualquiera.
    let viento = sin( t * 0.7 ) * 0.006;
    var totem = 0.0;
    for ( var i = 0; i < 3; i = i + 1 ) {
      let fi = f32( i );
      let tx = ( hash21( vec2<f32>( fi, 131.0 ) ) - 0.5 ) * 1.5;
      let alto = 0.17 + hash21( vec2<f32>( fi, 137.0 ) ) * 0.13;
      let pie = vec2<f32>( tx, hSuelo - 0.015 );
      let cima = pie.y + alto;
      // Poste grueso. Antes era fino y con UN travesaño, o sea una
      // cruz: un tótem orco se reconoce por ser macizo y cargado, no
      // por tener forma de cruz de cementerio.
      totem = max( totem, smoothstep( 0.013, 0.0, distSegmento( p, pie, vec2<f32>( tx + viento * 0.5, cima ) ) ) );

      // Cabeza: un bloque ancho arriba, la máscara tallada.
      let dxc = abs( p.x - tx - viento * 0.5 );
      let relc = uvIn.y - ( cima - 0.040 );
      totem = max( totem, step( dxc, 0.030 ) * step( 0.0, relc ) * step( relc, 0.048 ) );
      // Dos cuernos saliendo de la cabeza, hacia arriba y afuera.
      for ( var c = 0; c < 2; c = c + 1 ) {
        let lado = select( -1.0, 1.0, c > 0 );
        let a = vec2<f32>( tx + lado * 0.028 + viento * 0.5, cima + 0.006 );
        let b = vec2<f32>( tx + lado * 0.062 + viento * 0.9, cima + 0.040 );
        totem = max( totem, smoothstep( 0.0075, 0.0, distSegmento( p, a, b ) ) );
      }
      // Tres ataduras cortas y asimétricas en el poste.
      for ( var k = 0; k < 3; k = k + 1 ) {
        let fk = f32( k );
        let hy = pie.y + alto * ( 0.22 + fk * 0.20 );
        let w = 0.014 + hash21( vec2<f32>( fi * 9.0 + fk, 151.0 ) ) * 0.018;
        let sesgo = ( hash21( vec2<f32>( fi * 9.0 + fk, 157.0 ) ) - 0.5 ) * 0.020;
        totem = max( totem, smoothstep( 0.0050, 0.0, distSegmento( p, vec2<f32>( tx - w + sesgo, hy ), vec2<f32>( tx + w + sesgo, hy + 0.006 ) ) ) );
      }
    }
    col = mix( col, vec3<f32>( 0.028, 0.011, 0.006 ), totem );

    // ---------- Calor del suelo ----------
    // Una banda que tiembla justo sobre la tierra: el aire caliente
    // subiendo. Es sutil y es lo que termina de decir "desierto".
    let temblor = sin( uvIn.y * 160.0 + t * 2.2 + p.x * 8.0 ) * 0.5 + 0.5;
    col = col + vec3<f32>( 1.0, 0.70, 0.40 ) * smoothstep( 0.175, 0.105, uvIn.y ) * smoothstep( 0.09, 0.0, uvIn.y - 0.105 ) * temblor * 0.055;

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, dv ), 0.55 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(SEGMENTO_WGSL),
    comoInclude(FBM_WGSL),
    comoInclude(FBM2_WGSL),
    comoInclude(RUIDO_WGSL),
    comoInclude(HASH_WGSL),
  ],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaOrcos(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = ORCOS_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Polvo arrastrado por el viento: cruza casi en horizontal, que es
  // lo que lo diferencia de la ceniza (que cae) y del polen (que sube).
  const polvo = crearParticulas(scene, aspectoUniform, {
    cantidad: 600,
    caida: 0.012,
    deriva: 0.95,
    vaiven: 0.025,
    frecuenciaVaiven: 0.7,
    tamano: [0.0010, 0.0024],
    estirado: 2.2,
    giro: 4,
    forma: "redonda",
    color: [0.52, 0.30, 0.16],
    colorVivo: [0.88, 0.60, 0.32],
    sesgoBrillo: 2.2,
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
      polvo.ajustarA(camera);
    },
  });
}
