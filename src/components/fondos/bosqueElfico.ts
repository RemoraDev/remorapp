import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, time, uniform, wgslFn, positionLocal, instanceIndex, mix, vec3, varying, float } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";
import { SKYLINE_WGSL } from "./siluetas";
import type { ResultadoEscena } from "./tipos";

// Bosque élfico al atardecer, 100% procedural (no hay ninguna imagen
// detrás). Pedido del usuario: fondos "estilo anime" 2D animados, con
// el pasto y las hojas moviéndose con el viento, sin dar lag.
//
// Cómo está armado, de atrás hacia adelante:
//   1. cielo en degradé + sol bajo + halo
//   2. nubes finas de ruido fractal
//   3. rayos de luz (god rays) saliendo del sol
//   4. tres líneas de bosque a distintas profundidades
//   5. bruma entre capas, que es lo que de verdad da sensación de fondo
//   6. follaje de primer plano enmarcando arriba
//
// El viento no es un desplazamiento global: cada capa se mueve con su
// propia amplitud y fase (las lejanas casi nada, las cercanas mucho),
// que es lo que hace que se lea como profundidad y no como una textura
// corriéndose entera.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL
// (ver la nota en wgslComun.ts).

// Geometría de los árboles de primer plano, compartida entre el shader
// del telón (que pinta tronco y masa de copa) y el de las hojas (que
// las reparte). Las dos tienen que coincidir o las hojas quedan
// flotando al lado del árbol, así que sale de una sola función.
const ARBOL_WGSL = wgslFn(
  /* wgsl */ `
  fn arbolDato( fi: f32, cual: f32 ) -> f32 {
    let lado = select( -1.0, 1.0, hash21( vec2<f32>( fi, 31.0 ) ) > 0.45 );
    let cx = lado * ( 0.54 + hash21( vec2<f32>( fi, 7.0 ) ) * 0.32 );
    let cy = 1.02 + hash21( vec2<f32>( fi, 41.0 ) ) * 0.10;
    let radio = 0.30 + hash21( vec2<f32>( fi, 53.0 ) ) * 0.12;
    if ( cual < 0.5 ) { return cx; }
    if ( cual < 1.5 ) { return cy; }
    return radio;
  }
`,
  [comoInclude(HASH_WGSL)],
);

