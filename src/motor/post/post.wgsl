// Post-proceso: de alto rango dinámico a pantalla.
//
// Esta pasada es la que resuelve de raíz el problema que arrastraron
// todas las escenas anteriores: los colores se elegían a ojo en un
// buffer que no podía pasar de 1, así que cualquier fuente de luz se
// aplanaba contra su propio halo, y subir el valor recortaba a blanco y
// mataba el matiz. Acá el render ocurre en rgba16float --donde el sol
// puede valer 22 sin problema-- y es ESTA pasada la que decide cómo se
// comprime ese rango a lo que la pantalla puede mostrar.
//
// Se usa AgX (Troy Sobotka) y no ACES ni Reinhard por un motivo
// concreto: AgX desatura los tonos muy brillantes de forma gradual, así
// que una luz intensa se va al blanco por un camino creíble en vez de
// saltar de color saturado a blanco puro. Es justo el defecto que el
// usuario marcó como "se recorta y pierde el color".

struct Ajustes {
  // x: exposición, y: ancho, z: alto, w: tiempo.
  p: vec4<f32>,
};

@group(0) @binding(0) var<uniform> ajustes: Ajustes;
@group(0) @binding(1) var muestreador: sampler;
@group(0) @binding(2) var escena: texture_2d<f32>;

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

// Matrices del espacio AgX. Comprimen el gamut antes de aplicar la
// curva, que es lo que evita que los tonos saturados se desvíen de
// color al acercarse al blanco.
const AGX = mat3x3<f32>(
  0.842479062253094, 0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772, 0.0784336000000000,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104
);

const AGX_INV = mat3x3<f32>(
   1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
  -0.0990297440797205,-0.0989611768448433,  1.15107367264116
);

// Aproximación polinómica de la curva de contraste de AgX. Es un ajuste
// de sexto grado a la curva original: visualmente idéntico y sin las
// llamadas a pow() que costarían por píxel.
fn curvaAgx( x: vec3<f32> ) -> vec3<f32> {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}

fn agx( valor: vec3<f32> ) -> vec3<f32> {
  // El rango se expresa en PARADAS (log2), no en valores lineales. Por
  // eso AgX maneja bien un sol de 22 y una sombra de 0.001 a la vez:
  // son ~14 paradas, y la curva reparte el detalle a lo largo de ellas.
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = AGX * max( valor, vec3<f32>( 0.0 ) );
  v = clamp( log2( max( v, vec3<f32>( 1e-10 ) ) ), vec3<f32>( minEv ), vec3<f32>( maxEv ) );
  v = ( v - minEv ) / ( maxEv - minEv );
  return clamp( curvaAgx( v ), vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) );
}

// Un toque de contraste y saturación después de la curva. AgX de fábrica
// es deliberadamente neutro --está pensado para que un colorista decida
// después-- y sin esto el resultado se ve correcto pero apagado.
fn lookAgx( valor: vec3<f32> ) -> vec3<f32> {
  let luma = dot( valor, vec3<f32>( 0.2126, 0.7152, 0.0722 ) );
  let saturacion = 1.18;
  let contraste = 1.06;
  var v = mix( vec3<f32>( luma ), valor, saturacion );
  v = pow( max( v, vec3<f32>( 0.0 ) ), vec3<f32>( contraste ) );
  return v;
}

// Ruido de orden alto para romper el bandeo. Sin esto, un degradé de
// cielo limpio muestra escalones visibles al cuantizar a 8 bits: el ojo
// detecta bordes de una unidad en una rampa suave.
fn ruidoBayer( pos: vec2<f32> ) -> f32 {
  return fract( sin( dot( pos, vec2<f32>( 12.9898, 78.233 ) ) ) * 43758.5453 );
}

@fragment
fn fsPost( e: SalidaVert ) -> @location(0) vec4<f32> {
  var color = textureSampleLevel( escena, muestreador, e.uv, 0.0 ).rgb;

  color = color * ajustes.p.x;

  // VIÑETA SUAVE, centrada. No es decorativa: el usuario pidió que el
  // centro de la pantalla no tenga contraste excesivo porque ahí va la
  // llave del torneo. Bajar un poco el centro y los bordes deja la
  // lectura del texto limpia sin apagar la escena.
  let d = length( e.uv - vec2<f32>( 0.5 ) );
  let vineta = mix( 1.0, smoothstep( 1.05, 0.30, d ), 0.35 );
  color = color * vineta;

  color = agx( color );
  color = lookAgx( color );

  // El valor del dither es de media unidad de 8 bits: lo justo para
  // romper el escalón sin agregar grano visible.
  let n = ruidoBayer( e.pos.xy + vec2<f32>( ajustes.p.w * 60.0 ) );
  color = color + ( n - 0.5 ) / 255.0;

  return vec4<f32>( color, 1.0 );
}
