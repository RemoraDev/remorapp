import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SKYLINE_WGSL } from "./siluetas";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Noche de nieve: bosque de coníferas nevado, luna, y luces cálidas de
// una cabaña a lo lejos.
//
// Lo que hace que se sienta navideño no es la nieve sola -- es el
// CONTRASTE de temperatura: todo el cuadro es azul frío, y las únicas
// manchas cálidas son las ventanas encendidas. Si todo fuera azul
// quedaría "invierno"; son esas luces las que lo vuelven "Navidad".
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const NAVIDAD_WGSL = wgslFn(
  /* wgsl */ `
  fn navidad( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo ----------
    // Índigo profundo arriba, azul más claro hacia el horizonte por el
    // reflejo de la nieve, que de noche ilumina el cielo desde abajo.
    var col = mix(
      vec3<f32>( 0.16, 0.24, 0.42 ),
      vec3<f32>( 0.025, 0.045, 0.115 ),
      smoothstep( 0.18, 0.95, uvIn.y )
    );

    // ---------- Estrellas ----------
    // Una celda de hash por píxel: baratísimo comparado con instanciar
    // geometría, y para puntos sin volumen alcanza y sobra.
    let gp = p * 48.0;
    let celda = floor( gp );
    let h = hash21( celda );
    let centro = vec2<f32>( hash21( celda + 3.3 ), hash21( celda + 7.7 ) );
    let titila = 0.55 + 0.45 * sin( t * ( 0.8 + h * 2.0 ) + h * 40.0 );
    let estrella = smoothstep( 0.10, 0.0, length( fract( gp ) - centro ) ) * step( 0.975, h );
    col = col + vec3<f32>( 0.85, 0.90, 1.0 ) * estrella * titila * smoothstep( 0.30, 0.75, uvIn.y );

    // ---------- Luna ----------
    let luna = vec2<f32>( 0.46, 0.76 );
    let dLuna = length( p - luna );
    col = col + vec3<f32>( 0.55, 0.65, 0.85 ) * smoothstep( 0.42, 0.0, dLuna ) * 0.22;
    col = mix( col, vec3<f32>( 0.96, 0.97, 1.0 ), smoothstep( 0.070, 0.058, dLuna ) );

    // ---------- Nubes finas ----------
    let nube = fbm( vec2<f32>( p.x * 2.2 + t * 0.020, uvIn.y * 5.0 ) );
    col = mix( col, vec3<f32>( 0.22, 0.30, 0.48 ), smoothstep( 0.56, 0.80, nube ) * smoothstep( 0.42, 0.95, uvIn.y ) * 0.55 );

    // ---------- Bosque de coníferas ----------
    // Dos líneas: la lejana casi se funde con el cielo, la cercana es
    // silueta oscura. La nieve del suelo las recorta por abajo.
    let hLejos = skyline( p.x, 3.2, 0.26, 0.075, 0.004, t );
    let mLejos = smoothstep( hLejos + 0.004, hLejos - 0.004, uvIn.y );
    col = mix( col, vec3<f32>( 0.14, 0.20, 0.34 ), mLejos );

    let hCerca = skyline( p.x + 19.4, 5.0, 0.20, 0.095, 0.009, t );
    let mCerca = smoothstep( hCerca + 0.004, hCerca - 0.004, uvIn.y );
    col = mix( col, vec3<f32>( 0.045, 0.075, 0.135 ), mCerca );

    // ---------- Luces de la cabaña ----------
    // Tres ventanas encendidas entre los árboles. Son el único punto
    // cálido del cuadro y por eso cargan toda la lectura navideña.
    for ( var i = 0; i < 3; i = i + 1 ) {
      let fi = f32( i );
      let lx = ( hash21( vec2<f32>( fi, 61.0 ) ) - 0.5 ) * 1.05;
      let ly = 0.165 + hash21( vec2<f32>( fi, 67.0 ) ) * 0.030;
      let d = length( vec2<f32>( ( p.x - lx ) * 1.6, uvIn.y - ly ) );
      // Parpadeo muy leve, como una llama vista de lejos.
      let viva = 0.86 + 0.14 * sin( t * ( 1.1 + fi * 0.7 ) + fi * 2.0 );
      col = col + vec3<f32>( 1.0, 0.72, 0.34 ) * smoothstep( 0.055, 0.0, d ) * viva * 0.9;
      col = col + vec3<f32>( 1.0, 0.62, 0.26 ) * smoothstep( 0.16, 0.0, d ) * viva * 0.14;
    }

    // ---------- Suelo nevado ----------
    // Lomas suaves: la nieve acumulada redondea todo, así que acá NO
    // van dientes de conífera, solo ondulación.
    let hNieve = 0.135 + fbm2( vec2<f32>( p.x * 1.4, 11.0 ) ) * 0.045;
    let mNieve = smoothstep( hNieve + 0.004, hNieve - 0.004, uvIn.y );
    // La nieve se aclara hacia el borde inferior, que es lo que está
    // más cerca y recibe más luz de luna.
    let nieve = mix( vec3<f32>( 0.52, 0.60, 0.80 ), vec3<f32>( 0.80, 0.86, 1.0 ), smoothstep( 0.14, 0.0, uvIn.y ) );
    col = mix( col, nieve, mNieve );
    // Brillo de los cristales sobre la nieve.
    let chispa = smoothstep( 0.06, 0.0, length( fract( p * 70.0 ) - 0.5 ) ) * step( 0.988, hash21( floor( p * 70.0 ) ) );
    col = col + vec3<f32>( 1.0, 1.0, 1.0 ) * chispa * mNieve * ( 0.5 + 0.5 * sin( t * 2.0 + hash21( floor( p * 70.0 ) ) * 30.0 ) ) * 0.5;

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, dv ), 0.55 );

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

export function crearEscenaNavidad(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = NAVIDAD_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Misma primitiva que la lluvia, con otra física: el copo cae lento,
  // se mece mucho y gira sobre sí mismo. Eso es todo lo que separa
  // "lluvia" de "nieve".
  const nieveLejos = crearParticulas(scene, aspectoUniform, {
    cantidad: 700,
    caida: 0.045,
    deriva: 0.10,
    vaiven: 0.022,
    frecuenciaVaiven: 0.5,
    tamano: [0.0016, 0.0026],
    estirado: 1,
    giro: 4,
    forma: "redonda",
    color: [0.52, 0.60, 0.78],
    colorVivo: [0.80, 0.86, 1.0],
    sesgoBrillo: 1.6,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  const nieveCerca = crearParticulas(scene, aspectoUniform, {
    cantidad: 420,
    caida: 0.10,
    deriva: 0.16,
    vaiven: 0.040,
    frecuenciaVaiven: 0.8,
    tamano: [0.0034, 0.0060],
    estirado: 1,
    giro: 6,
    forma: "redonda",
    color: [0.78, 0.84, 0.96],
    colorVivo: [1.0, 1.0, 1.0],
    sesgoBrillo: 1.2,
    profundidad: PROFUNDIDAD_PLANO + 2,
    orden: 2,
  });

  return Promise.resolve({
    updater: () => {
      // Todo el movimiento va con el uniform "time" dentro de los
      // shaders: ni un cálculo de JavaScript por cuadro.
    },
    alRedimensionar: (camera) => {
      aspectoUniform.value = camera.aspect;
      const distancia = camera.position.z - plano.position.z;
      const alturaVisible = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      plano.scale.set(alturaVisible * camera.aspect * 1.02, alturaVisible * 1.02, 1);
      nieveLejos.ajustarA(camera);
      nieveCerca.ajustarA(camera);
    },
  });
}
