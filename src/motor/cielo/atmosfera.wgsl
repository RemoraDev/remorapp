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
  // xyz: posición de la cámara en km desde el centro del planeta.
  // w: tiempo en segundos.
  camara: vec4<f32>,
  // x: ancho, y: alto, z: aspecto, w: exposición.
  pantalla: vec4<f32>,
};

@group(0) @binding(0) var<uniform> comun: Comun;
@group(0) @binding(1) var muestreador: sampler;
@group(0) @binding(2) var lutTransmitancia: texture_2d<f32>;
@group(0) @binding(3) var lutMultiple: texture_2d<f32>;
@group(0) @binding(4) var lutVista: texture_2d<f32>;

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

@fragment
fn fsVistaCielo( e: SalidaVert ) -> @location(0) vec4<f32> {
  let alturaCam = comun.camara.y - RADIO_SUELO;
  let origen = vec3<f32>( 0.0, comun.camara.y, 0.0 );
  let dir = uvADireccion( e.uv, alturaCam );
  let dirSol = normalize( comun.sol.xyz );

  var largo = interseccionEsfera( origen, dir, RADIO_CIELO );
  let suelo = interseccionEsfera( origen, dir, RADIO_SUELO );
  if ( suelo > 0.0 ) { largo = suelo; }
  if ( largo <= 0.0 ) { return vec4<f32>( 0.0, 0.0, 0.0, 1.0 ); }

  let cosA = dot( dir, dirSol );
  let fR = faseRayleigh( cosA );
  let fM = faseMie( cosA );

  let pasos = 32;
  var trans = vec3<f32>( 1.0 );
  var luz = vec3<f32>( 0.0 );
  // Pasos crecientes: cerca de la cámara el medio cambia rápido, lejos
  // casi no. Repartir parejo gasta muestras donde no hacen falta.
  var tPrev = 0.0;
  for ( var i = 0; i < pasos; i = i + 1 ) {
    let f0 = f32( i ) / f32( pasos );
    let f1 = f32( i + 1 ) / f32( pasos );
    let t0 = largo * f0 * f0;
    let t1 = largo * f1 * f1;
    let dt = t1 - t0;
    let t = ( t0 + t1 ) * 0.5;

    let pos = origen + dir * t;
    let h = length( pos ) - RADIO_SUELO;
    let d = densidades( h );
    let dispR = RAYLEIGH_DISPERSION * d.x;
    let dispM = vec3<f32>( MIE_DISPERSION ) * d.y;
    let ext = extincion( h );
    let paso = exp( -ext * dt );

    let cosSolLocal = dot( normalize( pos ), dirSol );
    let transSol = transmitancia( h, cosSolLocal );
    let ms = multiple( h, cosSolLocal );

    // Dispersión simple (con su fase) más la múltiple (sin fase: ya
    // viene de todas direcciones).
    let aporte = ( dispR * fR + dispM * fM ) * transSol + ( dispR + dispM ) * ms;
    let integrado = ( aporte - aporte * paso ) / max( ext.x + ext.y + ext.z, 0.0001 );
    luz = luz + trans * integrado;
    trans = trans * paso;
    tPrev = t1;
  }

  return vec4<f32>( luz * comun.sol.w, 1.0 );
}

// ---------- 4. Composición final ----------

fn direccionAUv( dir: vec3<f32> ) -> vec2<f32> {
  let elev = asin( clamp( dir.y, -1.0, 1.0 ) );
  var v = elev / ( 3.14159265 * 0.5 );
  v = sign( v ) * sqrt( abs( v ) );
  let azim = atan2( dir.x, dir.z );
  return vec2<f32>( ( azim / ( 2.0 * 3.14159265 ) ) + 0.5, v * 0.5 + 0.5 );
}

@fragment
fn fsCielo( e: SalidaVert ) -> @location(0) vec4<f32> {
  // Cámara fija y cinematográfica, como pidió el usuario: no hay
  // control libre. Un campo de visión angosto (unos 45 grados) achata
  // la perspectiva y da el aire de teleobjetivo de un plano de cine.
  let ndc = vec2<f32>( e.uv.x * 2.0 - 1.0, 1.0 - e.uv.y * 2.0 );
  let escala = tan( 0.3926991 );
  var dir = normalize( vec3<f32>( ndc.x * escala * comun.pantalla.z, ndc.y * escala, -1.0 ) );
  // Inclinación de la cámara hacia arriba. Encuadrada al horizonte, la
  // mitad de abajo es cielo mirado hacia el suelo y no aporta nada;
  // subiendo el eje entra el sol y el cielo alto, que es lo que tiene
  // interés mientras no haya terreno.
  let incl = 0.20;
  let c = cos( incl );
  let sn = sin( incl );
  dir = normalize( vec3<f32>( dir.x, dir.y * c - dir.z * sn, dir.y * sn + dir.z * c ) );

  let color = textureSampleLevel( lutVista, muestreador, direccionAUv( dir ), 0.0 ).rgb;

  // El disco solar se dibuja aparte: la tabla de vista no tiene
  // resolución para algo tan chico, y si se dejara ahí se vería como un
  // borrón en vez de un disco.
  let dirSol = normalize( comun.sol.xyz );
  let cosA = dot( dir, dirSol );
  // 0.9995 equivale a un radio de medio grado, el tamaño real del sol
  // visto desde la Tierra.
  let disco = smoothstep( 0.99985, 0.99995, cosA );
  let alturaCam = comun.camara.y - RADIO_SUELO;
  let transSol = transmitancia( alturaCam, dirSol.y );
  // Valor alto a propósito: esto es HDR, y el mapeo de tonos del final
  // se encarga de comprimirlo. En un buffer de 8 bits esto recortaría.
  let sol = transSol * disco * 22.0 * comun.sol.w;

  return vec4<f32>( color + sol, 1.0 );
}
