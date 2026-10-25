import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, wgslFn, positionLocal, instanceIndex, mix, vec3, vec4, varying, float } from "three/tsl";
import { comoInclude, HASH_WGSL } from "./wgslComun";
import type { Uniform } from "./tipos";

// Primitivas animadas reutilizables entre escenas.
//
// La lección del bosque élfico, medida: las 4200 hojas y 1400 briznas
// instanciadas costaban casi nada (4 draw calls, 19.000 triángulos),
// mientras que pintar el cielo por píxel se comía el 43% de la GPU. O
// sea: mover cosas con geometría instanciada es BARATO, calcular por
// píxel es caro. Todo lo que se mueva en las escenas nuevas sale de
// acá.
//
// OJO AL ESCRIBIR WGSL: nada de comillas invertidas ni de dólar-llave
// adentro (ver la nota en wgslComun.ts). Lo caza
// scripts/revisar-wgsl-fondos.mjs.

// Una partícula: un cuadrito que cae (o sube), se mece y gira.
//
// Es a propósito UNA sola función para lluvia, nieve, ceniza, brasas,
// esporas y polen: lo único que cambia entre ellas son velocidades y
// proporciones, no la lógica. Una gota es una partícula muy estirada
// que cae rápido y no se mece; un copo es una partícula redonda que
// cae lento y se mece mucho.
const PARTICULA_POS_WGSL = wgslFn(
  /* wgsl */ `
  fn particulaPos(
    local: vec3<f32>,
    idx: f32,
    t: f32,
    aspecto: f32,
    mov: vec4<f32>,
    forma: vec4<f32>
  ) -> vec3<f32> {
    let h1 = hash21( vec2<f32>( idx, 1.3 ) );
    let h2 = hash21( vec2<f32>( idx, 7.1 ) );
    let h3 = hash21( vec2<f32>( idx, 3.9 ) );

    // Cada partícula tiene su propia velocidad: con una sola para todas
    // el conjunto baja como una cortina rígida en vez de como lluvia.
    let velocidad = mov.x * ( 0.65 + 0.7 * h3 );
    // fract() hace el ciclo infinito sin reiniciar nada desde la CPU:
    // la partícula reaparece arriba sola. Con velocidad negativa sube,
    // que es lo que usan las brasas y el polen.
    let ciclo = fract( h2 + t * velocidad );

    // Se recorre algo más que la pantalla para que nazcan y mueran
    // fuera de cuadro y no se vea aparecer ninguna.
    let y = 1.12 - ciclo * 1.24;

    let vaiven = sin( t * mov.w + h1 * 6.28318 ) * mov.z;
    let px = ( h1 - 0.5 ) * 1.15 * aspecto + mov.y * ciclo + vaiven;

    let tam = mix( forma.x, forma.y, h3 );
    let lx = local.x * tam;
    let ly = local.y * tam * forma.z;
    // Inclinación por la propia trayectoria: si la partícula cae y a la
    // vez se desplaza de costado, tiene que ir INCLINADA en esa
    // dirección. Sale de la física, no a ojo, y es lo que hace que la
    // lluvia con viento se vea como lluvia y no como rayitas verticales.
    let inclinacion = atan2( mov.y, max( abs( mov.x ), 0.0001 ) );
    // Más el giro propio y una parte del vaivén: así la partícula se da
    // vuelta al mecerse, no solo se desplaza de costado.
    let giro = inclinacion + ( h1 - 0.5 ) * forma.w + vaiven * 5.0;
    let co = cos( giro );
    let si = sin( giro );
    let rx = lx * co - ly * si;
    let ry = lx * si + ly * co;

    // px está en espacio corregido por aspecto; el plano va de -0.5 a
    // 0.5. Sin dividir, las partículas salen ovaladas en pantalla ancha.
    return vec3<f32>( ( px + rx ) / aspecto, y - 0.5 + ry, 0.0 );
  }
`,
  [comoInclude(HASH_WGSL)],
);

