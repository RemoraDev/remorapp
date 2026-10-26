import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Tormenta: lluvia, nubes bajas y relámpagos.
//
// Es la escena con mejor relación impacto/costo de toda la serie:
// - la lluvia son partículas instanciadas, prácticamente gratis;
// - el relámpago es UN número que modula el brillo de todo el cuadro.
//
// El relámpago está hecho con cuidado, porque es lo que decide si la
// escena se siente real: un destello parejo y periódico lee como una
// luz estroboscópica, no como una tormenta. Acá cada descarga tiene
// resplandor previo, doble pulso (los rayos casi nunca son un solo
// fogonazo) y una caída larga; y el intervalo entre descargas es
// irregular.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL.

// Intensidad del relámpago en el instante t, de 0 a 1.
const RELAMPAGO_WGSL = wgslFn(
  /* wgsl */ `
  fn relampago( t: f32 ) -> f32 {
    // Cada "ventana" de 7 segundos contiene como mucho una descarga.
    let ventana = 7.0;
    let n = floor( t / ventana );
    let dentro = t - n * ventana;

    // No en todas las ventanas cae un rayo: si cayera en todas, el
    // ritmo se vuelve previsible y deja de parecer una tormenta.
    let hayRayo = step( 0.42, hash21( vec2<f32>( n, 3.1 ) ) );
    // Y el momento dentro de la ventana también cambia.
    let cuando = 0.8 + hash21( vec2<f32>( n, 8.7 ) ) * 4.6;
    let d = dentro - cuando;

    // Resplandor previo: el cielo se carga un instante antes del
    // fogonazo. Es un detalle chico que vende muchísimo.
    let previo = smoothstep( -0.22, -0.02, d ) * ( 1.0 - step( 0.0, d ) ) * 0.28;

    // Doble pulso: el principal y una réplica más débil, que es como
    // se ve un rayo real.
    let pulso1 = exp( -max( d, 0.0 ) * 11.0 ) * step( 0.0, d );
    let d2 = d - 0.11;
    let pulso2 = exp( -max( d2, 0.0 ) * 16.0 ) * step( 0.0, d2 ) * 0.55;

    // Cola larga y tenue: el cielo tarda en volver a apagarse.
    let cola = exp( -max( d, 0.0 ) * 2.1 ) * step( 0.0, d ) * 0.16;

    let fuerza = 0.55 + 0.45 * hash21( vec2<f32>( n, 15.2 ) );
    return clamp( ( previo + pulso1 + pulso2 + cola ) * fuerza, 0.0, 1.4 ) * hayRayo;
  }
`,
  [comoInclude(HASH_WGSL)],
);

