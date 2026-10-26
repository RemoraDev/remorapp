import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SEGMENTO_WGSL } from "./siluetas";
import { crearParticulas, crearPasto } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Lordaeron en verano: los campos de la Alianza en Warcraft III.
//
// Es la contracara exacta de Tierras malditas, y a propósito: el mismo
// paisaje antes de la plaga. Verde parejo, cielo celeste limpio, y una
// ciudadela de piedra con estandartes. Si alguien pone los dos fondos
// uno al lado del otro, la historia se cuenta sola.
//
// La ciudadela es lo que lo ancla: torres de base ancha con almenas y
// techos cónicos. Esa silueta -- bloque, almenas, cono -- es la
// arquitectura humana de Warcraft, y se reconoce aunque esté a
// contraluz y sin un solo detalle.
//
// OJO: los colores van en espacio LINEAL y el renderer los codifica a
// sRGB, que los aclara bastante. Un 0.30 lineal se ve como 0.58.
// Nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const HUMANOS_WGSL = wgslFn(
  /* wgsl */ `
  fn humanos( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo ----------
    var col = mix(
      vec3<f32>( 0.42, 0.52, 0.60 ),
      vec3<f32>( 0.085, 0.22, 0.46 ),
      smoothstep( 0.22, 0.95, uvIn.y )
    );

    // ---------- Nubes de buen tiempo ----------
    // Cúmulos redondeados y bien separados: el cielo de Lordaeron está
    // despejado, y eso es parte de lo que lo opone a las tierras de la
    // plaga. Dos muestras a distinta altura para iluminar el filo de
    // arriba, que es de donde viene el sol.
    let qn = vec2<f32>( p.x * 1.5 + t * 0.022, uvIn.y * 3.0 );
    let nube = fbm( qn );
    let nubeArriba = fbm( qn + vec2<f32>( 0.0, 0.17 ) );
    let altoCielo = smoothstep( 0.34, 0.98, uvIn.y );
    let cuerpo = smoothstep( 0.52, 0.64, nube ) * altoCielo;
    let filo = clamp( ( nubeArriba - nube ) * 7.0, 0.0, 1.0 );
    col = mix( col, vec3<f32>( 0.30, 0.34, 0.42 ), cuerpo * 0.80 );
    col = col + vec3<f32>( 0.85, 0.86, 0.80 ) * cuerpo * filo * 0.70;

    // ---------- Colinas lejanas ----------
    for ( var capa = 0; capa < 2; capa = capa + 1 ) {
      // De lejos a cerca: al revés, la capa lejana (más lavada) tapa a
      // la cercana y se pierde la profundidad.
      let fc = 1.0 - f32( capa );
      let h = 0.235 - fc * 0.035 + fbm2( vec2<f32>( p.x * ( 1.1 + fc * 0.6 ) + fc * 17.0, 3.0 ) ) * 0.055;
      let m = smoothstep( h + 0.003, h - 0.003, uvIn.y );
      let verde = mix( vec3<f32>( 0.035, 0.085, 0.045 ), vec3<f32>( 0.075, 0.125, 0.085 ), fc );
      col = mix( col, mix( verde, col, 0.10 + fc * 0.22 ), m );
    }

    // ---------- La ciudadela ----------
    // Rehecha: la primera versión eran tres torres chicas y grises
    // perdidas en el horizonte. Lo que hace reconocible a una fortaleza
    // humana de Warcraft no es el tamaño sino DOS cosas: la piedra
    // clara y, sobre todo, los TECHOS AZULES en punta. Ese par de
    // colores es la firma; sin él una torre es una torre cualquiera.
    let hMuralla = 0.300;
    let baseCiudad = 0.168;
    var piedra = 0.0;
    var techo = 0.0;

    // Muralla ancha con almenas.
    let enMuralla = step( abs( p.x + 0.10 ), 0.62 );
    let almena = step( 0.5, fract( ( p.x + 0.10 ) * 34.0 ) );
    piedra = max( piedra, enMuralla * step( baseCiudad, uvIn.y ) * step( uvIn.y, hMuralla + almena * 0.013 ) );

    // Arco de la puerta: un hueco redondeado en el medio de la muralla.
    let dPuerta = length( vec2<f32>( ( p.x + 0.10 ) * 1.5, ( uvIn.y - baseCiudad ) * 0.85 ) );
    piedra = piedra * ( 1.0 - step( dPuerta, 0.052 ) * step( uvIn.y, hMuralla - 0.04 ) );

    // Cinco torres: bajas en los extremos, la central la más alta. Esa
    // progresión es lo que da sensación de ciudadela y no de fila de
    // postes.
    for ( var i = 0; i < 5; i = i + 1 ) {
      let fi = f32( i );
      let centrado = 1.0 - abs( fi - 2.0 ) / 2.0;
      let tx = -0.10 + ( fi - 2.0 ) * 0.255;
      let ancho = 0.031 + centrado * 0.020;
      let alto = 0.085 + centrado * 0.165 + hash21( vec2<f32>( fi, 67.0 ) ) * 0.022;
      let dx = abs( p.x - tx );
      let cima = hMuralla + alto;
      piedra = max( piedra, step( dx, ancho ) * step( baseCiudad, uvIn.y ) * step( uvIn.y, cima ) );
      // Balcón saliente justo bajo el techo.
      piedra = max( piedra, step( dx, ancho * 1.30 ) * step( cima - 0.012, uvIn.y ) * step( uvIn.y, cima ) );

      // Techo cónico AZUL, alto y afilado: un cono chato se lee como
      // sombrero, uno alto como aguja.
      let altoCono = 0.055 + centrado * 0.055;
      let relTecho = uvIn.y - cima;
      let anchoCono = ancho * 1.32 * ( 1.0 - clamp( relTecho / altoCono, 0.0, 1.0 ) );
      techo = max( techo, step( dx, anchoCono ) * step( 0.0, relTecho ) * step( relTecho, altoCono ) );
    }

    col = mix( col, vec3<f32>( 0.195, 0.205, 0.225 ), piedra );
    // Dos azules, cara iluminada y cara en sombra: sin ese corte el
    // cono se ve plano.
    let ladoLuz = step( 0.0, sin( ( p.x + 0.10 ) * 12.3 ) );
    col = mix( col, mix( vec3<f32>( 0.040, 0.085, 0.26 ), vec3<f32>( 0.075, 0.150, 0.42 ), ladoLuz ), techo );

    // Ventanas encendidas, chiquitas y cálidas.
    let gw = vec2<f32>( ( p.x + 0.10 ) * 46.0, uvIn.y * 150.0 );
    let celdaW = floor( gw );
    let hw = hash21( celdaW );
    let ventana = step( 0.90, hw ) * smoothstep( 0.42, 0.12, length( fract( gw ) - 0.5 ) );
    col = col + vec3<f32>( 1.0, 0.72, 0.30 ) * ventana * piedra * 0.75;

    // ---------- Estandartes ----------
    var pano = 0.0;
    for ( var i = 0; i < 5; i = i + 1 ) {
      let fi = f32( i );
      let centrado = 1.0 - abs( fi - 2.0 ) / 2.0;
      let tx = -0.10 + ( fi - 2.0 ) * 0.255;
      let ancho = 0.031 + centrado * 0.020;
      let alto = 0.085 + centrado * 0.165 + hash21( vec2<f32>( fi, 67.0 ) ) * 0.022;
      let topeP = hMuralla + alto - 0.016;
      let rel = topeP - uvIn.y;
      // La onda crece hacia el borde suelto: arriba está atado al asta.
      let onda = sin( t * 1.9 + fi * 2.0 + rel * 24.0 ) * 0.009 * smoothstep( 0.0, 0.050, rel );
      let dxp = p.x - ( tx + ancho * 1.35 ) - onda;
      pano = max( pano, step( 0.0, dxp ) * step( dxp, 0.040 ) * step( 0.0, rel ) * step( rel, 0.062 ) );
    }
    col = mix( col, vec3<f32>( 0.050, 0.095, 0.30 ), pano );

    // ---------- Campos ----------
    let hCampo = 0.175;
    let mCampo = smoothstep( hCampo + 0.004, hCampo - 0.004, uvIn.y );
    let campo = mix( vec3<f32>( 0.055, 0.115, 0.045 ), vec3<f32>( 0.105, 0.185, 0.070 ), smoothstep( 0.175, 0.0, uvIn.y ) );
    col = mix( col, campo, mCampo );
    // Sombras de las nubes corriendo por el campo: es lo que hace que
    // el verde no sea una alfombra plana.
    let sombra = fbm2( vec2<f32>( p.x * 1.2 + t * 0.028, uvIn.y * 2.2 ) );
    col = mix( col, col * 0.72, smoothstep( 0.52, 0.72, sombra ) * mCampo );

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, dv ), 0.50 );

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

export function crearEscenaHumanos(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = HUMANOS_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Pasto de pradera: más corto y más claro que el del bosque, y con
  // el viento algo más lento porque acá no hay tormenta.
  const pasto = crearPasto(scene, {
    cantidad: 1500,
    base: [-0.34, -0.54],
    altura: [0.045, 0.14],
    colorBase: [0.016, 0.045, 0.018],
    colorMedio: [0.075, 0.145, 0.045],
    colorPunta: [0.24, 0.30, 0.075],
    viento: 0.8,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Semillas de diente de león flotando: pocas, claras y lentas. Dan
  // el aire de tarde tranquila que define a Lordaeron antes de la
  // plaga.
  const semillas = crearParticulas(scene, aspectoUniform, {
    cantidad: 180,
    caida: -0.022,
    deriva: 0.14,
    vaiven: 0.030,
    frecuenciaVaiven: 0.5,
    tamano: [0.0014, 0.0030],
    estirado: 1,
    giro: 4,
    forma: "redonda",
    color: [0.30, 0.32, 0.26],
    colorVivo: [0.72, 0.74, 0.62],
    sesgoBrillo: 1.8,
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
      pasto.ajustarA(camera);
      semillas.ajustarA(camera);
    },
  });
}
