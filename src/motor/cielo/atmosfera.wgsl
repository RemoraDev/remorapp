// Cielo físico por el método de Hillaire (2020).
//
// La idea: en vez de integrar la dispersión atmosférica por píxel y por
// cuadro --que es carísimo-- se precalculan TRES tablas y después cada
// píxel solo las consulta.
//
//   1. TRANSMITANCIA (256x64). Cuánta luz sobrevive al atravesar la
//      atmósfera, para cada altura y cada ángulo del sol. Se calcula
//      una sola vez: no depende de la cámara ni de la hora.
//
//   2. DISPERSIÓN MÚLTIPLE (32x32). La luz que rebota más de una vez.
//      Es lo que hace que el cielo tenga color en el horizonte y que la
//      sombra no sea negra. Sin esto el cielo se ve "duro" y plano.
//
//   3. VISTA DEL CIELO (192x108). El resultado final por dirección de
//      mirada. Depende del sol y de la altura de la cámara, así que se
//      recalcula cuando esos cambian, no por píxel.
//
// Las constantes son terrestres y están en kilómetros.

// ---------- Constantes de la atmósfera ----------
const RADIO_SUELO: f32 = 6360.0;
const RADIO_CIELO: f32 = 6460.0;

// Rayleigh: la dispersión de las moléculas de aire. Es mucho más fuerte
// en azul que en rojo, y por eso el cielo es azul y los atardeceres
// rojos (al rasar, el azul ya se dispersó todo por el camino).
const RAYLEIGH_DISPERSION = vec3<f32>( 5.802e-3, 13.558e-3, 33.1e-3 );
const RAYLEIGH_ALTURA: f32 = 8.0;

// Mie: partículas grandes (polvo, aerosoles). Casi no distingue color y
// dispersa muy hacia adelante, de ahí el halo alrededor del sol.
const MIE_DISPERSION: f32 = 3.996e-3;
const MIE_ABSORCION: f32 = 4.4e-3;
const MIE_ALTURA: f32 = 1.2;

// Ozono: no dispersa, solo ABSORBE, y en una capa a unos 25 km. Es el
// responsable del azul profundo del cenit al atardecer; sin él el cielo
// se va a un amarillo sucio.
const OZONO_ABSORCION = vec3<f32>( 0.650e-3, 1.881e-3, 0.085e-3 );
const OZONO_CENTRO: f32 = 25.0;
const OZONO_ANCHO: f32 = 15.0;

struct Comun {
  // xyz: dirección hacia el sol (normalizada). w: intensidad.
  sol: vec4<f32>,
  // LA LUNA ES UNA LUZ DEL MOTOR, no un disco dibujado.
  // xyz: dirección hacia la luna (normalizada). w: intensidad radiante,
  // ya escalada por la fase desde la CPU.
  luna: vec4<f32>,
  // rgb: color de la luz lunar (levemente frío). w: fase, 0 = luna
  // nueva, 1 = llena. La fase se usa acá solo para tallar el
  // terminador del disco; su efecto sobre la INTENSIDAD ya viene
  // aplicado en luna.w.
  lunaColor: vec4<f32>,
  // xyz: posición de la cámara en km desde el centro del planeta.
  // w: tiempo en segundos.
  camara: vec4<f32>,
  // x: ancho, y: alto, z: aspecto, w: exposición.
  pantalla: vec4<f32>,
  // x: cobertura 0..1, y: densidad, z: velocidad de viento, w: altura
  // relativa de la capa.
  nubes: vec4<f32>,
};

@group(0) @binding(0) var<uniform> comun: Comun;
@group(0) @binding(1) var muestreador: sampler;
@group(0) @binding(2) var lutTransmitancia: texture_2d<f32>;
@group(0) @binding(3) var lutMultiple: texture_2d<f32>;
@group(0) @binding(4) var lutVista: texture_2d<f32>;
// Capa de nubes resuelta en una pasada aparte y a media resolución.
// rgb: luz dispersada por la nube. a: transmitancia (1 = cielo limpio).
@group(0) @binding(5) var texNubes: texture_2d<f32>;

