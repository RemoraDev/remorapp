// Revisa los bloques WGSL escritos a mano de los fondos.
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
import { readFileSync, readdirSync } from 'node:fs';

// Se listan por carpeta y no uno por uno para que una escena nueva quede
// cubierta sola, sin acordarse de volver a tocar este script.
const CARPETA_ESCENAS = 'src/components/fondos';
const ARCHIVOS = [
  'src/components/FondoWebgpu.tsx',
  ...readdirSync(CARPETA_ESCENAS)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${CARPETA_ESCENAS}/${f}`),
];

// Copiadas textuales de three v0.186.1 (three.webgpu.js).
const declaracionRegexp = /^[fn]*\s*([a-z_0-9]+)?\s*\(([\s\S]*?)\)\s*[\-\>]*\s*([a-z_0-9]+(?:<[\s\S]+?>)?)/i;
const propiedadesRegexp = /([a-z_0-9]+)\s*:\s*([a-z_0-9]+(?:<[\s\S]+?>)?)/gi;

const tiposWgsl = {
  f32: 'float',
  i32: 'int',
  u32: 'uint',
  bool: 'bool',
  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',
  'mat2x2<f32>': 'mat2',
  'mat3x3<f32>': 'mat3',
  'mat4x4<f32>': 'mat4',
};

const BLOQUE_WGSL = /wgslFn\(\s*(?:\/\* wgsl \*\/\s*)?`([\s\S]*?)`/g;

let problemas = 0;
let totalBloques = 0;
const avisar = (msg) => {
  console.error(`    !! ${msg}`);
  problemas++;
};

const porArchivo = ARCHIVOS.map((archivo) => ({
  archivo,
  bloques: [...readFileSync(archivo, 'utf8').matchAll(BLOQUE_WGSL)].map((m) => m[1]),
})).filter((x) => x.bloques.length > 0);

if (porArchivo.length === 0) {
  console.error('No se encontró ningún bloque wgslFn. ¿Se movieron los archivos?');
  process.exit(1);
}

function revisarBloque(codigo, indice) {
  const abre = (codigo.match(/{/g) || []).length;
  const cierra = (codigo.match(/}/g) || []).length;

  const limpio = codigo.replace(/^(?:\s*\/\/[^\r\n]*|\s*\/\*[\s\S]*?\*\/|\s*)+/, '');
  const decl = limpio.match(declaracionRegexp);

  if (decl === null || decl.length !== 4) {
    avisar(`bloque [${indice}]: three no va a poder parsear la declaración de esta función.`);
    return;
  }

  const nombre = decl[1] ?? '(anónima)';
  const retorno = decl[3] || 'void';
  const entradas = [];
  propiedadesRegexp.lastIndex = 0;
  let m = null;
  while ((m = propiedadesRegexp.exec(decl[2])) !== null) entradas.push({ nombre: m[1], tipo: m[2] });

  console.log(`    fn ${nombre}(${entradas.length}) -> ${retorno}`);

  // Un desbalance de llaves es casi siempre la cadena cortada por un
  // backtick: es el síntoma que hay que cazar.
  if (abre !== cierra) {
    avisar(
      `fn ${nombre}: llaves desbalanceadas (${abre} "{" vs ${cierra} "}"). ` +
        'Casi seguro hay una comilla invertida dentro del WGSL que cortó el template literal.',
    );
  }
  if (codigo.includes('${')) {
    avisar(`fn ${nombre}: contiene "\${", que JS interpola dentro del template literal.`);
  }
  if (!(retorno in tiposWgsl) && retorno !== 'void') {
    avisar(`fn ${nombre}: three no mapea el tipo de retorno "${retorno}".`);
  }
  for (const e of entradas) {
    const conocido =
      e.tipo in tiposWgsl || e.tipo.startsWith('texture') || e.tipo.startsWith('ptr') || e.tipo === 'sampler';
    if (!conocido) {
      avisar(`fn ${nombre}: three no mapea el tipo "${e.tipo}" del parámetro "${e.nombre}".`);
    }
  }
}

for (const { archivo, bloques } of porArchivo) {
  console.log(`\n${archivo}: ${bloques.length} bloque(s) wgslFn`);
  totalBloques += bloques.length;
  bloques.forEach(revisarBloque);
}

console.log();
if (problemas > 0) {
  console.error(`${problemas} problema(s). El shader se emitiría roto o truncado.`);
  process.exit(1);
}
console.log(`${totalBloques} bloque(s) revisados en ${porArchivo.length} archivo(s). Todo en orden.`);
