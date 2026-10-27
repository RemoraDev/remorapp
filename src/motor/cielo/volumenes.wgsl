// Horneado de los volúmenes de ruido para las nubes.
//
// POR QUÉ UN HORNEADO Y NO RUIDO POR PÍXEL.
// La forma de cúmulo convincente --base plana, coliflor arriba, bordes
// comidos-- sale de combinar Perlin con Worley (ruido celular). Worley
// en 3D cuesta recorrer 27 celdas vecinas por octava. Un raymarch de 40
// pasos con 4 octavas serían ~4300 celdas POR PÍXEL: imposible en vivo.
//
// Acá se paga una sola vez al arrancar: se escriben dos texturas 3D y
// en vivo cada muestra de densidad son DOS lecturas de textura. Es la
// receta de Horizon Zero Dawn (Schneider & Vos, 2015), y es lo que
// permite nubes volumétricas de verdad dentro del presupuesto.
//
// Los dos volúmenes:
//   forma   128^3  r: Perlin-Worley, gba: Worley a 4/8/16 celdas
//   detalle  32^3  rgb: Worley a 8/16/32 celdas (para comer los bordes)
//
// Todo el ruido es TILEABLE: las celdas vecinas se envuelven con módulo
// antes de buscar su punto. Sin eso aparecería una costura recta en el
// cielo cada vez que el volumen se repite, que es justo el defecto que
// delata una nube procedural.

@group(0) @binding(0) var destino: texture_storage_3d<rgba8unorm, write>;

fn hash33( p: vec3<f32> ) -> vec3<f32> {
  let q = vec3<f32>(
    dot( p, vec3<f32>( 127.1, 311.7, 74.7 ) ),
    dot( p, vec3<f32>( 269.5, 183.3, 246.1 ) ),
    dot( p, vec3<f32>( 113.5, 271.9, 124.6 ) )
  );
  return fract( sin( q ) * 43758.5453123 );
}

// Envuelve una celda al rango [0, celdas) para que el volumen cierre
// sobre sí mismo en los tres ejes.
fn envolver( celda: vec3<f32>, celdas: f32 ) -> vec3<f32> {
  return celda - celdas * floor( celda / celdas );
}

// Worley: distancia al punto sembrado más cercano, invertida para que
// valga 1 en el centro de cada célula y 0 en los bordes. Eso da los
// bultos redondeados; el ruido de valor da manchas, no bultos.
fn worley( p: vec3<f32>, celdas: f32 ) -> f32 {
  let pc = p * celdas;
  let id = floor( pc );
  let f = pc - id;
  var dmin = 1.0;
  for ( var x = -1; x <= 1; x = x + 1 ) {
    for ( var y = -1; y <= 1; y = y + 1 ) {
      for ( var z = -1; z <= 1; z = z + 1 ) {
        let off = vec3<f32>( f32( x ), f32( y ), f32( z ) );
        let punto = off + hash33( envolver( id + off, celdas ) ) - f;
        dmin = min( dmin, dot( punto, punto ) );
      }
    }
  }
  return 1.0 - sqrt( min( dmin, 1.0 ) );
}

// Worley de varias octavas, pesos 1/2 1/4 1/8. El resultado tiene
// bultos grandes con bultos chicos encima, que es la silueta de un
// cúmulo visto de lejos.
fn worleyFbm( p: vec3<f32>, celdas: f32 ) -> f32 {
  return worley( p, celdas ) * 0.625
    + worley( p, celdas * 2.0 ) * 0.25
    + worley( p, celdas * 4.0 ) * 0.125;
}

// Gradiente por esquina para el Perlin, también envuelto.
fn gradiente( celda: vec3<f32>, celdas: f32 ) -> vec3<f32> {
  return normalize( hash33( envolver( celda, celdas ) ) * 2.0 - 1.0 );
}

