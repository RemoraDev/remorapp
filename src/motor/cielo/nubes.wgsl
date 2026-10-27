// ---------- Nubes volumétricas por capas ----------
//
// ESTE ARCHIVO NO ES WGSL AUTÓNOMO: se concatena después de
// atmosfera.wgsl en un único módulo. Reusa de ahí el struct Comun, las
// tablas de transmitancia y dispersión múltiple, interseccionEsfera,
// direccionCamara y direccionAUv. Separarlo en dos módulos obligaría a
// duplicar todo eso, y duplicar el encuadre de cámara es exactamente
// cómo las nubes terminarían corridas respecto del cielo.
//
// Se renderiza a MEDIA RESOLUCIÓN en su propia textura. Una capa de
// nubes es de baja frecuencia: a media resolución con upsample bilineal
// no se distingue, y cuesta la cuarta parte. El disco del sol y el de
// la luna se dibujan a resolución completa en la composición, así que
// lo que sí necesita filo lo conserva.

// Volúmenes horneados al arrancar (ver volumenes.wgsl).
@group(1) @binding(0) var muestreadorVol: sampler;
@group(1) @binding(1) var volForma: texture_3d<f32>;
@group(1) @binding(2) var volDetalle: texture_3d<f32>;

// Altura de la capa de cúmulos, en km sobre el suelo. Base plana a
// 1,5 km y techo a 4,2: es el rango real de un cúmulo de buen tiempo, y
// respetarlo es lo que da la escala correcta contra el horizonte.
const NUBE_BASE: f32 = 1.5;
const NUBE_TECHO: f32 = 4.2;
// Un volumen cubre 7 km: con 4 células de Worley, los bultos grandes
// quedan de ~1,7 km, que es el tamaño de un cúmulo.
const NUBE_ESCALA: f32 = 7.0;
// Coeficiente de extinción por km. Las nubes son ÓPTICAMENTE MUY
// ESPESAS: con valores tímidos (1 o 2) se ven como niebla y nunca como
// algodón. 42 es lo que hace que el centro de la nube sea opaco y el
// borde translúcido, que es el contraste que el ojo lee como volumen.
const NUBE_EXTINCION: f32 = 42.0;
// Más allá de esto no se marcha. Mirando casi al horizonte la capa se
// extiende cientos de km y seguirla sería gastar pasos en algo que la
// perspectiva aérea ya borró.
const NUBE_ALCANCE: f32 = 55.0;

fn reasignarNube( v: f32, a0: f32, a1: f32, b0: f32, b1: f32 ) -> f32 {
  return b0 + ( v - a0 ) / max( a1 - a0, 1e-5 ) * ( b1 - b0 );
}

// Distancias entre las que se desvanece la octava de erosion. Mas alla
// de la segunda, un rasgo de esa octava mide menos que un pixel: no se
// lee como detalle sino como ruido, y ademas cuesta una lectura de
// textura por muestra. Apagarlo limpia la franja del horizonte Y es mas
// barato, que es la combinacion que uno rara vez consigue.
//
// Se desvanece en vez de cortarse de golpe: un corte duro deja una
// costura visible a esa distancia exacta, con estrias donde las nubes
// pasan de erosionadas a lisas de un pixel al otro.
const NUBE_DETALLE_CERCA: f32 = 7.0;
const NUBE_DETALLE_LEJOS: f32 = 16.0;