// ---------- Vértice común ----------
// Triángulo que cubre la pantalla, generado sin buffer: tres vértices
// que se salen del cuadro. Es más barato que un quad porque evita la
// costura diagonal donde se tocan dos triángulos.
struct SalidaVert {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsPantalla( @builtin(vertex_index) i: u32 ) -> SalidaVert {
  var s: SalidaVert;
  let x = f32( ( i << 1u ) & 2u );
  let y = f32( i & 2u );
  s.uv = vec2<f32>( x, y );
  s.pos = vec4<f32>( x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0 );
  return s;
}

// ---------- Funciones del medio ----------

// Densidad de cada componente a una altura dada sobre el suelo.
// Devuelve (rayleigh, mie, ozono).
fn densidades( altura: f32 ) -> vec3<f32> {
  let r = exp( -altura / RAYLEIGH_ALTURA );
  let m = exp( -altura / MIE_ALTURA );
  // El ozono es una "carpa": sube hasta 25 km y baja. No es
  // exponencial como los otros dos.
  let o = max( 0.0, 1.0 - abs( altura - OZONO_CENTRO ) / OZONO_ANCHO );
  return vec3<f32>( r, m, o );
}

// Coeficiente de extinción total (lo que se pierde por km).
fn extincion( altura: f32 ) -> vec3<f32> {
  let d = densidades( altura );
  return RAYLEIGH_DISPERSION * d.x
    + vec3<f32>( MIE_DISPERSION + MIE_ABSORCION ) * d.y
    + OZONO_ABSORCION * d.z;
}

// Distancia desde un punto hasta la superficie de una esfera centrada
// en el origen, siguiendo una dirección. Devuelve -1 si no la corta.
fn interseccionEsfera( origen: vec3<f32>, dir: vec3<f32>, radio: f32 ) -> f32 {
  let b = dot( origen, dir );
  let c = dot( origen, origen ) - radio * radio;
  if ( c > 0.0 && b > 0.0 ) { return -1.0; }
  let disc = b * b - c;
  if ( disc < 0.0 ) { return -1.0; }
  let raiz = sqrt( disc );
  if ( disc > b * b ) { return -b + raiz; }
  let t = -b - raiz;
  return select( -b + raiz, t, t >= 0.0 );
}

// Fases: cómo se reparte la luz dispersada según el ángulo.
fn faseRayleigh( cosA: f32 ) -> f32 {
  return 3.0 / ( 16.0 * 3.14159265 ) * ( 1.0 + cosA * cosA );
}

fn faseMie( cosA: f32 ) -> f32 {
  // Henyey-Greenstein con g = 0.8: muy direccional hacia adelante, que
  // es lo que forma el halo alrededor del sol.
  let g = 0.8;
  let d = 1.0 + g * g - 2.0 * g * cosA;
  return ( 1.0 - g * g ) / ( 4.0 * 3.14159265 * max( d * sqrt( max( d, 0.0001 ) ), 0.0001 ) );
}

// ---------- 1. Tabla de transmitancia ----------
// uv.x codifica el coseno del ángulo del sol, uv.y la altura.

fn uvATransmitancia( uv: vec2<f32> ) -> vec2<f32> {
  let altura = mix( 0.0, RADIO_CIELO - RADIO_SUELO, uv.y );
  let cosSol = uv.x * 2.0 - 1.0;
  return vec2<f32>( cosSol, altura );
}

@fragment
fn fsTransmitancia( e: SalidaVert ) -> @location(0) vec4<f32> {
  let p = uvATransmitancia( e.uv );
  let cosSol = p.x;
  let r = RADIO_SUELO + p.y;
  let origen = vec3<f32>( 0.0, r, 0.0 );
  let dir = normalize( vec3<f32>( sqrt( max( 1.0 - cosSol * cosSol, 0.0 ) ), cosSol, 0.0 ) );

  // Si el rayo entra en el planeta, no llega nada.
  if ( interseccionEsfera( origen, dir, RADIO_SUELO ) > 0.0 ) {
    return vec4<f32>( 0.0, 0.0, 0.0, 1.0 );
  }
  let largo = interseccionEsfera( origen, dir, RADIO_CIELO );
  if ( largo < 0.0 ) { return vec4<f32>( 1.0, 1.0, 1.0, 1.0 ); }

  // Integración simple a lo largo del rayo. 40 pasos alcanzan porque
  // esto se calcula UNA vez, no por cuadro.
  let pasos = 40;
  let dt = largo / f32( pasos );
  var optica = vec3<f32>( 0.0 );
  for ( var i = 0; i < pasos; i = i + 1 ) {
    let t = ( f32( i ) + 0.5 ) * dt;
    let altura = length( origen + dir * t ) - RADIO_SUELO;
    optica = optica + extincion( altura ) * dt;
  }
  return vec4<f32>( exp( -optica ), 1.0 );
}

fn transmitancia( altura: f32, cosSol: f32 ) -> vec3<f32> {
  let u = cosSol * 0.5 + 0.5;
  let v = clamp( altura / ( RADIO_CIELO - RADIO_SUELO ), 0.0, 1.0 );
  return textureSampleLevel( lutTransmitancia, muestreador, vec2<f32>( u, v ), 0.0 ).rgb;
}

// ---------- 2. Tabla de dispersión múltiple ----------
// Se aproxima suponiendo que la luz ya rebotada llega por igual desde
// todas las direcciones. Es la simplificación clave de Hillaire: lo
// vuelve barato sin que se note la diferencia.

@fragment
fn fsMultiple( e: SalidaVert ) -> @location(0) vec4<f32> {
  let altura = mix( 0.0, RADIO_CIELO - RADIO_SUELO, e.uv.y );
  let cosSol = e.uv.x * 2.0 - 1.0;
  let r = RADIO_SUELO + altura;
  let origen = vec3<f32>( 0.0, r, 0.0 );
  let dirSol = normalize( vec3<f32>( sqrt( max( 1.0 - cosSol * cosSol, 0.0 ) ), cosSol, 0.0 ) );

  // Se muestrea la esfera de direcciones con una espiral de Fibonacci:
  // reparte los puntos mucho más parejo que un barrido por ángulos, que
  // amontona muestras en los polos.
  let muestras = 32;
  var luzTotal = vec3<f32>( 0.0 );
  var fTotal = vec3<f32>( 0.0 );

  for ( var i = 0; i < muestras; i = i + 1 ) {
    let fi = ( f32( i ) + 0.5 ) / f32( muestras );
    let cosT = 1.0 - 2.0 * fi;
    let sinT = sqrt( max( 1.0 - cosT * cosT, 0.0 ) );
    let phi = f32( i ) * 2.39996323;
    let dir = vec3<f32>( sinT * cos( phi ), cosT, sinT * sin( phi ) );

    var largo = interseccionEsfera( origen, dir, RADIO_CIELO );
    let suelo = interseccionEsfera( origen, dir, RADIO_SUELO );
    if ( suelo > 0.0 ) { largo = suelo; }
    if ( largo <= 0.0 ) { continue; }

    let pasos = 16;
    let dt = largo / f32( pasos );
    var trans = vec3<f32>( 1.0 );
    var luz = vec3<f32>( 0.0 );
    var f = vec3<f32>( 0.0 );

    for ( var k = 0; k < pasos; k = k + 1 ) {
      let t = ( f32( k ) + 0.5 ) * dt;
      let pos = origen + dir * t;
      let h = length( pos ) - RADIO_SUELO;
      let d = densidades( h );
      let disp = RAYLEIGH_DISPERSION * d.x + vec3<f32>( MIE_DISPERSION ) * d.y;
      let ext = extincion( h );
      let paso = exp( -ext * dt );

      let cosSolLocal = dot( normalize( pos ), dirSol );
      let transSol = transmitancia( h, cosSolLocal );

      // Fase uniforme: la hipótesis de que la luz rebotada viene de
      // todas partes por igual.
      let fase = 1.0 / ( 4.0 * 3.14159265 );
      let aporte = disp * fase * transSol;
      // Integración analítica del segmento, más precisa que multiplicar
      // por dt a secas con pocos pasos.
      let integrado = ( aporte - aporte * paso ) / max( ext.x + ext.y + ext.z, 0.0001 );
      luz = luz + trans * integrado;
      f = f + trans * disp * dt;
      trans = trans * paso;
    }

    luzTotal = luzTotal + luz;
    fTotal = fTotal + f;
  }

  let inv = 1.0 / f32( muestras );
  let l = luzTotal * inv;
  let fms = fTotal * inv;
  // Serie geométrica: la luz que rebota infinitas veces converge a
  // L / (1 - f). Es el truco que evita simular rebote por rebote.
  return vec4<f32>( l / max( vec3<f32>( 1.0 ) - fms, vec3<f32>( 0.001 ) ), 1.0 );
}

fn multiple( altura: f32, cosSol: f32 ) -> vec3<f32> {
  let u = cosSol * 0.5 + 0.5;
  let v = clamp( altura / ( RADIO_CIELO - RADIO_SUELO ), 0.0, 1.0 );
  return textureSampleLevel( lutMultiple, muestreador, vec2<f32>( u, v ), 0.0 ).rgb;
}

// ---------- 3. Tabla de vista del cielo ----------
// uv.x: azimut alrededor del sol. uv.y: elevación, con MÁS resolución
// cerca del horizonte, que es donde el color cambia más rápido.

fn uvADireccion( uv: vec2<f32>, alturaCam: f32 ) -> vec3<f32> {
  let azim = uv.x * 2.0 * 3.14159265;
  // El sesgo cuadrático concentra las muestras en el horizonte: con
  // reparto lineal se ve una banda escalonada justo ahí.
  var v = uv.y * 2.0 - 1.0;
  v = sign( v ) * v * v;
  let elev = v * ( 3.14159265 * 0.5 );
  let cosE = cos( elev );
  return vec3<f32>( cosE * sin( azim ), sin( elev ), cosE * cos( azim ) );
}

// Integra la dispersión a lo largo de un rayo para UNA fuente de luz.
//
// Antes esto estaba escrito a mano dentro de fsVistaCielo con el sol
// metido adentro. Sacarlo a una función que recibe la dirección de la
// luz es lo que permite que la luna sea una luz de verdad: el mismo
// código físico se evalúa dos veces, una por fuente, y se suman. Un
// cielo iluminado por la luna tiene su propio halo y su propio azul
// dispersado, y eso no se puede fingir con un disco.
fn integrarCielo( origen: vec3<f32>, dir: vec3<f32>, largo: f32, dirLuz: vec3<f32> ) -> vec3<f32> {
  let cosA = dot( dir, dirLuz );
  let fR = faseRayleigh( cosA );
  let fM = faseMie( cosA );

  let pasos = 40;
  var trans = vec3<f32>( 1.0 );
  var luz = vec3<f32>( 0.0 );
  // Reparto casi parejo a lo largo del rayo, con un sesgo suave hacia
  // la cámara (exponente 1.2) donde el medio cambia más rápido.
  //
  // Nota honesta: este sesgo arrancó en f*f y lo bajé sospechando que
  // vaciaba de muestras la zona alta y lejana, que es la única
  // iluminada en el crepúsculo. Medido antes y después, el brillo medio
  // del cielo a -6,7 grados dio exactamente lo mismo (0,80): la
  // hipótesis era falsa. Se deja en 1.2 porque es más correcto en
  // general, pero NO es lo que resuelve el crepúsculo -- eso es un
  // problema de exposición, no de muestreo.
  for ( var i = 0; i < pasos; i = i + 1 ) {
    let f0 = pow( f32( i ) / f32( pasos ), 1.2 );
    let f1 = pow( f32( i + 1 ) / f32( pasos ), 1.2 );
    let t0 = largo * f0;
    let t1 = largo * f1;
    let dt = t1 - t0;
    let t = ( t0 + t1 ) * 0.5;

    let pos = origen + dir * t;
    let h = length( pos ) - RADIO_SUELO;
    let d = densidades( h );
    let dispR = RAYLEIGH_DISPERSION * d.x;
    let dispM = vec3<f32>( MIE_DISPERSION ) * d.y;
    let ext = extincion( h );
    let paso = exp( -ext * dt );

    let cosLuzLocal = dot( normalize( pos ), dirLuz );
    let transLuz = transmitancia( h, cosLuzLocal );
    let ms = multiple( h, cosLuzLocal );

    // Dispersión simple (con su fase) más la múltiple (sin fase: ya
    // viene de todas direcciones).
    let aporte = ( dispR * fR + dispM * fM ) * transLuz + ( dispR + dispM ) * ms;
    let integrado = ( aporte - aporte * paso ) / max( ext.x + ext.y + ext.z, 0.0001 );
    luz = luz + trans * integrado;
    trans = trans * paso;
  }
  return luz;
}

@fragment
fn fsVistaCielo( e: SalidaVert ) -> @location(0) vec4<f32> {
  let alturaCam = comun.camara.y - RADIO_SUELO;
  let origen = vec3<f32>( 0.0, comun.camara.y, 0.0 );
  let dir = uvADireccion( e.uv, alturaCam );

  var largo = interseccionEsfera( origen, dir, RADIO_CIELO );
  let suelo = interseccionEsfera( origen, dir, RADIO_SUELO );
  if ( suelo > 0.0 ) { largo = suelo; }
  if ( largo <= 0.0 ) { return vec4<f32>( 0.0, 0.0, 0.0, 1.0 ); }

  var luz = vec3<f32>( 0.0 );
  if ( comun.sol.w > 0.0005 ) {
    luz = luz + integrarCielo( origen, dir, largo, normalize( comun.sol.xyz ) ) * comun.sol.w;
  }
  // La segunda integración solo se paga cuando hay luz de luna que
  // valga la pena. De día la rama no se toma, así que el mediodía
  // cuesta exactamente lo mismo que antes.
  if ( comun.luna.w > 0.0005 ) {
    luz = luz + integrarCielo( origen, dir, largo, normalize( comun.luna.xyz ) )
      * comun.luna.w * comun.lunaColor.rgb;
  }

  return vec4<f32>( luz, 1.0 );
}

// ---------- 4. Composición final ----------

fn direccionAUv( dir: vec3<f32> ) -> vec2<f32> {
  let elev = asin( clamp( dir.y, -1.0, 1.0 ) );
  var v = elev / ( 3.14159265 * 0.5 );
  v = sign( v ) * sqrt( abs( v ) );
  let azim = atan2( dir.x, dir.z );
  return vec2<f32>( ( azim / ( 2.0 * 3.14159265 ) ) + 0.5, v * 0.5 + 0.5 );
}

// Dirección de cámara para un uv de pantalla.
//
// Vive en una función porque la pasada de nubes TIENE que usar
// exactamente el mismo encuadre que la composición; si se escribiera
// dos veces, cualquier retoque del campo de visión en un lado haría
// que las nubes quedaran corridas respecto del cielo.
fn direccionCamara( uv: vec2<f32> ) -> vec3<f32> {
  // Cámara fija y cinematográfica, como pidió el usuario: no hay
  // control libre. Un campo de visión angosto (unos 45 grados) achata
  // la perspectiva y da el aire de teleobjetivo de un plano de cine.
  let ndc = vec2<f32>( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
  let escala = tan( 0.3926991 );
  var dir = normalize( vec3<f32>( ndc.x * escala * comun.pantalla.z, ndc.y * escala, -1.0 ) );
  // Inclinación de la cámara hacia arriba. Encuadrada al horizonte, la
  // mitad de abajo es cielo mirado hacia el suelo y no aporta nada;
  // subiendo el eje entra el sol y el cielo alto, que es lo que tiene
  // interés mientras no haya terreno.
  let incl = 0.20;
  let c = cos( incl );
  let sn = sin( incl );
  return normalize( vec3<f32>( dir.x, dir.y * c - dir.z * sn, dir.y * sn + dir.z * c ) );
}

// Disco lunar con relieve y FASE REAL.
//
// El truco para el terminador: dentro del disco se reconstruye la
// normal de una esfera y se la ilumina con una dirección derivada de la
// fase. Eso da el borde curvo de una luna creciente de verdad, con su
// sombra propia, en vez del recorte recto que deja mezclar dos
// círculos. Cuesta unas pocas operaciones y solo dentro del disco.
fn discoLuna( dir: vec3<f32>, dirLuna: vec3<f32> ) -> vec3<f32> {
  let cosA = dot( dir, dirLuna );
  // LA LUNA SE DIBUJA MAS GRANDE QUE EN LA REALIDAD, a proposito.
  //
  // El diametro real es de medio grado: a 900 pixeles de alto con un
  // campo de 45 grados eso son 10 pixeles, un puntito sin presencia
  // donde no se distingue ni la fase ni los mares. Esto es un fondo
  // cinematografico, y una luna grande es parte del lenguaje visual que
  // el usuario pidio (hace falta para Ashenvale). Se queda en unos 2,2
  // grados: suficiente para leerla, lejos de la caricatura.
  if ( cosA < 0.99968 ) { return vec3<f32>( 0.0 ); }

  // Coordenadas dentro del disco. Se arma una base perpendicular a la
  // dirección de la luna y se proyecta el rayo sobre ella.
  let arriba = select( vec3<f32>( 0.0, 1.0, 0.0 ), vec3<f32>( 1.0, 0.0, 0.0 ), abs( dirLuna.y ) > 0.99 );
  let ejeX = normalize( cross( arriba, dirLuna ) );
  let ejeY = cross( dirLuna, ejeX );
  let radio = 0.0193;
  let d = dir - dirLuna * cosA;
  var uv = vec2<f32>( dot( d, ejeX ), dot( d, ejeY ) ) / radio;
  let r2 = dot( uv, uv );
  if ( r2 > 1.0 ) { return vec3<f32>( 0.0 ); }

  // Normal de la esfera lunar reconstruida.
  let n = vec3<f32>( uv, sqrt( max( 1.0 - r2, 0.0 ) ) );

  // Dirección del sol VISTA DESDE LA LUNA, deducida de la fase:
  // fase 1 (llena) la ilumina de frente, fase 0 (nueva) por detrás.
  let ang = ( 1.0 - comun.lunaColor.w ) * 3.14159265;
  let dirSolLuna = vec3<f32>( sin( ang ), 0.0, cos( ang ) );
  // El borde del terminador en la Luna no es perfectamente nítido: el
  // relieve lo desdibuja. smoothstep en vez de max() evita el escalón
  // aliaseado que delataría el truco.
  let lit = smoothstep( -0.06, 0.10, dot( n, dirSolLuna ) );

  // Mares: manchas oscuras de basalto. Sin esto el disco se lee como
  // una pelota de ping-pong, y es lo primero que el ojo nota mal.
  let mares = 0.80 + 0.20 * clamp(
    sin( uv.x * 7.3 + 1.7 ) * sin( uv.y * 5.9 - 0.4 ) * 0.5 + 0.55, 0.0, 1.0 );
  // El limbo se oscurece poco: la Luna es casi lambertiana pero con
  // retrodispersión fuerte, de ahí que la llena se vea como un disco
  // plano y no como una esfera sombreada.
  let limbo = 0.72 + 0.28 * n.z;

  let albedo = comun.lunaColor.rgb * mares * limbo;
  // Luz cenicienta: la cara oscura recibe el reflejo de la Tierra. Es
  // tenuísima pero es la diferencia entre un creciente flotando en la
  // nada y un disco completo apenas insinuado.
  let ceniza = 0.018 * comun.lunaColor.w;
  let borde = 1.0 - smoothstep( 0.93, 1.0, sqrt( r2 ) );
  return albedo * ( lit + ceniza ) * borde * 1.9;
}

@fragment
fn fsCielo( e: SalidaVert ) -> @location(0) vec4<f32> {
  let dir = direccionCamara( e.uv );

  var color = textureSampleLevel( lutVista, muestreador, direccionAUv( dir ), 0.0 ).rgb;

  let alturaCam = comun.camara.y - RADIO_SUELO;

  // El disco solar se dibuja aparte: la tabla de vista no tiene
  // resolución para algo tan chico, y si se dejara ahí se vería como un
  // borrón en vez de un disco.
  let dirSol = normalize( comun.sol.xyz );
  let cosA = dot( dir, dirSol );
  // 0.9995 equivale a un radio de medio grado, el tamaño real del sol
  // visto desde la Tierra.
  let disco = smoothstep( 0.99985, 0.99995, cosA );
  let transSol = transmitancia( alturaCam, dirSol.y );
  // Valor alto a propósito: esto es HDR, y el mapeo de tonos del final
  // se encarga de comprimirlo. En un buffer de 8 bits esto recortaría.
  var fuentes = transSol * disco * 22.0 * comun.sol.w;

  // La luna, atenuada por la misma atmósfera que el sol: baja en el
  // horizonte se pone anaranjada y pierde brillo, como en la realidad.
  let dirLuna = normalize( comun.luna.xyz );
  if ( dirLuna.y > -0.02 ) {
    let transLuna = transmitancia( alturaCam, dirLuna.y );
    fuentes = fuentes + discoLuna( dir, dirLuna ) * transLuna;
  }

  color = color + fuentes;

  // NUBES. Vienen de su propia pasada a media resolución; acá solo se
  // componen. El muestreo bilineal del upsample alcanza porque la capa
  // es de baja frecuencia por naturaleza, y el disco del sol se dibuja
  // a resolución completa así que no pierde nitidez.
  //
  // Todo lo que está detrás se multiplica por la transmitancia de la
  // nube y se le suma la luz que la nube dispersa. Es composición de
  // transparencia estándar: el sol queda tapado por una nube espesa,
  // que es justo lo que hace que la escena se lea como volumen.
  // Cuatro muestras en rejilla rotada en vez de una. El desfase de
  // arranque de los rayos usa ruido entrelazado, que es un patron
  // ORDENADO: a una sola muestra deja una trama diagonal fina visible
  // sobre el cuerpo de la nube. Promediar 2x2 a un pixel de distancia
  // la borra, y como la capa es de baja frecuencia no se pierde nada
  // que el ojo pueda extrañar. Cuatro lecturas de una textura a media
  // resolucion son de lo mas barato que hay en esta pasada.
  let px = vec2<f32>( 1.0 / max( comun.pantalla.x, 1.0 ), 1.0 / max( comun.pantalla.y, 1.0 ) );
  let nube = 0.25 * (
      textureSampleLevel( texNubes, muestreador, e.uv + vec2<f32>(  px.x,  px.y ), 0.0 )
    + textureSampleLevel( texNubes, muestreador, e.uv + vec2<f32>( -px.x,  px.y ), 0.0 )
    + textureSampleLevel( texNubes, muestreador, e.uv + vec2<f32>(  px.x, -px.y ), 0.0 )
    + textureSampleLevel( texNubes, muestreador, e.uv + vec2<f32>( -px.x, -px.y ), 0.0 ) );
  color = color * nube.a + nube.rgb;

  return vec4<f32>( color, 1.0 );
}
