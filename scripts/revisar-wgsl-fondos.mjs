// Revisa los bloques WGSL escritos a mano en FondoWebgpu.tsx.
//
// Por qué existe: esos bloques viven dentro de template literals de JS, así
// que una comilla invertida o un ${ dentro del WGSL (por ejemplo en un
// comentario, citando un identificador) corta la cadena en silencio. El
// shader se emite TRUNCADO, tsc y vite compilan sin una sola queja, y el
// único síntoma es un fondo negro con un error de WGSL enterrado en la
// consola del navegador. Pasó de verdad; de ahí este chequeo.
//
// También confirma que el parser de three va a poder leer cada función: usa
// las MISMAS expresiones regulares que three/build/three.webgpu.js (están
// ancladas con ^, por eso cada bloque lleva una sola función y los
// auxiliares van por "includes") y avisa si algún tipo no se mapea.
//
// Uso: node scripts/revisar-wgsl-fondos.mjs
import { readFileSync } from 'node:fs';

const ARCHIVO = 'src/components/FondoWebgpu.tsx';

// Copiadas textuales de three v0.186.1 (three.webgpu.js).
const declaracionRegexp = /^[fn]*\s*([a-z_0-9]+)?\s*\(([\s\S]*?)\)\s*[\-\>]*\s*([a-z_0-9]+(?:<[\s\S]+?>)?)/i;
const propiedadesRegexp = /([a-z_0-9]+)\s*:\s*([a-z_0-9]+(?:<[\s\S]+?>)?)/ig;

const tiposWgsl = {
  f32: 'float', i32: 'int', u32: 'uint', bool: 'bool',
  'vec2<f32>': 'vec2', 'vec3<f32>': 'vec3', 'vec4<f32>': 'vec4',
  'mat2x2<f32>': 'mat2', 'mat3x3<f32>': 'mat3', 'mat4x4<f32>': 'mat4',
};

const fuente = readFileSync(ARCHIVO, 'utf8');
const bloques = [...fuente.matchAll(/wgslFn\(\s*(?:\/\* wgsl \*\/\s*)?`([\s\S]*?)`/g)].map((m) => m[1]);

if (bloques.length === 0) {
  console.error(`No se encontró ningún bloque wgslFn en ${ARCHIVO}.`);
  process.exit(1);
}

console.log(`${ARCHIVO}: ${bloques.length} bloque(s) wgslFn\n`);

let problemas = 0;
const avisar = (msg) => { console.error(`  !! ${msg}`); problemas++; };

for (const [i, codigo] of bloques.entries()) {
  const abre = (codigo.match(/{/g) || []).length;
  const cierra = (codigo.match(/}/g) || []).length;

  const limpio = codigo.replace(/^(?:\s*\/\/[^\r\n]*|\s*\/\*[\s\S]*?\*\/|\s*)+/, '');
  const decl = limpio.match(declaracionRegexp);

  if (decl === null || decl.length !== 4) {
    avisar(`bloque [${i}]: three no va a poder parsear la declaración de esta función.`);
    continue;
  }

  const nombre = decl[1] ?? '(anónima)';
  const retorno = decl[3] || 'void';
  const entradas = [];
  propiedadesRegexp.lastIndex = 0;
  let m = null;
  while ((m = propiedadesRegexp.exec(decl[2])) !== null) entradas.push({ nombre: m[1], tipo: m[2] });

  console.log(`  fn ${nombre}(${entradas.length}) -> ${retorno}`);

  // Un desbalance de llaves es casi siempre la cadena cortada por un
  // backtick: es el síntoma que hay que cazar.
  if (abre !== cierra) {
    avisar(`fn ${nombre}: llaves desbalanceadas (${abre} "{" vs ${cierra} "}"). ` +
      'Casi seguro hay una comilla invertida dentro del WGSL que cortó el template literal.');
  }
  if (codigo.includes('${')) {
    avisar(`fn ${nombre}: contiene "\${", que JS interpola dentro del template literal.`);
  }
  if (!(retorno in tiposWgsl) && retorno !== 'void') {
    avisar(`fn ${nombre}: three no mapea el tipo de retorno "${retorno}".`);
  }
  for (const e of entradas) {
    if (!(e.tipo in tiposWgsl) && !e.tipo.startsWith('texture') && !e.tipo.startsWith('ptr') && e.tipo !== 'sampler') {
      avisar(`fn ${nombre}: three no mapea el tipo "${e.tipo}" del parámetro "${e.nombre}".`);
    }
  }
}

console.log();
if (problemas > 0) {
  console.error(`${problemas} problema(s). El shader se emitiría roto o truncado.`);
  process.exit(1);
}
console.log('Todo en orden.');