// Brillo propio de cada partícula: casi todas apagadas, unas pocas
// encendidas. Ese contraste es lo que hace que un conjunto se lea como
// muchas cosas distintas y no como una textura plana.
const TONO_PARTICULA_WGSL = wgslFn(
  /* wgsl */ `
  fn tonoParticula( idx: f32, sesgo: f32 ) -> f32 {
    let h = hash21( vec2<f32>( idx, 31.4 ) );
    return pow( h, sesgo );
  }
`,
  [comoInclude(HASH_WGSL)],
);

export interface OpcionesParticulas {
  cantidad: number;
  /** Velocidad de caída en pantallas por segundo. Negativa = sube. */
  caida: number;
  /** Desplazamiento lateral a lo largo del recorrido (viento constante). */
  deriva?: number;
  /** Amplitud del vaivén lateral. Una gota no se mece; un copo sí. */
  vaiven?: number;
  /** Frecuencia del vaivén. */
  frecuenciaVaiven?: number;
  /** Tamaño mínimo y máximo, en fracción de pantalla. */
  tamano: [number, number];
  /** Estirado vertical. 1 = cuadrado, 8 = raya de lluvia. */
  estirado?: number;
  /** Cuánto gira cada partícula sobre sí misma. */
  giro?: number;
  /** Color de las apagadas y de las encendidas. */
  color: [number, number, number];
  colorVivo: [number, number, number];
  /**
   * Sesgo del brillo. 1 = repartido parejo; 3 = casi todas apagadas con
   * unas pocas encendidas.
   */
  sesgoBrillo?: number;
  /** Z relativo a la escena, para ordenar las capas. */
  profundidad: number;
  orden: number;
}

export interface CapaInstanciada {
  mesh: THREE.InstancedMesh;
  /** Hay que llamarlo desde alRedimensionar() de la escena. */
  ajustarA: (camera: THREE.PerspectiveCamera) => void;
}

/**
 * Crea una capa de partículas instanciadas. Cubre lluvia, nieve,
 * ceniza, brasas, esporas y polen cambiando solo los parámetros.
 */
export function crearParticulas(
  scene: THREE.Scene,
  aspectoUniform: Uniform,
  o: OpcionesParticulas,
): CapaInstanciada {
  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });

  mat.positionNode = PARTICULA_POS_WGSL({
    local: positionLocal,
    idx: instanceIndex.toFloat(),
    t: time,
    aspecto: aspectoUniform,
    mov: vec4(o.caida, o.deriva ?? 0, o.vaiven ?? 0, o.frecuenciaVaiven ?? 1),
    forma: vec4(o.tamano[0], o.tamano[1], o.estirado ?? 1, o.giro ?? 0),
  }) as typeof mat.positionNode;

  // El cast: wgslFn no tipa su retorno, así que varying() hereda
  // "unknown". Acá sabemos que tonoParticula() devuelve f32.
  const tono = varying(
    TONO_PARTICULA_WGSL({ idx: instanceIndex.toFloat(), sesgo: float(o.sesgoBrillo ?? 2) }),
  ) as unknown as ReturnType<typeof float>;

  mat.colorNode = mix(
    vec3(o.color[0], o.color[1], o.color[2]),
    vec3(o.colorVivo[0], o.colorVivo[1], o.colorVivo[2]),
    tono,
  ) as typeof mat.colorNode;

  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, o.cantidad);
  // Las posiciones salen del shader a partir de instanceIndex, así que
  // las matrices por instancia no se usan: se evita subir miles de
  // matrices a la GPU y el culling por caja no tiene sentido.
  mesh.frustumCulled = false;
  mesh.position.set(0, 0, o.profundidad);
  mesh.renderOrder = o.orden;
  scene.add(mesh);

  return {
    mesh,
    ajustarA: (camera) => {
      const distancia = camera.position.z - mesh.position.z;
      const alto = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      mesh.scale.set(alto * camera.aspect, alto, 1);
    },
  };
}

// Se reexporta para que las escenas no tengan que importar uv() solo
// para el degradé vertical de una partícula alargada.
export { uv };