// Densidad de la nube en un punto.
//
// `detalle` pesa la octava de erosion, de 0 (sin ella) a 1 (completa).
// En 0 se salta la lectura entera: se usa en la marcha hacia la luz,
// donde el detalle fino no cambia el resultado visible pero si
// duplicaria el costo de la parte mas caliente del shader, y en los
// tramos lejanos del rayo.
fn densidadNube( pos: vec3<f32>, detalle: f32 ) -> f32 {
  let alt = length( pos ) - RADIO_SUELO;
  let h = ( alt - NUBE_BASE ) / ( NUBE_TECHO - NUBE_BASE );
  if ( h < 0.0 || h > 1.0 ) { return 0.0; }

  let t = comun.camara.w;
  // El viento arrastra la capa entera. La componente vertical mínima
  // hace que la nube además EVOLUCIONE al desplazarse, en vez de
  // deslizarse rígida como una calcomanía -- que es el defecto más
  // delator de una nube procedural animada.
  let viento = vec3<f32>( 1.0, 0.08, 0.22 ) * ( comun.nubes.z * t );
  let uvw = ( pos + viento ) / NUBE_ESCALA;

  let forma = textureSampleLevel( volForma, muestreadorVol, uvw, 0.0 );
  let fbm = forma.g * 0.625 + forma.b * 0.25 + forma.a * 0.125;
  // El fbm de Worley EROSIONA el campo, no lo dilata.
  //
  // La receta clásica usa reasignar(forma.r, fbm - 1, 1, 0, 1), que
  // SUMA (1 - fbm) y por lo tanto empuja todo hacia arriba. Medido:
  // deja el campo en 0.68 +- 0.164 y con cobertura 0.5 el 86 % del
  // cielo pasa el umbral, o sea cubierto casi siempre. Multiplicando el
  // fbm en vez de restarlo, el mismo campo queda en 0.37 +- 0.287 y la
  // cobertura responde de verdad: 0.35 cubre el 19 %, 0.5 el 34 % y
  // 0.65 el 51 %. Esa curva es la que hace util el control.
  var base = clamp( reasignarNube( forma.r, fbm * 0.55, 1.0, 0.0, 1.0 ), 0.0, 1.0 );

  // Gradientes de altura: lo que convierte una masa de ruido en un
  // cúmulo. Abajo se corta rápido (base PLANA, donde condensa el vapor)
  // y arriba se desvanece despacio (la coliflor que se deshilacha).
  let piso = clamp( reasignarNube( h, 0.0, 0.08, 0.0, 1.0 ), 0.0, 1.0 );
  let techo = clamp( reasignarNube( h, 0.45, 1.0, 1.0, 0.0 ), 0.0, 1.0 );
  base = base * piso * techo * techo;

  // Campo de clima a escala de decenas de km, tomado del mismo volumen
  // (que es tileable, así que no deja costura). Sin esto la cobertura
  // es pareja en todo el cielo y se ve como un patrón; con esto hay
  // bancos de nubes y claros de cielo azul entre ellos.
  let clima = textureSampleLevel( volForma, muestreadorVol,
    vec3<f32>( ( pos.xz + viento.xz * 0.35 ) / 90.0, 0.37 ), 0.0 ).r;
  let cobertura = clamp( comun.nubes.x * ( 0.45 + 1.15 * clima ), 0.0, 1.0 );
  base = clamp( reasignarNube( base, 1.0 - cobertura, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
  if ( base <= 0.001 ) { return 0.0; }

  if ( detalle > 0.01 ) {
    let det = textureSampleLevel( volDetalle, muestreadorVol,
      uvw * 9.0 + vec3<f32>( 0.0, viento.y * 1.5, 0.0 ), 0.0 ).rgb;
    let detFbm = det.r * 0.625 + det.g * 0.25 + det.b * 0.125;
    // Abajo se erosiona con filamentos (mezcla invertida) y arriba con
    // bultos: así la base queda deshilachada y el tope abollonado, que
    // es cómo se ve un cúmulo de verdad.
    let erosion = mix( 1.0 - detFbm, detFbm, clamp( h * 4.0, 0.0, 1.0 ) );
    let comido = clamp( reasignarNube( base, erosion * 0.42, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
    base = mix( base, comido, detalle );
  }

  return base * comun.nubes.y;
}

// Ruido entrelazado de gradiente (Jimenez). Reparte el desfase de
// arranque de los rayos mucho mejor que fract(sin(dot(...))): el ruido
// blanco deja grumos de pixeles vecinos con el mismo desfase, y a media
// resolucion esos grumos se agrandan al escalar y se leen como grano
// sucio. Este patron no tiene dos vecinos iguales.
fn ruidoEntrelazado( p: vec2<f32> ) -> f32 {
  return fract( 52.9829189 * fract( dot( p, vec2<f32>( 0.06711056, 0.00583715 ) ) ) );
}

// Henyey-Greenstein: la fase de una gota de agua.
fn hg( c: f32, g: f32 ) -> f32 {
  let g2 = g * g;
  return ( 1.0 - g2 ) / ( 12.5663706 * pow( max( 1.0 + g2 - 2.0 * g * c, 1e-4 ), 1.5 ) );
}

// Marcha hacia la luz: el AUTO-SOMBREADO. Pasos que crecen en
// progresión geométrica, porque lo que oscurece un punto es sobre todo
// la nube que tiene justo encima; lo lejano aporta poco y no merece
// resolución.
fn transLuzNube( pos: vec3<f32>, dirLuz: vec3<f32> ) -> f32 {
  var dens = 0.0;
  var t = 0.0;
  var dt = 0.07;
  for ( var i = 0; i < 6; i = i + 1 ) {
    dens = dens + densidadNube( pos + dirLuz * ( t + dt * 0.5 ), 0.0 ) * dt;
    t = t + dt;
    dt = dt * 1.78;
  }
  return exp( -dens * NUBE_EXTINCION );
}

// Dispersión con APROXIMACIÓN DE ÓRDENES MÚLTIPLES (Wrenninge et al.).
//
// Esto es lo que separa una nube creíble de una nube de cartón. Con
// dispersión simple, todo lo que la luz no alcanza directo queda negro,
// y una nube real tiene el interior LUMINOSO: la luz rebota miles de
// veces entre las gotas. Se suman tres órdenes, cada uno con menos
// energía (b^n), menos extinción (a^n, por eso penetra más hondo) y
// fase más isótropa (c^n, porque cada rebote olvida la dirección).
// Son tres potencias sobre una transmitancia ya calculada: cuesta
// casi nada y cambia por completo la lectura del volumen.
fn dispersionNube( cosLuz: f32, tl: f32, dens: f32 ) -> f32 {
  var s = 0.0;
  var an = 1.0;
  var bn = 1.0;
  var cn = 1.0;
  for ( var n = 0; n < 3; n = n + 1 ) {
    // Doble lóbulo: uno hacia adelante muy marcado (g = 0.78) y uno
    // hacia atrás suave. El lóbulo frontal ES el borde plateado:
    // cuando la luz está DETRÁS de la nube, el contorno se enciende.
    let f = mix( hg( cosLuz, 0.78 * cn ), hg( cosLuz, -0.28 * cn ), 0.42 );
    s = s + bn * f * pow( max( tl, 1e-4 ), an );
    an = an * 0.52;
    bn = bn * 0.56;
    cn = cn * 0.60;
  }
  // Efecto "polvo": los bordes poco densos del lado iluminado se ven
  // más oscuros de lo que la ley de Beer predice, porque ahí falta
  // material para retrodispersar. Es el detalle que da la textura de
  // azúcar al tope de un cúmulo.
  let polvo = 1.0 - exp( -dens * 3.2 );
  return s * mix( 1.0, polvo, 0.58 );
}

// Aporte de una fuente de luz en un punto de la nube.
fn luzEnNube( pos: vec3<f32>, dir: vec3<f32>, dirLuz: vec3<f32>,
              color: vec3<f32>, dens: f32, altura: f32 ) -> vec3<f32> {
  // La misma atmósfera que enrojece el sol al atardecer atenúa la luz
  // que llega a la nube. De acá salen gratis los bajos anaranjados del
  // crepúsculo: no hay ningún color pintado a mano.
  let atm = transmitancia( altura, dirLuz.y );
  let tl = transLuzNube( pos, dirLuz );
  return color * atm * dispersionNube( dot( dir, dirLuz ), tl, dens );
}

@fragment
fn fsNubes( e: SalidaVert ) -> @location(0) vec4<f32> {
  // MODO DEPURACIÓN: nubes.w > 0 pinta una rebanada del volumen
  // horneado directo en pantalla, con alfa 0 para que tape el cielo.
  // Sirve para contestar de una la pregunta que importa cuando la capa
  // sale mal: ¿el ruido está mal, o está bien y lo mal usado es el
  // raymarch? Sin esto se diagnostica a ciegas.
  if ( comun.nubes.w > 0.001 ) {
    let z = comun.nubes.w - 1.0;
    let f = textureSampleLevel( volForma, muestreadorVol, vec3<f32>( e.uv * 2.0, z ), 0.0 );
    let d = textureSampleLevel( volDetalle, muestreadorVol, vec3<f32>( e.uv * 2.0, z ), 0.0 );
    // Mitad izquierda: forma (r = Perlin-Worley, g = Worley 4).
    // Mitad derecha: detalle.
    let v = select( vec3<f32>( f.r, f.g, f.a ), d.rgb, e.uv.x > 0.5 );
    return vec4<f32>( v, 0.0 );
  }

  let dir = direccionCamara( e.uv );
  let origen = vec3<f32>( 0.0, comun.camara.y, 0.0 );

  let rBase = RADIO_SUELO + NUBE_BASE;
  let rTecho = RADIO_SUELO + NUBE_TECHO;
  // La cámara está a 1 km, debajo de la base: desde dentro de la esfera
  // la intersección devuelve la salida, que es justo donde se entra a
  // la capa.
  let tEntra = interseccionEsfera( origen, dir, rBase );
  let tSale = interseccionEsfera( origen, dir, rTecho );
  let suelo = interseccionEsfera( origen, dir, RADIO_SUELO );
  // Mirando hacia abajo se pisa el suelo antes de llegar a la capa.
  if ( tEntra <= 0.0 || tSale <= tEntra || ( suelo > 0.0 && suelo < tEntra ) ) {
    return vec4<f32>( 0.0, 0.0, 0.0, 1.0 );
  }

  let largo = min( tSale - tEntra, NUBE_ALCANCE );

  // Luz ambiente del propio cielo. La base recibe el color del
  // horizonte y el tope el del cenit: ese degradé es lo que asienta la
  // nube dentro de la escena en vez de dejarla flotando.
  let ambCenit = textureSampleLevel( lutVista, muestreador,
    direccionAUv( vec3<f32>( 0.0, 1.0, 0.0 ) ), 0.0 ).rgb;
  let ambHoriz = textureSampleLevel( lutVista, muestreador,
    direccionAUv( normalize( vec3<f32>( dir.x, 0.06, dir.z ) ) ), 0.0 ).rgb;

  let dirSol = normalize( comun.sol.xyz );
  let dirLuna = normalize( comun.luna.xyz );
  let haySol = comun.sol.w > 0.0005 && dirSol.y > -0.35;
  let hayLuna = comun.luna.w > 0.0005 && dirLuna.y > -0.12;

  // MARCHA DE DOS VELOCIDADES.
  //
  // Recorrer todo el rayo con el paso fino es tirar el presupuesto: la
  // mayor parte del recorrido es aire vacio, y ahi cada muestra cuesta
  // igual que dentro de una nube. Primero se avanza a paso largo
  // sondeando solo la forma de baja frecuencia (una lectura de textura,
  // sin la octava de detalle); al primer sondeo positivo se cambia a
  // paso fino con el detalle puesto.
  //
  // Por que el sondeo barato no puede perderse una nube: la octava de
  // detalle solo RESTA densidad, nunca la suma. Si la version sin
  // detalle da cero, la completa tambien.
  //
  // Los pasos se acotan en kilometros y no como fraccion del recorrido:
  // mirando al horizonte el rayo cruza decenas de km y largo/40 daria
  // pasos mas gruesos que el espesor entero de la capa.
  //
  // AL DETECTAR NUBE SE RETROCEDE UN PASO, PERO NUNCA POR DEBAJO DE LO
  // YA INTEGRADO.
  //
  // Dos intentos fallidos antes de esto. El primero retrocedia sin
  // tope: como el sondeo barato ignora la erosion de detalle, podia dar
  // positivo donde la densidad real es cero, y al salir del modo fino
  // volvia a dar positivo y a retroceder; el rayo quedaba haciendo
  // ping-pong sobre el mismo tramo, re-integrando la misma luz y
  // quemando las 96 iteraciones. El segundo quito el retroceso: eso
  // arreglo el bucle pero dejo el PUNTO DE ENTRADA a la nube cuantizado
  // al paso grueso, unos 95 m. Ese error entra dithereado por el ruido
  // entrelazado, y a media resolucion el patron se amplia al doble: es
  // la trama diagonal que se veia sobre el cuerpo de las nubes.
  //
  // Con el tope `tTope` se recupera el retroceso sin el ping-pong: el
  // rayo nunca vuelve antes de donde ya integro, asi que no puede
  // oscilar ni contar dos veces, y el error de entrada baja del paso
  // grueso al paso fino.
  let dtGrueso = clamp( largo / 40.0, 0.04, 1.0 );
  let dtFino = dtGrueso * 0.26;
  let jitter = ruidoEntrelazado( e.pos.xy );

  var trans = 1.0;
  var luz = vec3<f32>( 0.0 );
  var t = jitter * dtGrueso;
  var fino = false;
  var vacios = 0;
  // Punto mas lejano ya procesado en modo fino.
  var tTope = 0.0;

  for ( var i = 0; i < 96; i = i + 1 ) {
    if ( trans < 0.02 || t >= largo ) { break; }
    let pos = origen + dir * ( tEntra + t );

    if ( !fino ) {
      if ( densidadNube( pos, 0.0 ) > 0.0 ) {
        fino = true;
        vacios = 0;
        t = max( t - dtGrueso, tTope );
      } else {
        t = t + dtGrueso;
      }
      continue;
    }
    tTope = t;

    let detalle = 1.0 - smoothstep( NUBE_DETALLE_CERCA, NUBE_DETALLE_LEJOS, t );
    let dens = densidadNube( pos, detalle );
    // Paso fino de largo variable. Desfasar SOLO el arranque del rayo
    // no alcanza: a partir de ahi todos los pixeles avanzan con el
    // mismo tranco, el error de cuadratura queda correlacionado entre
    // muestras y el patron ordenado del ruido entrelazado se lee como
    // una trama diagonal sobre el cuerpo de la nube. Variando el tranco
    // en cada paso el error se descorrelaciona y lo que queda es grano
    // fino, que el filtro de cuatro muestras del upsample si borra.
    let paso_i = dtFino * ( 0.72 + 0.56 * ruidoEntrelazado( e.pos.xy + vec2<f32>( f32( i ) * 7.37 ) ) );
    if ( dens <= 0.002 ) {
      // Unos pocos vacios seguidos pueden ser un hueco interno de la
      // nube; muchos significan que ya se salio.
      vacios = vacios + 1;
      if ( vacios > 6 ) { fino = false; }
      t = t + dtFino;
      continue;
    }
    vacios = 0;

    let alt = length( pos ) - RADIO_SUELO;
    let h = clamp( ( alt - NUBE_BASE ) / ( NUBE_TECHO - NUBE_BASE ), 0.0, 1.0 );

    var aporte = vec3<f32>( 0.0 );
    if ( haySol ) {
      aporte = aporte + luzEnNube( pos, dir, dirSol, vec3<f32>( comun.sol.w ), dens, alt );
    }
    // DE NOCHE MANDA LA LUNA. Es la misma función con otra dirección y
    // otro color: la nube se ilumina de verdad por la luna, con su
    // borde plateado donde la luz pega desde atrás.
    if ( hayLuna ) {
      aporte = aporte + luzEnNube( pos, dir, dirLuna,
        comun.lunaColor.rgb * comun.luna.w, dens, alt );
    }
    // Ambiente, con oclusión por altura: el fondo de la capa ve menos
    // cielo que el tope.
    let amb = mix( ambHoriz * 0.55, ambCenit, h ) * mix( 0.35, 1.0, h );
    aporte = aporte + amb;

    // Integración analítica del segmento, igual que en la atmósfera: no
    // es (1 - paso) a secas, sino la solución exacta para densidad
    // constante en el tramo. Permite pasos largos sin que la nube se
    // oscurezca de más.
    let ext = dens * NUBE_EXTINCION;
    let paso = exp( -ext * paso_i );
    luz = luz + trans * aporte * ( 1.0 - paso );
    trans = trans * paso;
    t = t + paso_i;
  }

  // Desvanecido con la distancia: la capa no puede terminar en una
  // línea recta sobre el horizonte. Se disuelve hacia el cielo a partir
  // de los 35 km, que es más o menos donde la perspectiva aérea se
  // come una nube real.
  let fade = 1.0 - smoothstep( 22.0, NUBE_ALCANCE, tEntra );
  let cobertura = ( 1.0 - trans ) * fade;
  return vec4<f32>( luz * fade, 1.0 - cobertura );
}
