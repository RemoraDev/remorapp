import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { crearParticulas } from "./primitivas";
import type { ResultadoEscena } from "./tipos";

// Colonia terran: la refinería al borde del mundo.
//
// Los terran no tienen un planeta propio reconocible como Aiur o Char:
// lo que los identifica es la ESTÉTICA. Chapa remachada, amarillo de
// advertencia, luces de baliza y humo industrial. Sam Didier describió
// los entornos de StarCraft como "o hermosos, o marcados por la
// batalla"; los terran son siempre lo segundo.
//
// El metal mojado usa el mismo Fresnel de Schlick que el agua de la
// tormenta. Es lo que lo saca del gris plano: una plancha de acero sin
// reflejo se ve como cartón, con reflejo rasante se ve como metal.
//
// OJO: colores en espacio LINEAL. Las luces apenas por encima de 1:
// más alto recorta a blanco y se pierde el color de la baliza, que es
// justo lo que hay que reconocer.
// Nada de comillas invertidas ni de dólar-llave dentro del WGSL.

const TERRAN_WGSL = wgslFn(
  /* wgsl */ `
  fn terran( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );

    // ---------- Cielo contaminado ----------
    // Ocre sucio abajo, gris plomo arriba. No hay celeste: el aire de
    // una colonia industrial está cargado.
    var col = mix(
      vec3<f32>( 0.26, 0.145, 0.055 ),
      vec3<f32>( 0.045, 0.050, 0.065 ),
      smoothstep( 0.18, 0.80, uvIn.y )
    );

    // Smog en capas.
    let qn = vec2<f32>( p.x * 1.5 + t * 0.022, uvIn.y * 3.0 );
    let smog = fbm( qn );
    col = mix( col, vec3<f32>( 0.085, 0.072, 0.065 ), smoothstep( 0.46, 0.68, smog ) * smoothstep( 0.22, 0.90, uvIn.y ) * 0.70 );

    // ---------- Chimeneas al fondo ----------
    // Torres delgadas con humo saliendo. La silueta de chimenea es lo
    // que dice "refinería" antes que cualquier detalle.
    var lejos = 0.0;
    for ( var i = 0; i < 7; i = i + 1 ) {
      let fi = f32( i );
      let cx = ( hash21( vec2<f32>( fi, 701.0 ) ) - 0.5 ) * 1.80;
      let alto = 0.10 + hash21( vec2<f32>( fi, 709.0 ) ) * 0.17;
      let ancho = 0.012 + hash21( vec2<f32>( fi, 719.0 ) ) * 0.012;
      let base = 0.215;
      lejos = max( lejos, step( abs( p.x - cx ), ancho ) * step( base, uvIn.y ) * step( uvIn.y, base + alto ) );
      // Penacho de humo subiendo de la boca.
      let relH = uvIn.y - ( base + alto );
      let derivaH = relH * 0.9 + sin( t * 0.4 + fi ) * 0.02;
      let anchoH = ancho * ( 1.0 + relH * 14.0 );
      let humo = step( abs( p.x - cx - derivaH ), anchoH ) * step( 0.0, relH ) * step( relH, 0.26 )
        * smoothstep( 0.26, 0.0, relH ) * smoothstep( 0.42, 0.62, fbm2( vec2<f32>( p.x * 6.0, uvIn.y * 8.0 - t * 0.5 ) ) );
      col = mix( col, vec3<f32>( 0.105, 0.095, 0.090 ), humo * 0.75 );
    }
    col = mix( col, vec3<f32>( 0.030, 0.030, 0.038 ), lejos );

    // ---------- Estructuras ----------
    // Bloques macizos con techo escalonado. Lo que las vuelve terran
    // son las franjas de advertencia y las balizas, no la forma.
    var metal = 0.0;
    var luzMetal = 0.0;
    var franja = 0.0;
    for ( var i = 0; i < 4; i = i + 1 ) {
      let fi = f32( i );
      let ex = ( hash21( vec2<f32>( fi, 811.0 ) ) - 0.5 ) * 1.55;
      let ancho = 0.075 + hash21( vec2<f32>( fi, 821.0 ) ) * 0.065;
      let alto = 0.075 + hash21( vec2<f32>( fi, 823.0 ) ) * 0.090;
      let base = 0.185;
      let dx = p.x - ex;
      let rel = uvIn.y - base;
      if ( abs( dx ) < ancho && rel > 0.0 && rel < alto ) {
        metal = 1.0;
        let n = dx / ancho;
        // Chapa: cara frontal plana pero con caída hacia los cantos.
        luzMetal = clamp( 0.34 + 0.66 * ( 0.5 - n * 0.45 ), 0.12, 1.0 );
        // Juntas entre planchas, horizontales y verticales.
        let junta = smoothstep( 0.42, 0.5, abs( fract( rel * 46.0 ) - 0.5 ) )
          * smoothstep( 0.42, 0.5, abs( fract( dx * 26.0 ) - 0.5 ) );
        luzMetal = luzMetal * ( 0.72 + 0.28 * junta );
        // Franja de advertencia: diagonales amarillas y negras a la
        // altura del zócalo. Es la marca visual más terran que hay.
        let enZocalo = step( rel, alto * 0.16 );
        franja = max( franja, enZocalo * step( 0.5, fract( ( dx + rel ) * 36.0 ) ) );
      }
    }
    col = mix( col, mix( vec3<f32>( 0.040, 0.042, 0.048 ), vec3<f32>( 0.175, 0.180, 0.195 ), luzMetal ), metal );
    col = mix( col, vec3<f32>( 0.42, 0.30, 0.025 ), franja );

    // ---------- Balizas ----------
    // Rojas, parpadeando desfasadas. Apenas por encima de 1: con un
    // valor alto recortan a blanco y dejan de leerse como rojas.
    for ( var i = 0; i < 5; i = i + 1 ) {
      let fi = f32( i );
      let bx = ( hash21( vec2<f32>( fi, 907.0 ) ) - 0.5 ) * 1.60;
      let by = 0.215 + hash21( vec2<f32>( fi, 911.0 ) ) * 0.140;
      let d = length( vec2<f32>( ( p.x - bx ) * 1.3, uvIn.y - by ) );
      // Parpadeo duro, no un seno suave: una baliza prende y apaga.
      let ciclo = fract( t * 0.55 + hash21( vec2<f32>( fi, 919.0 ) ) );
      let prendida = step( ciclo, 0.42 );
      col = col + vec3<f32>( 1.15, 0.12, 0.06 ) * smoothstep( 0.012, 0.0, d ) * prendida;
      col = col + vec3<f32>( 0.85, 0.09, 0.05 ) * smoothstep( 0.065, 0.0, d ) * prendida * 0.22;
    }

    // ---------- Plataforma mojada ----------
    // Misma idea que el agua de la tormenta: el Fresnel es lo que
    // separa "chapa gris" de "metal mojado". Acá el reflejo es el
    // resplandor industrial del cielo.
    let bordeP = 0.185;
    let mPlat = smoothstep( bordeP + 0.003, bordeP - 0.003, uvIn.y );
    let bajo = max( bordeP - uvIn.y, 0.0012 );
    let prof = 0.075 / bajo;
    let mundo = vec2<f32>( p.x * prof * 2.2, prof );

    // Charcos, no un espejo entero: una plataforma mojada tiene agua
    // en partes.
    let charco = smoothstep( 0.46, 0.62, fbm2( mundo * 0.9 ) );
    // Ondulación fina del agua detenida.
    let riz = fbm2( mundo * 9.0 + vec2<f32>( t * 0.22, 0.0 ) );
    let normal = normalize( vec3<f32>( ( riz - 0.5 ) * 1.6 * charco, 1.0, ( fbm2( mundo * 9.0 + vec2<f32>( 0.0, t * 0.19 ) ) - 0.5 ) * 1.6 * charco ) );
    let vista = normalize( vec3<f32>( p.x * 0.75, -0.30 - bajo * 2.6, -1.0 ) );
    let cosV = max( dot( normal, -vista ), 0.0 );
    let fresnel = clamp( 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 ), 0.0, 1.0 ) * charco;

    let chapa = mix( vec3<f32>( 0.030, 0.030, 0.035 ), vec3<f32>( 0.075, 0.078, 0.088 ), smoothstep( 0.185, 0.0, uvIn.y ) );
    // Lo que refleja el charco es el ocre del cielo industrial.
    let reflejo = vec3<f32>( 0.28, 0.16, 0.065 );
    var colPlat = mix( chapa, reflejo, fresnel );
    // Óxido en las juntas.
    let oxido = smoothstep( 0.030, 0.0, abs( fbm2( vec2<f32>( p.x * 6.0, uvIn.y * 14.0 ) ) - 0.5 ) );
    colPlat = mix( colPlat, vec3<f32>( 0.105, 0.045, 0.018 ), oxido * ( 1.0 - charco ) * 0.6 );
    col = mix( col, colPlat, mPlat );

    // ---------- Viñeta ----------
    let dv = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.12, 0.26, dv ), 0.66 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [comoInclude(FBM_WGSL), comoInclude(FBM2_WGSL), comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);

const PROFUNDIDAD_PLANO = -80;

export function crearEscenaTerran(scene: THREE.Scene): Promise<ResultadoEscena> {
  const aspectoUniform = uniform(16 / 9);

  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  mat.colorNode = TERRAN_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform }) as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // Chispas de soldadura cayendo: naranjas, rápidas y cortas. Es el
  // detalle que dice "acá se está reparando algo".
  const chispas = crearParticulas(scene, aspectoUniform, {
    cantidad: 220,
    caida: 0.38,
    deriva: -0.12,
    vaiven: 0.012,
    frecuenciaVaiven: 1.4,
    tamano: [0.0008, 0.0018],
    estirado: 6,
    giro: 0,
    forma: "gota",
    color: [0.40, 0.14, 0.02],
    colorVivo: [1.10, 0.52, 0.12],
    sesgoBrillo: 1.8,
    profundidad: PROFUNDIDAD_PLANO + 1,
    orden: 1,
  });

  // Polvo y hollín en suspensión, lento y apagado.
  const hollin = crearParticulas(scene, aspectoUniform, {
    cantidad: 420,
    caida: 0.022,
    deriva: 0.16,
    vaiven: 0.024,
    frecuenciaVaiven: 0.5,
    tamano: [0.0009, 0.0020],
    estirado: 1,
    giro: 4,
    forma: "redonda",
    color: [0.075, 0.068, 0.060],
    colorVivo: [0.30, 0.24, 0.17],
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
      chispas.ajustarA(camera);
      hollin.ajustarA(camera);
    },
  });
}