fn perlin( p: vec3<f32>, celdas: f32 ) -> f32 {
  let pc = p * celdas;
  let i = floor( pc );
  let f = pc - i;
  // Quintica en vez de cúbica: la cúbica deja la segunda derivada
  // discontinua en los bordes de celda y eso se ve como una rejilla
  // tenue cuando el ruido se usa para iluminar.
  let u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );

  var acum = 0.0;
  for ( var c = 0; c < 8; c = c + 1 ) {
    let o = vec3<f32>( f32( c & 1 ), f32( ( c >> 1u ) & 1 ), f32( ( c >> 2u ) & 1 ) );
    let g = gradiente( i + o, celdas );
    let d = f - o;
    let w = mix( 1.0 - u, u, o );
    acum = acum + dot( g, d ) * w.x * w.y * w.z;
  }
  return acum;
}

// GANANCIA 3.6: no es un numero de gusto, es una medicion.
//
// El Perlin de gradiente sin normalizar tiene recorrido teorico de
// +-0.87 pero su desviacion tipica real es de apenas 0.11. Mapeado a
// 0..1 con v*0.5+0.5 queda en 0.50 +- 0.055, o sea CASI CONSTANTE, y un
// campo constante atraviesa cualquier umbral de cobertura entero: el
// cielo sale cubierto por una sabana pareja sin una sola nube. Eso es
// exactamente lo que paso en el primer intento.
//
// Medido sobre 5000 muestras, con ganancia 3.6 el campo queda en
// 0.50 +- 0.203 y sus percentiles 2 y 98 caen en 0.07 y 0.91: ocupa el
// rango sin recortarse en los extremos.
const PERLIN_GANANCIA: f32 = 3.6;

fn perlinFbm( p: vec3<f32>, celdas: f32 ) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var esc = celdas;
  for ( var o = 0; o < 4; o = o + 1 ) {
    v = v + perlin( p, esc ) * amp;
    amp = amp * 0.5;
    esc = esc * 2.0;
  }
  return v * PERLIN_GANANCIA;
}

fn reasignar( v: f32, a0: f32, a1: f32, b0: f32, b1: f32 ) -> f32 {
  return b0 + ( v - a0 ) / max( a1 - a0, 1e-5 ) * ( b1 - b0 );
}

@compute @workgroup_size( 4, 4, 4 )
fn csForma( @builtin(global_invocation_id) gid: vec3<u32> ) {
  let dim = textureDimensions( destino );
  if ( any( gid >= dim ) ) { return; }
  // +0.5 para muestrear el CENTRO del vóxel. Sin eso el volumen queda
  // corrido medio vóxel y el tileado no cierra.
  let p = ( vec3<f32>( gid ) + 0.5 ) / vec3<f32>( dim );

  let wBaja = worleyFbm( p, 4.0 );
  // Perlin-Worley: se usa el Worley para levantar el piso del Perlin.
  // El Perlin solo daría manchas de humo; el Worley solo, pelotas
  // demasiado regulares. La mezcla es lo que da la coliflor.
  let pn = clamp( perlinFbm( p, 4.0 ) * 0.5 + 0.5, 0.0, 1.0 );
  let crudo = clamp( reasignar( pn, wBaja - 1.0, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
  // ESTIRADO POR PERCENTILES. La mezcla Perlin-Worley sale centrada en
  // 0.67 y nunca baja de 0.38: aunque ya tiene contraste, vive en el
  // tercio alto del rango, y un campo que no llega a cero no puede
  // dejar claros de cielo azul. Los dos limites son los percentiles 2 y
  // 98 medidos sobre 5000 muestras de esta misma formula.
  let pw = clamp( ( crudo - 0.376 ) / ( 0.945 - 0.376 ), 0.0, 1.0 );

  textureStore( destino, gid, vec4<f32>(
    pw,
    worleyFbm( p, 4.0 ),
    worleyFbm( p, 8.0 ),
    worleyFbm( p, 16.0 )
  ) );
}

@compute @workgroup_size( 4, 4, 4 )
fn csDetalle( @builtin(global_invocation_id) gid: vec3<u32> ) {
  let dim = textureDimensions( destino );
  if ( any( gid >= dim ) ) { return; }
  let p = ( vec3<f32>( gid ) + 0.5 ) / vec3<f32>( dim );
  textureStore( destino, gid, vec4<f32>(
    worleyFbm( p, 8.0 ),
    worleyFbm( p, 16.0 ),
    worleyFbm( p, 32.0 ),
    1.0
  ) );
}
