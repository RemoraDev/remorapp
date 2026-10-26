import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Char: el mundo volcánico tomado por el Enjambre.
//
// Es la escena más distinta de las doce, y por eso casi nada de lo ya
// hecho sirve acá: las otras once son paisajes con cielo, horizonte y
// vegetación. Esta es BIOMASA -- superficies orgánicas, húmedas, que
// laten. No hay arquitectura ni plantas.
//
// Dos datos guiaron la paleta, y los dos contradicen lo que uno
// asumiría. El creep es "una alfombra viviente de biomateria" PÚRPURA,
// no verde. Y la quitina zerg es marrón cálida con carne magenta: el
// enjambre no es una mancha verde ácido, es carne y caparazón.
//
// Lo que de verdad lo vuelve zerg es que RESPIRA. Una textura orgánica
// quieta se lee como roca rara; lo vivo es el latido, y acá recorre
// todo: el creep, las venas, los tentáculos y las pústulas.
//
// OJO: colores en espacio LINEAL (se codifican a sRGB, que los aclara).
// Las fuentes de luz apenas por encima de 1: más alto recorta a blanco
// y se pierde el matiz.
// Nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const ZERG_WGSL = wgslFn(
  /* wgsl */ `
  fn zerg( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // El latido del enjambre. Un solo pulso recorre toda la escena:
    // que creep, venas y tentáculos respiren JUNTOS es lo que hace
    // sentir que son un mismo organismo y no decorados sueltos.
    let latido = 0.5 + 0.5 * sin( t * 0.85 );

    // ---------- Cielo de Char ----------
    // Ceniza arriba, resplandor volcánico abajo. El naranja viene del
    // suelo, no del sol: no hay sol visible en Char.
    var col = mix(
      vec3<f32>( 0.30, 0.085, 0.030 ),
      vec3<f32>( 0.045, 0.030, 0.055 ),
      smoothstep( 0.16, 0.72, uvIn.y )
    );

    // Nubarrones de ceniza, espesos y bajos.
    let qn = vec2<f32>( p.x * 1.6 + t * 0.030, uvIn.y * 3.2 + t * 0.010 );
    let nube = fbm( qn );
    let nubeAbajo = fbm( qn - vec2<f32>( 0.0, 0.18 ) );
    let cuerpo = smoothstep( 0.46, 0.62, nube ) * smoothstep( 0.20, 0.95, uvIn.y );
    col = mix( col, vec3<f32>( 0.055, 0.040, 0.050 ), cuerpo * 0.85 );
    // El filo de abajo se enciende: la luz sube desde la lava.
    let filo = clamp( ( nubeAbajo - nube ) * 6.0, 0.0, 1.0 );
    col = col + vec3<f32>( 0.75, 0.26, 0.07 ) * cuerpo * filo * 0.40;

    // ---------- Risco volcánico ----------
    let hRisco = 0.265 + fbm2( vec2<f32>( p.x * 1.3, 5.0 ) ) * 0.075;
    let mRisco = smoothstep( hRisco + 0.003, hRisco - 0.003, uvIn.y );
    col = mix( col, vec3<f32>( 0.028, 0.020, 0.028 ), mRisco );
    // Grietas de lava en la roca.
    let lava = fbm2( vec2<f32>( p.x * 4.5, uvIn.y * 9.0 ) );
    col = col + vec3<f32>( 1.0, 0.30, 0.05 ) * smoothstep( 0.030, 0.0, abs( lava - 0.5 ) ) * mRisco * 0.55;

    // ---------- Tentáculos ----------
    // Crecen del creep hacia arriba, curvándose. No son árboles: se
    // afinan hasta una punta y se doblan, y el doblez se mueve con el
    // latido, no con viento.
    var carne = 0.0;
    var luzCarne = 0.0;
    for ( var i = 0; i < 5; i = i + 1 ) {
      let fi = f32( i );
      let bx = ( hash21( vec2<f32>( fi, 601.0 ) ) - 0.5 ) * 1.70;
      let alto = 0.16 + hash21( vec2<f32>( fi, 607.0 ) ) * 0.20;
      let base = 0.195;
      let rel = uvIn.y - base;
      let frac = clamp( rel / alto, 0.0, 1.0 );
      // La curva crece con el cuadrado de la altura: la base queda
      // clavada y la punta es lo que se mece.
      let curva = ( hash21( vec2<f32>( fi, 613.0 ) ) - 0.5 ) * 0.22 * frac * frac
        + sin( t * 0.7 + fi * 1.9 ) * 0.016 * frac * frac;
      let cx = bx + curva;
      // Se afina con una potencia: recto se vería como un cono, y un
      // tentáculo tiene panza abajo y punta fina.
      let ancho = ( 0.026 + hash21( vec2<f32>( fi, 617.0 ) ) * 0.016 ) * pow( 1.0 - frac, 0.7 );
      let dx = p.x - cx;
      if ( abs( dx ) < ancho && rel > 0.0 && rel < alto ) {
        carne = 1.0;
        let n = dx / max( ancho, 0.0001 );
        // Volumen: cilíndrico, con la luz de la lava entrando desde
        // abajo y de costado.
        luzCarne = clamp( 0.20 + 0.80 * ( 0.5 - n * 0.50 ), 0.08, 1.0 );
        // Anillos de quitina a lo largo: es lo que lo separa de un
        // tubo liso y lo vuelve un cuerpo segmentado.
        let anillo = 0.82 + 0.18 * sin( rel * 150.0 - t * 1.2 );
        luzCarne = luzCarne * anillo;
      }
    }
    // Marrón de caparazón, no verde. El brillo va al magenta de la
    // carne que asoma entre los segmentos.
    col = mix( col, mix( vec3<f32>( 0.035, 0.014, 0.020 ), vec3<f32>( 0.195, 0.080, 0.075 ), luzCarne ), carne );

    // ---------- El creep ----------
    // No es un suelo plano: es una capa que SE DERRAMA, con borde
    // irregular y lobulado. Ese borde es la firma del creep -- se ve
    // que está invadiendo el terreno.
    let bordeCreep = 0.205 + fbm( vec2<f32>( p.x * 2.6, 3.0 ) ) * 0.075;
    let mCreep = smoothstep( bordeCreep + 0.006, bordeCreep - 0.006, uvIn.y );

    let tex = fbm( vec2<f32>( p.x * 5.0, uvIn.y * 9.0 ) );
    let creepBase = mix( vec3<f32>( 0.055, 0.022, 0.065 ), vec3<f32>( 0.105, 0.040, 0.105 ), tex );
    col = mix( col, creepBase, mCreep );

    // Venas: una red que late. El abs() alrededor del valor medio deja
    // LÍNEAS en vez de manchas.
    let vena = fbm( vec2<f32>( p.x * 7.0, uvIn.y * 13.0 ) );
    let redVena = smoothstep( 0.040, 0.0, abs( vena - 0.5 ) ) * mCreep;
    col = col + vec3<f32>( 0.85, 0.18, 0.55 ) * redVena * ( 0.45 + 0.55 * latido ) * 0.55;

    // Pústulas: bultos que se inflan y desinflan, cada uno con su fase.
    let gp = vec2<f32>( p.x * 16.0, uvIn.y * 30.0 );
    let celda = floor( gp );
    let hp = hash21( celda );
    let fasePus = hash21( celda + 5.5 ) * 6.28318;
    let infla = 0.55 + 0.45 * sin( t * 1.1 + fasePus );
    let centroPus = vec2<f32>( 0.25 + 0.5 * hash21( celda + 2.2 ), 0.25 + 0.5 * hash21( celda + 9.9 ) );
    let dPus = length( fract( gp ) - centroPus );
    let pustula = smoothstep( 0.30 * infla, 0.05 * infla, dPus ) * step( 0.80, hp ) * mCreep;
    col = col + vec3<f32>( 0.55, 0.12, 0.42 ) * pustula * 0.50;
    // Brillo húmedo en la parte de arriba de cada pústula.
    col = col + vec3<f32>( 0.70, 0.35, 0.60 ) * pustula * smoothstep( 0.18, 0.0, dPus ) * 0.35;

    // ---------- Resplandor del enjambre ----------
    // La luz magenta del creep sube y tiñe el aire: es lo que integra
    // el suelo con la escena en vez de dejarlo como una alfombra
    // pegada abajo.
    col = col + vec3<f32>( 0.42, 0.06, 0.26 ) * smoothstep( 0.42, 0.16, uvIn.y ) * ( 0.55 + 0.45 * latido ) * 0.28;

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.10, 0.25, dv ), 0.68 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [comoInclude(FBM_WGSL), comoInclude(FBM2_WGSL), comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaZerg(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = ZERG_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Esporas subiendo del creep: magenta, lentas y numerosas. El aire
  // sobre una colonia zerg nunca está limpio.
  const esporas = crearParticulas(scene, aspectoUniform, {
    cantidad: 480,
    caida: -0.038,
    deriva: 0.07,
    vaiven: 0.026,
    frecuenciaVaiven: 0.55,
    tamano: [0.0012, 0.0030],
    estirado: 1.3,
    giro: 4,
    forma: "redonda",
    color: [0.14, 0.035, 0.11],
    colorVivo: [0.90, 0.22, 0.60],
    sesgoBrillo: 2.2,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Ceniza volcánica CAYENDO, en contra de las esporas. Que dos capas
  // se crucen en direcciones opuestas es lo que llena el aire sin que
  // se lea como una sola cortina.
  const ceniza = crearParticulas(scene, aspectoUniform, {
    cantidad: 380,
    caida: 0.055,
    deriva: -0.10,
    vaiven: 0.018,
    frecuenciaVaiven: 0.7,
    tamano: [0.0010, 0.0022],
    estirado: 1,
    giro: 5,
    forma: "redonda",
    color: [0.10, 0.065, 0.060],
    colorVivo: [0.45, 0.20, 0.10],
    sesgoBrillo: 2.4,
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
      esporas.ajustarA(camera);
      ceniza.ajustarA(camera);
    },
  });
}