const TORMENTA_WGSL = wgslFn(
  /* wgsl */ `
  fn tormenta( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );
    let rayo = relampago( t );

    // ---------- Cielo ----------
    // Gris plomo arriba, algo más claro contra el horizonte. Paleta
    // corta a propósito: en una tormenta casi no hay color, y eso
    // además deja que el relámpago se note.
    var col = mix(
      vec3<f32>( 0.20, 0.23, 0.28 ),
      vec3<f32>( 0.055, 0.065, 0.090 ),
      smoothstep( 0.10, 0.95, uvIn.y )
    );

    // ---------- Nubes bajas ----------
    // Dos muestras a distinta altura para iluminar el filo de abajo:
    // en una tormenta la luz viene de los relámpagos, por debajo de la
    // nube, no de arriba.
    let qn = vec2<f32>( p.x * 1.9 + t * 0.045, uvIn.y * 3.4 + t * 0.008 );
    let nube = fbm( qn );
    let nubeAbajo = fbm( qn - vec2<f32>( 0.0, 0.18 ) );
    let altoCielo = smoothstep( 0.30, 1.0, uvIn.y );
    let cuerpo = smoothstep( 0.44, 0.60, nube ) * altoCielo;
    let filoInferior = clamp( ( nubeAbajo - nube ) * 6.0, 0.0, 1.0 );
    col = mix( col, vec3<f32>( 0.085, 0.095, 0.125 ), cuerpo * 0.85 );
    // El filo de la nube se enciende con el rayo: es lo que hace que el
    // relámpago parezca estar DETRÁS de las nubes y no delante.
    col = col + vec3<f32>( 0.75, 0.80, 1.0 ) * cuerpo * filoInferior * ( 0.10 + rayo * 1.5 );

    // ---------- Cortinas de lluvia al fondo ----------
    // No son gotas: es la lluvia lejana, que se ve como velos que
    // cruzan. Las gotas de verdad van instanciadas aparte.
    let velo = fbm2( vec2<f32>( p.x * 3.0 + t * 0.55, uvIn.y * 0.7 ) );
    col = mix( col, vec3<f32>( 0.22, 0.25, 0.32 ), smoothstep( 0.55, 0.95, velo ) * 0.30 );

    // ---------- Tierra y agua ----------
    // Antes acá había un cerro casi negro y sin forma, y no se entendía
    // qué era. Ahora son dos cosas distintas y legibles: una línea de
    // colinas al fondo y, delante, una llanura inundada.
    //
    // El agua no es decoración: le da al relámpago algo que hacer. Un
    // rayo que no se refleja en nada se siente pegado encima de la
    // imagen.
    let colinas = 0.215 + fbm2( vec2<f32>( p.x * 1.1, 5.0 ) ) * 0.045;
    let mColinas = smoothstep( colinas + 0.003, colinas - 0.003, uvIn.y );
    col = mix( col, vec3<f32>( 0.040, 0.048, 0.065 ), mColinas );
    col = col + vec3<f32>( 0.30, 0.34, 0.48 ) * mColinas * rayo * 0.40;

    // ---------- EL AGUA ----------
    // Antes eran bandas de seno pintadas sobre una franja: se veía como
    // una cortina rayada, no como agua. Un mar se lee por tres cosas, y
    // ninguna es la forma de la onda:
    //
    //   1. la PERSPECTIVA -- las olas se achican y se juntan hacia el
    //      horizonte, porque están más lejos;
    //   2. la NORMAL de cada ola, que es lo que hace que una cara mire
    //      al cielo y la de al lado no;
    //   3. el FRESNEL -- el agua refleja casi como un espejo cuando se
    //      la mira de canto, y deja ver su propio color cuando se la
    //      mira desde arriba. Ese cambio a lo largo del plano es la
    //      señal más fuerte de que hay una superficie horizontal.
    let lineaAgua = 0.175;
    let mAgua = smoothstep( lineaAgua + 0.002, lineaAgua - 0.002, uvIn.y );

    // Reproyección: cada píxel bajo el horizonte corresponde a un punto
    // del plano del agua. La profundidad crece como 1/altura, que es la
    // perspectiva de un plano visto de canto.
    let bajoHorizonte = max( lineaAgua - uvIn.y, 0.0012 );
    let prof = 0.085 / bajoHorizonte;
    let mundo = vec2<f32>( p.x * prof * 2.4, prof );

    // Cinco trenes de olas en distintas direcciones. Con uno solo queda
    // un corrugado regular; lo que rompe el patrón es que se crucen.
    var altura = 0.0;
    var pendX = 0.0;
    var pendZ = 0.0;
    for ( var i = 0; i < 5; i = i + 1 ) {
      let fi = f32( i );
      let ang = 1.1 + fi * 1.37;
      let dir = vec2<f32>( cos( ang ), sin( ang ) );
      let k = 2.6 * pow( 1.75, fi );
      let amp = 0.085 / pow( 1.75, fi );
      let fase = dot( dir, mundo ) * k + t * ( 1.1 + fi * 0.45 );
      altura = altura + sin( fase ) * amp;
      let d = cos( fase ) * amp * k;
      pendX = pendX + d * dir.x;
      pendZ = pendZ + d * dir.y;
    }
    // Lejos las olas se aplanan: a esa distancia no se resuelve el
    // detalle, y sin esto el horizonte queda hirviendo de ruido.
    let detalle = smoothstep( 0.0, 0.055, bajoHorizonte );
    let normal = normalize( vec3<f32>( -pendX * detalle, 1.0, -pendZ * detalle ) );

    // Fresnel: 1 pegado al horizonte (se mira de canto, espeja) y bajo
    // en el borde inferior (se mira desde arriba, se ve el agua).
    let canto = 1.0 - smoothstep( 0.0, lineaAgua * 0.95, bajoHorizonte );
    let fresnel = clamp( mix( 0.05, 1.0, pow( canto, 1.7 ) ) + normal.z * 0.25, 0.0, 1.0 );

    // Lo que refleja: el mismo cielo de la escena, que es lo que ata el
    // agua al resto del cuadro. Si reflejara un color fijo, parecería
    // pintada aparte.
    let cieloReflejado = mix(
      vec3<f32>( 0.060, 0.070, 0.095 ),
      vec3<f32>( 0.105, 0.120, 0.150 ),
      canto
    ) + vec3<f32>( 0.38, 0.42, 0.58 ) * rayo * ( 0.35 + 0.65 * canto );
    let aguaProfunda = vec3<f32>( 0.016, 0.026, 0.038 );
    var colAgua = mix( aguaProfunda, cieloReflejado, fresnel );

    // Brillo especular en las caras que miran al relámpago: es lo que
    // convierte el fogonazo en un camino de luz sobre el agua.
    let haciaLuz = normalize( vec3<f32>( -0.25, 0.55, -0.8 ) );
    let brillo = pow( max( dot( normal, haciaLuz ), 0.0 ), 48.0 );
    colAgua = colAgua + vec3<f32>( 0.85, 0.90, 1.0 ) * brillo * ( 0.05 + rayo * 1.6 );

    // Espuma en las crestas, solo cerca, donde se resuelve.
    let espuma = smoothstep( 0.045, 0.075, altura ) * smoothstep( 0.0, 0.09, bajoHorizonte );
    colAgua = colAgua + vec3<f32>( 0.16, 0.18, 0.22 ) * espuma;

    col = mix( col, colAgua, mAgua );

    // Repique de la lluvia sobre el agua: puntitos que aparecen y se
    // apagan donde cae cada gota.
    let gp = vec2<f32>( p.x * 55.0, uvIn.y * 120.0 );
    let celdaG = floor( gp );
    let hg = hash21( celdaG );
    let vida = fract( hg * 7.0 + t * 1.6 );
    let repique = step( 0.988, hg ) * smoothstep( 0.35, 0.0, length( fract( gp ) - 0.5 ) ) * smoothstep( 1.0, 0.3, vida );
    col = col + vec3<f32>( 0.30, 0.35, 0.46 ) * repique * mAgua;

    // ---------- El fogonazo sobre todo el cuadro ----------
    // Más fuerte arriba que abajo, porque la descarga está en el cielo.
    col = col + vec3<f32>( 0.62, 0.68, 0.85 ) * rayo * ( 0.30 + 0.70 * uvIn.y );

    // ---------- Viñeta ----------
    let d = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, d ), 0.6 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [
    comoInclude(RELAMPAGO_WGSL),
    comoInclude(FBM_WGSL),
    comoInclude(FBM2_WGSL),
    comoInclude(RUIDO_WGSL),
    comoInclude(HASH_WGSL),
  ],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaTormenta(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = TORMENTA_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Lluvia lejana: finita, lenta y tenue.
  const lluviaLejos = crearParticulas(scene, aspectoUniform, {
    cantidad: 1500,
    caida: 0.55,
    deriva: -0.17,
    tamano: [0.0009, 0.0015],
    estirado: 20,
    forma: "gota",
    color: [0.19, 0.22, 0.29],
    colorVivo: [0.32, 0.37, 0.46],
    sesgoBrillo: 2.6,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Lluvia cercana: más gruesa, más rápida y más inclinada. Las dos
  // capas a distinta velocidad son las que dan sensación de
  // profundidad; con una sola la lluvia parece una cortina plana.
  const lluviaCerca = crearParticulas(scene, aspectoUniform, {
    cantidad: 800,
    caida: 1.15,
    deriva: -0.30,
    tamano: [0.0015, 0.0026],
    estirado: 26,
    forma: "gota",
    color: [0.30, 0.35, 0.44],
    colorVivo: [0.52, 0.58, 0.70],
    sesgoBrillo: 2.2,
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
      lluviaLejos.ajustarA(camera);
      lluviaCerca.ajustarA(camera);
    },
  });
}
