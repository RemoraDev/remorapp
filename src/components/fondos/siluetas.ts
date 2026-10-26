import { wgslFn } from "three/tsl";
import { comoInclude, FBM_WGSL, FBM2_WGSL, RUIDO_WGSL, HASH_WGSL } from "./wgslComun";

// Siluetas de terreno compartidas entre escenas.
//
// Vivía dentro de bosqueElfico.ts; se sacó acá porque una línea de
// coníferas sirve igual para un bosque nevado, para Ashenvale o para
// Northrend. Lo que cambia entre escenas son la escala, la altura y el
// color, no la forma.
//
// OJO: nada de comillas invertidas ni de dólar-llave dentro del WGSL
// (ver la nota en wgslComun.ts).

// Altura de la copa del bosque para una x dada. Devuelve la coordenada
// vertical (0..1) donde empieza el follaje de esa capa.
export const SKYLINE_WGSL = wgslFn(
  /* wgsl */ `
  fn skyline( x: f32, escala: f32, base: f32, amplitud: f32, viento: f32, t: f32 ) -> f32 {
    // Dos senos de distinto período: uno solo se nota como un vaivén
    // mecánico, dos desfasados ya leen como viento.
    let vaiven = sin( t * 0.5 + x * 2.0 ) * viento + sin( t * 0.83 + x * 4.3 ) * viento * 0.55;
    let xx = x * escala + vaiven;

    // Ondulación lenta del terreno sobre el que se apoya el bosque.
    let terreno = fbm2( vec2<f32>( xx * 0.35, 0.0 ) ) * amplitud;

    // Los árboles: un diente triangular por celda, cada uno con su
    // altura y su ancho. Con fbm solo salían LOMAS -- el ruido fractal
    // es suave por definición y nunca hace una punta. La copa de una
    // conífera es un triángulo, así que hay que dibujarlo como tal.
    let celda = floor( xx );
    let fx = fract( xx );
    let hAlto = hash21( vec2<f32>( celda, 3.7 ) );
    // Algún árbol suelto bastante más alto que el resto: una hilera de
    // alturas parejas lee como una sierra de papel, no como un bosque.
    let destacado = select( 1.0, 1.55, hAlto > 0.86 );
    let alto = ( 0.25 + 0.75 * hAlto ) * destacado;
    let ancho = 0.50 + 0.50 * hash21( vec2<f32>( celda, 9.1 ) );
    // El triángulo se estrecha con "ancho": fuera de él, altura 0, así
    // quedan huecos entre árboles en vez de una sierra continua.
    let dentro = clamp( 1.0 - abs( fx * 2.0 - 1.0 ) / ancho, 0.0, 1.0 );
    let copa = dentro * alto * amplitud * 1.6;

    // Una pizca de ruido fino sobre la copa, para que el borde no sea
    // una recta perfecta sino follaje.
    let picado = ( fbm2( vec2<f32>( xx * 7.0, 13.0 ) ) - 0.5 ) * amplitud * 0.22;

    return base + terreno + copa + picado;
  }
`,
  [comoInclude(FBM2_WGSL), comoInclude(FBM_WGSL), comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);

// Distancia de un punto a un segmento. Es el ladrillo para dibujar
// ramas, troncos retorcidos y cualquier silueta hecha de trazos: una
// rama es un segmento con grosor que se afina hacia la punta.
//
// Sirve para los árboles pelados de Halloween y de No Muertos, donde
// una silueta de ruido recortado no alcanza -- una rama tiene que
// leerse como rama, con dirección y grosor, no como una mancha.
export const SEGMENTO_WGSL = wgslFn(
  /* wgsl */ `
  fn distSegmento( p: vec2<f32>, a: vec2<f32>, b: vec2<f32> ) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp( dot( pa, ba ) / max( dot( ba, ba ), 0.00001 ), 0.0, 1.0 );
    return length( pa - ba * h );
  }
`,
);

// Un árbol pelado: tronco que se bifurca en ramas cada vez más finas.
// Devuelve la cobertura (0 a 1) en ese punto.
//
// Las ramas no son aleatorias puras: cada una sale de la anterior con
// un ángulo propio, que es lo que hace que el árbol se vea CRECIDO y
// no como palitos sueltos tirados alrededor de un tronco.
export const ARBOL_PELADO_WGSL = wgslFn(
  /* wgsl */ `
  fn arbolPelado( p: vec2<f32>, base: vec2<f32>, altura: f32, semilla: f32, viento: f32 ) -> f32 {
    var cobertura = 0.0;

    // Tronco: se inclina apenas con el viento, más arriba que abajo.
    let inclina = ( hash21( vec2<f32>( semilla, 2.0 ) ) - 0.5 ) * 0.18;
    let copaX = base.x + inclina * altura + viento * 0.6;
    let copaY = base.y + altura;
    let grosorTronco = altura * 0.085;
    let dT = distSegmento( p, base, vec2<f32>( copaX, copaY ) );
    // El grosor cae con la altura: un tronco es más ancho abajo.
    let alturaRel = clamp( ( p.y - base.y ) / max( altura, 0.0001 ), 0.0, 1.0 );
    cobertura = max( cobertura, smoothstep( grosorTronco * ( 1.0 - alturaRel * 0.6 ), 0.0, dT ) );

    // Ramas: salen del tramo alto del tronco, alternando de lado.
    for ( var i = 0; i < 7; i = i + 1 ) {
      let fi = f32( i );
      let s = semilla * 7.0 + fi;
      // Arrancan entre el 45% y el 95% de la altura.
      let dondeNace = 0.45 + 0.5 * hash21( vec2<f32>( s, 11.0 ) );
      let nx = base.x + inclina * altura * dondeNace + viento * 0.6 * dondeNace;
      let ny = base.y + altura * dondeNace;
      // Lado alternado más una variación propia: así no quedan todas
      // las ramas para el mismo lado.
      let lado = select( -1.0, 1.0, ( fi - floor( fi / 2.0 ) * 2.0 ) > 0.5 );
      let largo = altura * ( 0.20 + 0.26 * hash21( vec2<f32>( s, 17.0 ) ) );
      let abre = 0.55 + 0.75 * hash21( vec2<f32>( s, 23.0 ) );
      // Las puntas se mueven bastante más que el tronco.
      let fx = nx + lado * largo * abre + viento * 2.2 * dondeNace;
      let fy = ny + largo * ( 0.55 + 0.45 * hash21( vec2<f32>( s, 29.0 ) ) );
      let dR = distSegmento( p, vec2<f32>( nx, ny ), vec2<f32>( fx, fy ) );
      cobertura = max( cobertura, smoothstep( grosorTronco * 0.50, 0.0, dR ) );

      // Una rama sobre la rama. Es lo que separa un árbol retorcido de
      // unos palitos clavados en un palo: la silueta se vuelve
      // irregular y recursiva, como la de un árbol de verdad.
      let gx = fx + lado * largo * 0.45 * hash21( vec2<f32>( s, 37.0 ) ) + viento * 3.0 * dondeNace;
      let gy = fy + largo * 0.42 * hash21( vec2<f32>( s, 41.0 ) );
      let dG = distSegmento( p, vec2<f32>( fx, fy ), vec2<f32>( gx, gy ) );
      cobertura = max( cobertura, smoothstep( grosorTronco * 0.26, 0.0, dG ) );
    }

    return cobertura;
  }
`,
  [comoInclude(SEGMENTO_WGSL), comoInclude(HASH_WGSL)],
);

// Un pino, devuelto como vec3: ( cobertura, luz, nieve ).
//
// La primera versión eran triángulos planos apilados y el usuario dijo
// que "no parecen reales". Le faltaban tres cosas, y ninguna es
// detalle:
//
//   1. VOLUMEN. Un pino es cónico, así que cada piso tiene un lado
//      iluminado y otro en sombra. Sin ese degradé es una chapa.
//   2. IRREGULARIDAD. Los pisos iguales y centrados leen como un
//      adorno de cartón; en un árbol real cada rama sale distinta.
//   3. CAÍDA. Las ramas de un pino caen hacia abajo en los extremos,
//      no son horizontales.
export const PINO_WGSL = wgslFn(
  /* wgsl */ `
  fn pino( p: vec2<f32>, base: vec2<f32>, altura: f32, semilla: f32, viento: f32 ) -> vec3<f32> {
    var cobertura = 0.0;
    var luz = 0.0;
    var nieve = 0.0;

    // Tronco, apenas visible bajo el primer piso.
    let anchoTronco = altura * 0.022;
    if ( abs( p.x - base.x ) < anchoTronco && p.y > base.y && p.y < base.y + altura * 0.26 ) {
      cobertura = 1.0;
      luz = 0.30;
    }

    for ( var k = 0; k < 5; k = k + 1 ) {
      let fk = f32( k );
      let s = semilla * 13.0 + fk;
      // Los pisos se solapan: sin solape se ven los escalones y el
      // árbol parece una torre de conos sueltos.
      let yBase = base.y + altura * ( 0.13 + fk * 0.175 );
      let yTope = yBase + altura * 0.30;
      // Cada piso con su propio ancho y su propio desvío lateral.
      let anchoPiso = altura * ( 0.30 - fk * 0.048 ) * ( 0.86 + hash21( vec2<f32>( s, 3.0 ) ) * 0.28 );
      let desvio = ( hash21( vec2<f32>( s, 7.0 ) ) - 0.5 ) * altura * 0.030;
      // El viento mueve más la copa que la base.
      let cx = base.x + desvio + viento * ( yBase - base.y ) / max( altura, 0.0001 );

      if ( p.y >= yBase && p.y <= yTope ) {
        let rel = ( p.y - yBase ) / ( yTope - yBase );
        // La rama CAE: el borde baja hacia afuera en vez de ir recto.
        // Es lo que separa un pino de un triángulo.
        let medio = anchoPiso * ( 1.0 - rel );
        let caida = pow( clamp( abs( p.x - cx ) / max( medio, 0.0001 ), 0.0, 1.0 ), 2.0 ) * altura * 0.055;
        if ( abs( p.x - cx ) < medio && p.y + caida <= yTope ) {
          cobertura = 1.0;
          // Volumen cónico: el sol entra desde la izquierda.
          let n = ( p.x - cx ) / max( medio, 0.0001 );
          luz = clamp( 0.26 + 0.74 * ( 0.5 - n * 0.55 ), 0.10, 1.0 );
          // La nieve se posa en el borde de ARRIBA de cada piso, con
          // borde irregular -- la nieve no se acumula en línea recta.
          let bordeNieve = 0.62 + ( hash21( vec2<f32>( floor( p.x * 240.0 ), s ) ) - 0.5 ) * 0.22;
          nieve = smoothstep( bordeNieve, bordeNieve + 0.16, rel );
        }
      }
    }

    return vec3<f32>( cobertura, luz, nieve );
  }
`,
  [comoInclude(HASH_WGSL)],
);
