import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SKYLINE_WGSL, SEGMENTO_WGSL, PINO_WGSL } from "./siluetas";
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

    // ---------- Pinos de primer plano ----------
    // Se llama "masaPino" y no "pino" porque una variable con el
    // mismo nombre que la función la TAPA: WGSL no deja invocarla.
    var masaPino = 0.0;
    var luzPino = 0.0;
    var nievePino = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      // Repartidos hacia los costados: el centro queda para el muñeco.
      let lado = select( -1.0, 1.0, hash21( vec2<f32>( fi, 201.0 ) ) > 0.5 );
      let px = lado * ( 0.50 + hash21( vec2<f32>( fi, 203.0 ) ) * 0.40 );
      let alto = 0.28 + hash21( vec2<f32>( fi, 211.0 ) ) * 0.20;
      let r = pino( vec2<f32>( p.x, uvIn.y ), vec2<f32>( px, hNieve - 0.02 ), alto, fi + 1.0, sin( t * 0.5 + fi ) * 0.006 );
      if ( r.x > 0.5 ) {
        masaPino = 1.0;
        luzPino = r.y;
        nievePino = r.z;
      }
    }
    col = mix( col, mix( vec3<f32>( 0.006, 0.016, 0.018 ), vec3<f32>( 0.030, 0.070, 0.060 ), luzPino ), masaPino );
    col = mix( col, vec3<f32>( 0.52, 0.60, 0.78 ), nievePino * masaPino * 0.9 );

    // ---------- El muñeco de nieve ----------
    // Lo que convierte un paisaje nevado en una POSTAL de Navidad. Sin
    // él es invierno; con él, es Navidad.
    // Al centro: en -0.46 quedaba debajo de las tarjetas de la llave,
    // que ocupan el lado izquierdo. Acá se ve siempre.
    let mx = 0.06;
    let pieM = hNieve - 0.012;
    let r1 = 0.050;
    let r2 = 0.036;
    let r3 = 0.026;
    let c1 = vec2<f32>( mx, pieM + r1 * 0.80 );
    let c2 = vec2<f32>( mx, c1.y + r1 * 0.78 + r2 * 0.52 );
    let c3 = vec2<f32>( mx, c2.y + r2 * 0.76 + r3 * 0.50 );
    var cuerpo = 0.0;
    cuerpo = max( cuerpo, step( length( p - c1 ), r1 ) );
    cuerpo = max( cuerpo, step( length( p - c2 ), r2 ) );
    cuerpo = max( cuerpo, step( length( p - c3 ), r3 ) );
    // Brazos de rama, uno a cada lado, hacia arriba.
    let brazoIzq = smoothstep( 0.0048, 0.0, distSegmento( p, c2 + vec2<f32>( -r2 * 0.7, 0.004 ), c2 + vec2<f32>( -r2 * 2.3, r2 * 1.0 ) ) );
    let brazoDer = smoothstep( 0.0048, 0.0, distSegmento( p, c2 + vec2<f32>( r2 * 0.7, 0.004 ), c2 + vec2<f32>( r2 * 2.3, r2 * 1.1 ) ) );
    // La nieve del muñeco es más clara que la del suelo, para que se
    // despegue del fondo.
    col = mix( col, vec3<f32>( 0.80, 0.86, 1.0 ), cuerpo );
    col = mix( col, vec3<f32>( 0.14, 0.085, 0.045 ), max( brazoIzq, brazoDer ) );
    // Ojos y botones de carbón.
    var carbon = 0.0;
    carbon = max( carbon, step( length( p - ( c3 + vec2<f32>( -r3 * 0.34, r3 * 0.26 ) ) ), r3 * 0.15 ) );
    carbon = max( carbon, step( length( p - ( c3 + vec2<f32>( r3 * 0.34, r3 * 0.26 ) ) ), r3 * 0.15 ) );
    for ( var b = 0; b < 3; b = b + 1 ) {
      let fb = f32( b );
      carbon = max( carbon, step( length( p - ( c2 + vec2<f32>( 0.0, r2 * ( 0.45 - fb * 0.45 ) ) ) ), r2 * 0.11 ) );
    }
    col = mix( col, vec3<f32>( 0.020, 0.022, 0.028 ), carbon );
    // LA NARIZ DE ZANAHORIA: un triángulo naranja que sale del medio de
    // la cara. Es el detalle que nombra al objeto.
    let rel = p - c3;
    let largoNariz = r3 * 1.15;
    let avance = clamp( rel.x / largoNariz, 0.0, 1.0 );
    let nariz = step( 0.0, rel.x ) * step( rel.x, largoNariz )
      * step( abs( rel.y + r3 * 0.02 ), r3 * 0.20 * ( 1.0 - avance ) );
    col = mix( col, vec3<f32>( 0.78, 0.22, 0.030 ), nariz );
    // Sombrero de copa.
    let hy = c3.y + r3 * 0.72;
    let ala = step( abs( p.x - mx ), r3 * 1.30 ) * step( hy, uvIn.y ) * step( uvIn.y, hy + r3 * 0.14 );
    let copa = step( abs( p.x - mx ), r3 * 0.78 ) * step( hy + r3 * 0.10, uvIn.y ) * step( uvIn.y, hy + r3 * 0.95 );
    col = mix( col, vec3<f32>( 0.030, 0.032, 0.040 ), max( ala, copa ) );

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, dv ), 0.55 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(SKYLINE_WGSL),
    comoInclude(SEGMENTO_WGSL),
    comoInclude(PINO_WGSL),
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