const BOSQUE_WGSL = wgslFn(
  /* wgsl */ `
  fn bosqueElfico( uvIn: vec2<f32>, t: f32, aspecto: f32 ) -> vec4<f32> {
    // p: x corregida por aspecto y centrada, y de 0 (abajo) a 1 (arriba).
    let p = vec2<f32>( ( uvIn.x - 0.5 ) * aspecto, uvIn.y );
    let solPos = vec2<f32>( -0.22, 0.60 );

    // ---------- 1. Cielo ----------
    // Tres paradas, no dos: ámbar en el horizonte, turquesa en el medio
    // y azul profundo arriba. Con solo dos el cielo quedaba lavado y
    // nada "anime" -- lo que da el look es el salto de temperatura.
    var col = mix(
      vec3<f32>( 1.00, 0.70, 0.36 ),
      vec3<f32>( 0.36, 0.68, 0.72 ),
      smoothstep( 0.28, 0.62, uvIn.y )
    );
    col = mix( col, vec3<f32>( 0.10, 0.26, 0.52 ), smoothstep( 0.60, 1.02, uvIn.y ) );

    // ---------- 2. Sol ----------
    let dSol = length( p - solPos );
    // Disco nítido + dos halos de radios distintos: el disco es lo que
    // faltaba para que se leyera un sol y no una mancha.
    col = mix( col, vec3<f32>( 1.0, 0.97, 0.88 ), smoothstep( 0.055, 0.040, dSol ) );
    // Halos CORTOS. Antes el segundo llegaba hasta dSol = 1.0, o sea
    // casi todo el cuadro: eso sumaba luz cálida en cada píxel y era lo
    // que lavaba el cielo entero y mataba la saturación.
    col = col + vec3<f32>( 1.0, 0.82, 0.48 ) * smoothstep( 0.17, 0.05, dSol ) * 0.45;
    col = col + vec3<f32>( 1.0, 0.68, 0.34 ) * smoothstep( 0.42, 0.05, dSol ) * 0.16;

    // ---------- 3. Nubes ----------
    // Mucho más finas y altas que en la primera versión: con el umbral
    // bajo y la escala grande tapaban el cielo entero y toda la escena
    // quedaba con aspecto de día nublado.
    // El 0.013 de antes era tan lento que el usuario directamente no
    // veía moverse las nubes. Además se deforman con el tiempo (el
    // segundo eje también avanza), así que no es un calco corriéndose.
    // Dos muestras a distinta altura. La diferencia entre ellas dice
    // hacia dónde "crece" la nube, y con eso se ilumina el filo de
    // arriba y se deja el cuerpo en sombra. Eso es lo que le da volumen
    // de cúmulo: con una sola muestra y un degradé queda el borrón que
    // el usuario describió como una mancha.
    let qn = vec2<f32>( p.x * 2.4 + t * 0.050, uvIn.y * 5.0 + t * 0.010 );
    let nube = fbm( qn );
    let nubeArriba = fbm( qn + vec2<f32>( 0.0, 0.16 ) );
    let altoCielo = smoothstep( 0.46, 0.99, uvIn.y );
    // Borde más duro que antes (0.60-0.95 era un degradé largo).
    let cuerpo = smoothstep( 0.52, 0.63, nube ) * altoCielo;
    let filo = clamp( ( nubeArriba - nube ) * 7.0, 0.0, 1.0 );
    col = mix( col, vec3<f32>( 0.80, 0.78, 0.82 ), cuerpo * 0.78 );
    col = col + vec3<f32>( 1.0, 0.94, 0.82 ) * cuerpo * filo * 0.75;

    // ---------- 4. Rayos de luz ----------
    // Se calculan sobre el ÁNGULO respecto del sol, no sobre x: así
    // divergen desde el sol como rayos de verdad, en vez de quedar
    // como bandas verticales paralelas.
    let dir = p - solPos;
    let ang = atan2( dir.y, dir.x );
    let rayo = fbm2( vec2<f32>( ang * 2.8, t * 0.06 ) );
    let fuerzaRayo = smoothstep( 0.46, 1.0, rayo )
      * smoothstep( 1.5, 0.05, length( dir ) )
      * smoothstep( 0.08, 0.5, uvIn.y );
    col = col + vec3<f32>( 1.0, 0.85, 0.58 ) * fuerzaRayo * 0.30;

    // ---------- 5. Capas de bosque ----------
    // Cada capa: su propia escala (más chica = más lejos), su altura,
    // su amplitud de viento y su color. Las lejanas se mezclan con el
    // color del cielo (perspectiva atmosférica), que es lo que las
    // manda al fondo.
    let bordeSuave = 0.004;
    // Por encima de esta altura no hay bosque posible (la capa más alta
    // llega a ~0.33), así que se saltea el cálculo de las tres líneas
    // de árboles para la mayor parte del cielo, que es donde está la
    // mayoría de los píxeles del cuadro.
    if ( uvIn.y < 0.42 ) {

    // Capa lejana.
    let hLejos = skyline( p.x, 2.6, 0.30, 0.055, 0.004, t );
    let mLejos = smoothstep( hLejos + bordeSuave, hLejos - bordeSuave, uvIn.y );
    col = mix( col, mix( vec3<f32>( 0.52, 0.60, 0.58 ), col, 0.45 ), mLejos );

    // Bruma entre la capa lejana y la media: el truco barato que más
    // profundidad da. Tenue -- subida de 0.35 tapaba el bosque entero.
    col = mix( col, vec3<f32>( 1.0, 0.82, 0.62 ), smoothstep( 0.30, 0.17, uvIn.y ) * 0.22 * mLejos );

    // Capa media.
    let hMedio = skyline( p.x + 11.3, 4.1, 0.22, 0.070, 0.011, t );
    let mMedio = smoothstep( hMedio + bordeSuave, hMedio - bordeSuave, uvIn.y );
    col = mix( col, mix( vec3<f32>( 0.13, 0.26, 0.24 ), col, 0.22 ), mMedio );

    // Capa cercana, ya casi silueta.
    let hCerca = skyline( p.x + 27.7, 6.4, 0.13, 0.085, 0.022, t );
    let mCerca = smoothstep( hCerca + bordeSuave, hCerca - bordeSuave, uvIn.y );
    col = mix( col, vec3<f32>( 0.045, 0.10, 0.09 ), mCerca );

    }

    // ---------- 6. Follaje de primer plano ----------
    // Enmarca arriba y en los costados. Es lo que hace que la escena se
    // sienta "adentro del bosque" y no una postal mirada de lejos.
    let vientoF = sin( t * 0.50 ) * 0.035 + sin( t * 0.31 + 1.3 ) * 0.020;
    // Frecuencia alta: con la escala baja de antes salían manchones del
    // tamaño de una nube y parecían un borrón oscuro, no hojas.
    let hojas = fbm2( vec2<f32>( p.x * 7.5 + vientoF, ( 1.0 - uvIn.y ) * 8.5 + vientoF * 0.4 ) );
    // Umbral DURO (0.50 a 0.53). Un smoothstep ancho difumina el borde
    // y es justo lo que arruinaba la silueta: el follaje a contraluz se
    // ve como recorte nítido, no como degradé.
    let borde = smoothstep( 0.500, 0.528, hojas );
    // Cuelga del borde superior y se abre hacia los costados, para
    // enmarcar sin tapar el centro de la imagen.
    // Solo el borde de arriba: extendido hasta media pantalla cruzaba
    // el cielo entero y leía como nubarrones, no como una rama cercana.
    let cuelgue = smoothstep( 0.72, 1.0, uvIn.y );
    let haciaLosLados = clamp( smoothstep( 0.12, 0.62, abs( p.x ) ) + 0.18, 0.0, 1.0 );
    let mascaraFollaje = borde * cuelgue * haciaLosLados;
    col = mix( col, vec3<f32>( 0.016, 0.042, 0.038 ), mascaraFollaje );

    // ---------- 6b. Troncos de primer plano ----------
    // Lo que más le faltaba a la escena: sin esto se ve una postal
    // MIRADA desde afuera. Tres troncos oscuros pegados a los bordes
    // alcanzan para que se sienta que la cámara está ADENTRO del
    // bosque. Van a los costados a propósito, para no taparle el sol
    // ni el centro a lo que se muestre encima del fondo.
    var tronco = 0.0;
    var filoTronco = 0.0;
    var copa = 0.0;
    for ( var i = 0; i < 3; i = i + 1 ) {
      let fi = f32( i );
      let cx = arbolDato( fi, 0.0 );
      // Inclinación propia: tres postes perfectamente verticales se ven
      // artificiales, un árbol nunca crece a plomo.
      let inclina = ( hash21( vec2<f32>( fi, 17.0 ) ) - 0.5 ) * 0.12;
      // Se mecen apenas, y más arriba que abajo: un tronco no se
      // desliza entero, se flexiona.
      let mecer = sin( t * 0.33 + fi * 2.1 ) * 0.010 * uvIn.y * uvIn.y;
      let cxx = cx + inclina * ( uvIn.y - 0.35 ) + mecer;
      // Se afina hacia la copa.
      let ancho = ( 0.028 + hash21( vec2<f32>( fi, 13.0 ) ) * 0.026 ) * ( 1.0 - uvIn.y * 0.28 );
      let dx = p.x - cxx;
      let d = abs( dx );
      let masa = smoothstep( ancho, ancho * 0.82, d );
      tronco = max( tronco, masa );
      // Luz de borde: una franja fina sobre el canto que mira al sol.
      // Es lo que saca al tronco de "mancha negra plana" y le da
      // volumen sin iluminación de verdad.
      let haciaElSol = step( 0.0, dx * select( -1.0, 1.0, solPos.x > cxx ) );
      filoTronco = max( filoTronco, masa * smoothstep( ancho * 0.70, ancho, d ) * haciaElSol );

      // COPA del árbol. Faltaba: los troncos subían rectos hasta salirse
      // del cuadro y el usuario solo veía postes, sin una sola hoja. La
      // copa cuelga desde arriba alrededor de la x del tronco, así que
      // tronco y follaje se leen como un mismo árbol.
      //
      // La forma es ruido fractal recortado contra una campana centrada
      // en el tronco: el ruido da el borde dentado de las hojas y la
      // campana hace que sea una masa redondeada y no una franja.
      let vientoCopa = sin( t * 0.62 + fi * 1.7 ) * 0.045 + sin( t * 0.37 + fi * 3.3 ) * 0.025;
      // El viento mueve MÁS las hojas de los extremos que las del
      // centro, que es donde la rama es gruesa y no cede.
      let desvio = vientoCopa * smoothstep( 0.0, 0.30, abs( dx ) );
      // Copa REDONDA, medida como distancia a un centro que está por
      // encima del borde superior del cuadro (así la copa entra en
      // escena colgando). Antes era una campana vertical y el ruido se
      // escapaba por abajo formando goterones: una copa es una masa
      // redondeada, así que hay que medirla de forma radial.
      // Misma geometría que usan las hojas instanciadas (arbolDato), o
      // quedarían flotando al lado del árbol en vez de sobre él.
      let centroCopaY = arbolDato( fi, 1.0 );
      // El 1.45 achata la copa: un círculo perfecto se ve a globo.
      let rel = vec2<f32>( p.x - cxx + desvio, ( uvIn.y - centroCopaY ) * 1.45 );
      // Un poco más chica que el disco de las hojas: la masa es la
      // sombra interior del follaje, y las hojas sobresalen del borde.
      let radio = arbolDato( fi, 2.0 ) * 0.88;
      // El ruido se le suma al RADIO, no al relleno: así dentella el
      // borde (que es lo que hace leer "hojas") sin agujerear el centro.
      let dentado = ( fbm2( vec2<f32>( ( p.x - cxx ) * 7.0 + desvio * 2.0, uvIn.y * 7.0 ) ) - 0.5 ) * 0.30;
      copa = max( copa, smoothstep( 0.012, -0.012, length( rel ) - ( radio + dentado ) ) );
    }
    col = mix( col, vec3<f32>( 0.010, 0.026, 0.024 ), tronco );
    col = col + vec3<f32>( 1.0, 0.70, 0.38 ) * filoTronco * 0.55;
    // Las hojas van DESPUÉS del tronco: una copa pasa por delante de su
    // propio tronco, no por detrás.
    col = mix( col, vec3<f32>( 0.020, 0.052, 0.040 ), copa );

    // ---------- 7. Polen ----------
    // Motas de luz subiendo despacio. Es lo que termina de dar el aire
    // de claro de bosque y cuesta una celda de hash por píxel.
    let gp = vec2<f32>( p.x * 8.0, uvIn.y * 8.0 - t * 0.06 );
    let celdaP = floor( gp );
    let hp = hash21( celdaP );
    let centroP = vec2<f32>( hash21( celdaP + 4.1 ), hash21( celdaP + 8.3 ) );
    let latido = 0.55 + 0.45 * sin( t * 1.7 + hp * 30.0 );
    let polen = smoothstep( 0.085, 0.0, length( fract( gp ) - centroP ) ) * step( 0.935, hp );
    col = col + vec3<f32>( 1.0, 0.88, 0.60 ) * polen * latido * 0.65;

    // ---------- Viñeta ----------
    // Suave: la primera versión apagaba los bordes tanto que se comía
    // el degradé del cielo.
    let d = length( vec2<f32>( ( uvIn.x - 0.5 ) * 1.1, ( uvIn.y - 0.5 ) * 1.1 ) );
    col = col * mix( 1.0, smoothstep( 1.15, 0.30, d ), 0.55 );

    // El renderer aplica tonemapping ACES, que comprime y desatura los
    // tonos altos. Un empuje de saturación acá compensa eso y es lo que
    // mantiene la paleta limpia del dibujo animado en vez de la foto.
    let gris = dot( col, vec3<f32>( 0.299, 0.587, 0.114 ) );
    col = mix( vec3<f32>( gris, gris, gris ), col, 1.42 );

    return vec4<f32>( clamp( col, vec3<f32>( 0.0 ), vec3<f32>( 4.0 ) ), 1.0 );
  }
`,
  [comoInclude(SKYLINE_WGSL), comoInclude(ARBOL_WGSL), comoInclude(FBM2_WGSL), comoInclude(FBM_WGSL), comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);

// Recorte con forma de hoja: puntiaguda en los dos extremos.
const FORMA_HOJA_WGSL = wgslFn(
  /* wgsl */ `
  fn formaHoja( coord: vec2<f32> ) -> f32 {
    let q = coord - vec2<f32>( 0.5, 0.5 );
    // El exponente 1.7 da la punta: con 2.0 sería una elipse y con 1.0
    // un rombo.
    let ancho = 0.5 * ( 1.0 - pow( abs( q.y * 2.0 ), 1.7 ) );
    return select( 0.0, 1.0, abs( q.x ) < ancho );
  }
`,
);

// Posición de cada vértice de una HOJA.
//
// El usuario dijo que los árboles "solo parecen manchas verdes", y
// tenía razón: una silueta hecha con ruido recortado es, por
// definición, una mancha. No hay forma de que una masa de ruido lea
// como follaje. Las hojas tienen que existir como hojas.
//
// Misma técnica que ya funciona con el pasto: geometría instanciada con
// el viento en el vertex shader. Cada hoja es un cuadrito con su propia
// posición dentro de la copa, su rotación y su fase de viento.
const HOJA_POS_WGSL = wgslFn(
  /* wgsl */ `
  fn hojaPos( local: vec3<f32>, idx: f32, t: f32, aspecto: f32 ) -> vec3<f32> {
    // Repartidas entre los 3 árboles.
    let arbol = idx - floor( idx / 3.0 ) * 3.0;
    let cx = arbolDato( arbol, 0.0 );
    let cy = arbolDato( arbol, 1.0 );
    let radio = arbolDato( arbol, 2.0 );

    // Punto dentro del disco de la copa. La raíz cuadrada del radio es
    // lo que reparte parejo: sin ella se amontonan todas en el centro.
    let ang = hash21( vec2<f32>( idx, 2.1 ) ) * 6.28318;
    let frac = sqrt( hash21( vec2<f32>( idx, 4.3 ) ) );
    let rad = frac * radio;
    // El 1.45 achata la copa igual que en el telón, para que las hojas
    // caigan justo sobre la masa y no alrededor.
    var px = cx + cos( ang ) * rad;
    var py = cy + sin( ang ) * rad / 1.45;

    // Viento: las hojas del borde se mueven mucho más que las del
    // centro, donde la rama es gruesa y no cede.
    let fase = hash21( vec2<f32>( idx, 9.7 ) ) * 6.28318;
    let viento = ( sin( t * 0.60 + fase + px * 4.0 ) * 0.55 + sin( t * 1.05 + fase * 2.0 ) * 0.28 )
      * 0.022 * ( 0.25 + frac );
    px = px + viento;
    py = py + viento * 0.35;

    // La hoja es un cuadrito rotado. La rotación también se mueve con
    // el viento: una hoja real se da vuelta, no solo se desplaza.
    // Chicas a propósito: grandes se leen como confeti, no como hojas.
    let tam = 0.0055 + hash21( vec2<f32>( idx, 13.1 ) ) * 0.0045;
    let giro = hash21( vec2<f32>( idx, 17.9 ) ) * 6.28318 + viento * 9.0;
    let co = cos( giro );
    let si = sin( giro );
    let lx = local.x * tam * 2.0;
    let ly = local.y * tam * 1.2;
    let rx = lx * co - ly * si;
    let ry = lx * si + ly * co;

    // px está en espacio corregido por aspecto (como el telón) y el
    // plano va de -0.5 a 0.5, así que se divide para volver a local.
    // Sin esta división las hojas saldrían ovaladas en pantallas anchas.
    return vec3<f32>( ( px + rx ) / aspecto, py - 0.5 + ry, 0.0 );
  }
`,
  [comoInclude(ARBOL_WGSL), comoInclude(HASH_WGSL)],
);

// Tono de cada hoja: casi todas en sombra, unas pocas encendidas por el
// sol que se cuela entre el follaje.
const TONO_HOJA_WGSL = wgslFn(
  /* wgsl */ `
  fn tonoHoja( idx: f32 ) -> f32 {
    let h = hash21( vec2<f32>( idx, 27.7 ) );
    return h * h * h;
  }
`,
  [comoInclude(HASH_WGSL)],
);

// Posición de cada vértice de una brizna de pasto.
//
// Esto corre en el VERTEX shader, una vez por vértice (6 vértices por
// brizna), no por píxel. Por eso miles de briznas no cuestan
// prácticamente nada: es exactamente como lo resuelven los juegos, y
// es lo que da el movimiento fluido que pidió el usuario sin pagarlo
// en latencia.
const BRIZNA_POS_WGSL = wgslFn(
  /* wgsl */ `
  fn briznaPos( local: vec3<f32>, idx: f32, t: f32 ) -> vec3<f32> {
    let h1 = hash21( vec2<f32>( idx, 1.7 ) );
    let h2 = hash21( vec2<f32>( idx, 5.3 ) );
    let h3 = hash21( vec2<f32>( idx, 9.1 ) );

    // "prof" reparte las briznas en profundidad: 0 es el fondo del
    // pastizal (arriba y chiquito), 1 es el borde inferior de la
    // pantalla (abajo y grande). Se eleva al cuadrado para amontonar
    // más briznas cerca del horizonte, que es como se ve un pastizal
    // en perspectiva.
    let prof = h2 * h2;

    let x = ( h1 - 0.5 ) * 1.04;
    let baseY = mix( -0.38, -0.54, prof );
    let altura = mix( 0.05, 0.18, prof ) * ( 0.6 + 0.8 * h3 );

    // La geometría del plano va de -0.5 a 0.5; "a" es 0 en la base de
    // la brizna y 1 en la punta.
    let a = local.y + 0.5;

    // Viento: dos ondas que VIAJAN a lo largo de x (por el término
    // x * k dentro del seno), más la fase propia de cada brizna. Sin
    // ese desfase por brizna el pastizal se mueve en bloque, como una
    // alfombra, en vez de ondular.
    // Más lento que antes (era 1.15 / 0.63). A 30 FPS la brizna
    // avanzaba un tramo visible entre cuadro y cuadro y eso es lo que
    // se leía como tirón: no faltaban cuadros, sobraba velocidad.
    let viento = sin( t * 0.72 + x * 5.2 + h1 * 6.28 ) * 0.55
      + sin( t * 0.41 + x * 11.0 + h3 * 6.28 ) * 0.28;
    // El doblez va con a*a: la base queda clavada en el suelo y solo
    // la punta se mueve. Con un doblez lineal las briznas se deslizan
    // enteras y parecen flotar.
    let doblez = viento * a * a * mix( 0.012, 0.045, prof );

    // La brizna se afina hacia la punta. Más ancha que en la primera
    // versión: una brizna de 3 px es un triángulo-astilla, y la GPU
    // sombrea en bloques de 2x2 píxeles, así que la mayoría de los
    // carriles se desperdiciaban. Pocas briznas anchas rinden mucho
    // más que muchas finitas, y a esta escala se ven igual.
    let ancho = mix( 0.0026, 0.0072, prof ) * ( 1.0 - a * 0.85 );

    // La profundidad va en z: así las briznas de adelante tapan a las
    // de atrás en el orden correcto Y el test de profundidad puede
    // descartar temprano los píxeles ocultos, que es de donde salía
    // casi todo el costo (el pastizal se pintaba varias veces encima
    // de sí mismo).
    return vec3<f32>( x + local.x * ancho * 2.0 + doblez, baseY + a * altura, prof * 0.6 );
  }
`,
  [comoInclude(HASH_WGSL)],
);

// Tono de cada brizna, 0 a 1. Va aparte de briznaPos() porque se
// consume como varying hacia el fragment shader.
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

const PROFUNDIDAD_PLANO = -80;
const BRIZNAS = 1400;
const HOJAS = 6500;

export function crearEscenaBosqueElfico(scene: THREE.Scene): Promise<ResultadoEscena> {
  // Valor inicial cualquiera: lo corrige el primer alRedimensionar(),
  // que corre antes del primer frame dibujado.
  const aspectoUniform = uniform(16 / 9);

  // depthTest apagado + renderOrder explícito: three ordena los objetos
  // OPACOS de adelante hacia atrás (para aprovechar el early-z), así que
  // el pastizal, que está más cerca de la cámara, se dibujaba ANTES que
  // el telón de fondo y este último, al ser una pantalla completa, lo
  // tapaba entero. Con el orden fijado a mano se pinta como un
  // compositor: fondo primero, pasto encima.
  const mat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: false, depthTest: false });
  const color = BOSQUE_WGSL({ uvIn: uv(), t: time, aspecto: aspectoUniform });
  // wgslFn tipa su retorno como el Node genérico; acá sabemos que la
  // función devuelve vec4<f32> (ver su firma).
  mat.colorNode = color as typeof mat.colorNode;

  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plano.position.set(0, 0, PROFUNDIDAD_PLANO);
  plano.renderOrder = 0;
  scene.add(plano);

  // ---------- Pastizal ----------
  // 5 segmentos de alto para que la brizna se CURVE al doblarse; con un
  // solo segmento se inclinaría recta, como un palito.
  const geoBrizna = new THREE.PlaneGeometry(1, 1, 1, 5);
  // A diferencia del telón de fondo, el pastizal SÍ usa profundidad: es
  // lo que deja que la GPU descarte los píxeles de las briznas tapadas
  // por otras antes de sombrearlos. El telón no escribe profundidad, así
  // que no interfiere, y el renderOrder garantiza que se pinte primero.
  const matPasto = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });
  matPasto.positionNode = BRIZNA_POS_WGSL({
    local: positionLocal,
    idx: instanceIndex.toFloat(),
    t: time,
  }) as typeof matPasto.positionNode;

  // Tono propio de cada brizna. varying() obliga a calcularlo en el
  // vertex shader (una vez por brizna) y lo interpola hasta el
  // fragment: sin esto no hay forma de que el fragment sepa QUÉ brizna
  // está pintando, y todo el pastizal sale de un color plano.
  // El cast: wgslFn no tipa su retorno, así que varying() hereda
  // "unknown". Acá sabemos que tonoBrizna() devuelve f32 (ver su firma).
  const tonoBrizna = varying(TONO_BRIZNA_WGSL({ idx: instanceIndex.toFloat() })) as unknown as ReturnType<
    typeof float
  >;

  // Está a contraluz: el sol se pone detrás del bosque, así que la
  // brizna es casi silueta en la base y solo la punta recibe luz
  // cálida. La primera versión era verde brillante parejo y se veía
  // como una capa pegada encima, no como parte de la escena.
  const alturaBrizna = uv().y;
  matPasto.colorNode = mix(
    vec3(0.014, 0.040, 0.034),
    mix(vec3(0.10, 0.20, 0.09), vec3(0.46, 0.42, 0.15), tonoBrizna),
    alturaBrizna.mul(alturaBrizna),
  ) as typeof matPasto.colorNode;

  // ---------- Hojas ----------
  const matHoja = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });
  // El recorte con forma de hoja. Sin esto cada hoja es un cuadrado, y
  // a pantalla completa el follaje se lee como confeti -- fue
  // exactamente lo que marcó el usuario. alphaTest descarta lo de
  // afuera sin activar transparencia, así que no hay orden que
  // resolver.
  matHoja.alphaTest = 0.5;
  matHoja.opacityNode = FORMA_HOJA_WGSL({ coord: uv() }) as typeof matHoja.opacityNode;
  matHoja.positionNode = HOJA_POS_WGSL({
    local: positionLocal,
    idx: instanceIndex.toFloat(),
    t: time,
    aspecto: aspectoUniform,
  }) as typeof matHoja.positionNode;

  const tonoHoja = varying(TONO_HOJA_WGSL({ idx: instanceIndex.toFloat() })) as unknown as ReturnType<typeof float>;
  // Casi todas en sombra; unas pocas encendidas donde el sol se cuela
  // entre el follaje. Ese contraste es lo que hace que una copa se lea
  // como miles de hojas y no como una mancha plana.
  matHoja.colorNode = mix(
    vec3(0.028, 0.072, 0.050),
    vec3(0.24, 0.30, 0.11),
    tonoHoja,
  ) as typeof matHoja.colorNode;

  const hojas = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), matHoja, HOJAS);
  hojas.frustumCulled = false;
  hojas.position.set(0, 0, PROFUNDIDAD_PLANO + 2);
  hojas.renderOrder = 2;
  scene.add(hojas);

  const pasto = new THREE.InstancedMesh(geoBrizna, matPasto, BRIZNAS);
  // Las posiciones salen del shader a partir de instanceIndex, así que
  // las matrices por instancia no se usan: se deja la identidad y se
  // evita subir 2600 matrices a la GPU.
  pasto.frustumCulled = false;
  pasto.position.set(0, 0, PROFUNDIDAD_PLANO + 1);
  pasto.renderOrder = 1;
  scene.add(pasto);

  return Promise.resolve({
    updater: () => {
      // Todo el movimiento lo lleva el uniform "time" dentro del
      // shader, así que no hay nada que actualizar por frame desde la
      // CPU -- ni un solo cálculo de JavaScript por cuadro.
    },
    alRedimensionar: (camera) => {
      aspectoUniform.value = camera.aspect;
      const distancia = camera.position.z - plano.position.z;
      const alturaVisible = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const anchoVisible = alturaVisible * camera.aspect;
      plano.scale.set(anchoVisible * 1.02, alturaVisible * 1.02, 1);
      // El pastizal usa el mismo encuadre: así las coordenadas
      // normalizadas que devuelve briznaPos() (de -0.5 a 0.5) caen
      // justo sobre la pantalla, sea cual sea el tamaño.
      const distanciaPasto = camera.position.z - pasto.position.z;
      const altoPasto = 2 * distanciaPasto * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      pasto.scale.set(altoPasto * camera.aspect, altoPasto, 1);
      const distanciaHojas = camera.position.z - hojas.position.z;
      const altoHojas = 2 * distanciaHojas * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      hojas.scale.set(altoHojas * camera.aspect, altoHojas, 1);
    },
  });
}
