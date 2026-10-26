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


// Recorte de forma de la partícula.
//
// EL problema de todas las escenas hasta acá: una partícula es un
// cuadrado, y un cuadrado opaco se ve como un cuadrado. A tamaño
// miniatura pasa, a pantalla completa se lee como confeti. Nieve,
// ceniza, brasas, espíritus y hojas tenían todos el mismo defecto.
//
// Se resuelve recortando el cuadrado con alphaTest: los píxeles que
// caen fuera de la forma se descartan. No usa transparencia, así que
// no hay que ordenar nada y sigue escribiendo profundidad -- o sea que
// el rechazo temprano que hace barato el pastizal sigue funcionando.
//
// tipo: 0 = redonda (nieve, ceniza, motas)
//       1 = hoja (puntiaguda en los dos extremos)
//       2 = gota (redondeada arriba, afinada abajo)
const FORMA_PARTICULA_WGSL = wgslFn(
  /* wgsl */ `
  fn formaParticula( coord: vec2<f32>, tipo: f32 ) -> f32 {
    let q = coord - vec2<f32>( 0.5, 0.5 );

    if ( tipo < 0.5 ) {
      // Disco.
      return select( 0.0, 1.0, length( q * 2.0 ) < 1.0 );
    }

    if ( tipo < 1.5 ) {
      // Hoja: el ancho se cierra hacia los dos extremos. El exponente
      // 1.7 es lo que le da la punta; con 2.0 sería una elipse y con
      // 1.0 un rombo.
      let ancho = 0.5 * ( 1.0 - pow( abs( q.y * 2.0 ), 1.7 ) );
      return select( 0.0, 1.0, abs( q.x ) < ancho );
    }

    // Gota: redondeada arriba y afinada hacia abajo.
    let cierre = 0.5 * ( 1.0 - pow( clamp( q.y * 2.0 + 0.5, 0.0, 1.0 ), 2.2 ) );
    return select( 0.0, 1.0, abs( q.x ) < cierre );
  }
`,
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
  /** Forma recortada: redonda, hoja o gota. */
  forma?: "redonda" | "hoja" | "gota";
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

  // El recorte: sin esto cada partícula es un cuadrado visible.
  // alphaTest descarta los píxeles de afuera SIN activar transparencia,
  // así que no hay orden que resolver y se sigue escribiendo
  // profundidad.
  const tipoForma = o.forma === "hoja" ? 1 : o.forma === "gota" ? 2 : 0;
  mat.alphaTest = 0.5;
  mat.opacityNode = FORMA_PARTICULA_WGSL({ coord: uv(), tipo: float(tipoForma) }) as typeof mat.opacityNode;

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

// Posición de cada vértice de una brizna de pasto.
//
// Esto corre en el VERTEX shader, una vez por vértice, no por píxel.
// Por eso miles de briznas no cuestan prácticamente nada: es como lo
// resuelven los juegos, y es lo que da el movimiento fluido sin
// pagarlo en latencia.
const BRIZNA_POS_WGSL = wgslFn(
  /* wgsl */ `
  fn briznaPos( local: vec3<f32>, idx: f32, t: f32, rango: vec4<f32>, viento: f32 ) -> vec3<f32> {
    let h1 = hash21( vec2<f32>( idx, 1.7 ) );
    let h2 = hash21( vec2<f32>( idx, 5.3 ) );
    let h3 = hash21( vec2<f32>( idx, 9.1 ) );

    // "prof" reparte las briznas en profundidad: 0 es el fondo del
    // pastizal (arriba y chiquito), 1 es el borde inferior. Al cuadrado
    // para amontonar más cerca del horizonte, como se ve un pastizal en
    // perspectiva.
    let prof = h2 * h2;

    let x = ( h1 - 0.5 ) * 1.04;
    let baseY = mix( rango.x, rango.y, prof );
    let altura = mix( rango.z, rango.w, prof ) * ( 0.6 + 0.8 * h3 );

    // La geometría del plano va de -0.5 a 0.5; "a" es 0 en la base de
    // la brizna y 1 en la punta.
    let a = local.y + 0.5;

    // Dos ondas que VIAJAN a lo largo de x, más la fase propia de cada
    // brizna. Sin ese desfase el pastizal se mueve en bloque, como una
    // alfombra, en vez de ondular.
    let v = ( sin( t * 0.72 * viento + x * 5.2 + h1 * 6.28 ) * 0.55
      + sin( t * 0.41 * viento + x * 11.0 + h3 * 6.28 ) * 0.28 );
    // El doblez va con a*a: la base queda clavada en el suelo y solo la
    // punta se mueve. Con un doblez lineal la brizna se desliza entera
    // y parece flotar.
    let doblez = v * a * a * mix( 0.012, 0.045, prof );

    // Ancha a propósito: una brizna de 3 px es una astilla, y la GPU
    // sombrea en bloques de 2x2 píxeles, así que se desperdician casi
    // todos los carriles. Pocas y anchas rinden mucho más que muchas
    // finitas, y a esta escala se ven igual.
    let ancho = mix( 0.0026, 0.0072, prof ) * ( 1.0 - a * 0.85 );

    // La profundidad va en z: así las de adelante tapan a las de atrás
    // en el orden correcto Y el test de profundidad puede descartar
    // temprano los píxeles ocultos, que es de donde salía casi todo el
    // costo.
    return vec3<f32>( x + local.x * ancho * 2.0 + doblez, baseY + a * altura, prof * 0.6 );
  }
`,
  [comoInclude(HASH_WGSL)],
);

// Tono de cada brizna. Va aparte porque se consume como varying.
const TONO_BRIZNA_WGSL = wgslFn(
  /* wgsl */ `
  fn tonoBrizna( idx: f32 ) -> f32 {
    let h = hash21( vec2<f32>( idx, 21.3 ) );
    // Sesgado hacia abajo: unas pocas briznas encendidas entre muchas
    // apagadas se ve mucho mejor que un pastizal parejo.
    return h * h;
  }
`,
  [comoInclude(HASH_WGSL)],
);

export interface OpcionesPasto {
  cantidad: number;
  /** Altura de la base de las briznas: [las del fondo, las de adelante]. */
  base: [number, number];
  /** Largo de las briznas: [las del fondo, las de adelante]. */
  altura: [number, number];
  colorBase: [number, number, number];
  colorMedio: [number, number, number];
  colorPunta: [number, number, number];
  /** Multiplicador de la velocidad del viento. */
  viento?: number;
  profundidad: number;
  orden: number;
}

/** Pastizal instanciado con viento en el vertex shader. */
export function crearPasto(scene: THREE.Scene, o: OpcionesPasto): CapaInstanciada {
  // 5 segmentos de alto para que la brizna se CURVE al doblarse; con un
  // solo segmento se inclinaría recta, como un palito.
  const geo = new THREE.PlaneGeometry(1, 1, 1, 5);
  // A diferencia del telón, el pastizal SÍ usa profundidad: es lo que
  // deja a la GPU descartar los píxeles de las briznas tapadas antes de
  // sombrearlos.
  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });

  mat.positionNode = BRIZNA_POS_WGSL({
    local: positionLocal,
    idx: instanceIndex.toFloat(),
    t: time,
    rango: vec4(o.base[0], o.base[1], o.altura[0], o.altura[1]),
    viento: float(o.viento ?? 1),
  }) as typeof mat.positionNode;

  const tono = varying(TONO_BRIZNA_WGSL({ idx: instanceIndex.toFloat() })) as unknown as ReturnType<typeof float>;

  // Oscura en la base (donde no llega la luz entre las briznas) y
  // cálida en la punta, que es donde pega el sol.
  const alturaBrizna = uv().y;
  mat.colorNode = mix(
    vec3(o.colorBase[0], o.colorBase[1], o.colorBase[2]),
    mix(
      vec3(o.colorMedio[0], o.colorMedio[1], o.colorMedio[2]),
      vec3(o.colorPunta[0], o.colorPunta[1], o.colorPunta[2]),
      tono,
    ),
    alturaBrizna.mul(alturaBrizna),
  ) as typeof mat.colorNode;

  const mesh = new THREE.InstancedMesh(geo, mat, o.cantidad);
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
