import { wgslFn } from "three/tsl";

// Helpers WGSL compartidos por las escenas de fondo.
//
// OJO AL ESCRIBIR WGSL ACÁ: estos bloques viven dentro de template
// literals de JS. Una comilla invertida o un dólar-llave adentro
// (aunque sea en un comentario) corta la cadena en silencio y el shader
// se emite TRUNCADO, sin que tsc ni vite se quejen -- el único síntoma
// es una pantalla negra y un error de WGSL enterrado en la consola.
// Lo caza scripts/revisar-wgsl-fondos.mjs.
//
// El parser de wgslFn está anclado con ^ y toma SOLO la primera función
// de cada bloque, así que va una función por bloque y las auxiliares se
// pasan por "includes".
//
// El cast: @types/three tipa "includes" como CodeNodeInclude (un objeto
// con build()), pero wgslFn() devuelve una función invocable que
// envuelve al FunctionNode, y pasarla directo es lo que documenta el
// propio ejemplo de wgslFn de three. Los includes se cachean por nodo
// al generarse, así que repetir uno no lo duplica en el WGSL.
type IncludeWgsl = { build(builder: unknown): void };
export const comoInclude = (fn: unknown) => fn as IncludeWgsl;

export const HASH_WGSL = wgslFn(/* wgsl */ `
  fn hash21( p: vec2<f32> ) -> f32 {
    var p3 = fract( vec3<f32>( p.x, p.y, p.x ) * 0.1031 );
    p3 = p3 + dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
`);

export const RUIDO_WGSL = wgslFn(
  /* wgsl */ `
  fn ruido( p: vec2<f32> ) -> f32 {
    let i = floor( p );
    let f = fract( p );
    let u = f * f * ( 3.0 - 2.0 * f );
    let a = hash21( i );
    let b = hash21( i + vec2<f32>( 1.0, 0.0 ) );
    let c = hash21( i + vec2<f32>( 0.0, 1.0 ) );
    let d = hash21( i + vec2<f32>( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }
`,
  [comoInclude(HASH_WGSL)],
);

// Ruido fractal de 4 octavas. Es el ladrillo de casi todo lo orgánico
// de estas escenas: el borde irregular de las copas, las nubes y la
// textura del follaje.
export const FBM_WGSL = wgslFn(
  /* wgsl */ `
  fn fbm( p: vec2<f32> ) -> f32 {
    var suma = 0.0;
    var amplitud = 0.5;
    var punto = p;
    for ( var i = 0; i < 4; i = i + 1 ) {
      suma = suma + ruido( punto ) * amplitud;
      punto = punto * 2.02;
      amplitud = amplitud * 0.5;
    }
    return suma;
  }
`,
  [comoInclude(RUIDO_WGSL), comoInclude(HASH_WGSL)],
);
