// Mide la geometría del planeta en cada foto de fondo (public/fondos-webgpu/)
// para no estimarla a ojo: centro y radio del disco en coordenadas UV de la
// imagen, y de dónde viene la luz.
//
// Cómo: arma una máscara del cuerpo del planeta por umbral de color, se queda
// con los píxeles del BORDE que no tocan el marco (el planeta puede estar
// cortado por el encuadre, así que esos no sirven), y les ajusta una
// circunferencia por mínimos cuadrados (ajuste de Kåsa). La dirección de la luz
// sale del centroide del disco hacia su zona más brillante.
//
// Uso: node scripts/medir-discos-fondos.mjs
import sharp from 'sharp';

const ANCHO = 200; // se trabaja en baja resolución: alcanza y es instantáneo

// Cada foto necesita su propio criterio de "esto es el cuerpo del planeta".
const FONDOS = [
  {
    nombre: 'campo_estelar (Tierra y luna)',
    archivo: 'public/fondos-webgpu/campo_estelar.avif',
    // La Tierra es azul y brillante; el espacio alrededor es casi negro.
    esCuerpo: (r, g, b) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      return lum > 0.16 && b >= r && sat > 0.18;
    },
  },
  {
    nombre: 'nebulosa (Planeta púrpura)',
    archivo: 'public/fondos-webgpu/nebulosa.avif',
    // El planeta es magenta saturado y bastante más brillante que la nebulosa
    // de alrededor.
    esCuerpo: (r, g, b) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      return lum > 0.22 && r > g && sat > 0.25;
    },
  },
];

// Ajuste de circunferencia de Kåsa: resuelve el sistema lineal de
// x^2+y^2 + D*x + E*y + F = 0 por mínimos cuadrados.
function ajustarCircunferencia(puntos) {
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0;
  let Sxz = 0, Syz = 0, Sz = 0;
  const n = puntos.length;
  for (const [x, y] of puntos) {
    const z = x * x + y * y;
    Sxx += x * x; Sxy += x * y; Syy += y * y;
    Sx += x; Sy += y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  // Sistema 3x3: [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n] * [D E F]' = -[Sxz Syz Sz]'
  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, n],
  ];
  const b = [-Sxz, -Syz, -Sz];
  // Eliminación gaussiana con pivoteo parcial
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const sol = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < 3; j++) s -= A[i][j] * sol[j];
    sol[i] = s / A[i][i];
  }
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r = Math.sqrt(Math.max(cx * cx + cy * cy - F, 0));
  return { cx, cy, r };
}

for (const fondo of FONDOS) {
  const img = sharp(fondo.archivo).resize({ width: ANCHO });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  const mask = new Uint8Array(W * H);
  let sumX = 0, sumY = 0, cuenta = 0;
  let mejorLum = -1, bx = 0, by = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (fondo.esCuerpo(r, g, b)) {
        mask[y * W + x] = 1;
        sumX += x; sumY += y; cuenta++;
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (lum > mejorLum) { mejorLum = lum; bx = x; by = y; }
      }
    }
  }

  if (cuenta < 50) {
    console.log(`\n${fondo.nombre}: la máscara quedó casi vacía (${cuenta} px) -- hay que ajustar el umbral.`);
    continue;
  }

  // Separar en componentes conectados: "Tierra y luna" tiene DOS cuerpos, y
  // ajustar una sola circunferencia a las dos manchas da un resultado sin
  // sentido. Flood fill iterativo (nada de recursión, para no reventar la pila).
  const etiqueta = new Int32Array(W * H).fill(-1);
  const componentes = [];
  for (let y0 = 0; y0 < H; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      const i0 = y0 * W + x0;
      if (!mask[i0] || etiqueta[i0] !== -1) continue;
      const id = componentes.length;
      const pila = [i0];
      etiqueta[i0] = id;
      const pix = [];
      while (pila.length) {
        const i = pila.pop();
        const x = i % W, y = (i / W) | 0;
        pix.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (mask[ni] && etiqueta[ni] === -1) { etiqueta[ni] = id; pila.push(ni); }
        }
      }
      componentes.push(pix);
    }
  }
  componentes.sort((a, b) => b.length - a.length);

  console.log(`\n=== ${fondo.nombre} ===`);
  console.log(`  imagen        : ${W}x${H} (reescalada)`);
  console.log(`  px del cuerpo : ${cuenta} (${((cuenta / (W * H)) * 100).toFixed(1)}% del cuadro)`);
  console.log(`  componentes   : ${componentes.length} (se analizan los 2 mayores)`);

  for (const pix of componentes.slice(0, 2)) {
    if (pix.length < 80) continue;
    const dentro = new Set(pix.map(([x, y]) => y * W + x));
    // Borde del componente, descartando lo que toca el marco (el cuerpo puede
    // estar cortado por el encuadre y esos puntos no están sobre el limbo real).
    const borde = [];
    const margen = 2;
    for (const [x, y] of pix) {
      const vecinoVacio =
        !dentro.has((y - 1) * W + x) || !dentro.has((y + 1) * W + x) ||
        !dentro.has(y * W + x - 1) || !dentro.has(y * W + x + 1);
      if (!vecinoVacio) continue;
      if (x <= margen || y <= margen || x >= W - 1 - margen || y >= H - 1 - margen) continue;
      borde.push([x, y]);
    }
    if (borde.length < 20) { console.log(`  -- componente de ${pix.length} px: borde insuficiente`); continue; }

    const { cx, cy, r } = ajustarCircunferencia(borde);

    // Error del ajuste: si el componente no es un círculo (ej. nebulosa), esto
    // se dispara y avisa que el número no es confiable.
    let err = 0;
    for (const [x, y] of borde) err += Math.abs(Math.hypot(x - cx, y - cy) - r);
    err /= borde.length;

    // Dirección de la luz: del centro hacia el punto más brillante DEL COMPONENTE.
    let mejor = -1, px = cx, py = cy;
    for (const [x, y] of pix) {
      const o = (y * W + x) * C;
      const lum = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
      if (lum > mejor) { mejor = lum; px = x; py = y; }
    }
    let lx = px - cx, ly = py - cy;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll; ly /= ll;

    console.log(`  ---- cuerpo de ${pix.length} px ----`);
    console.log(`    centro (UV) : u=${(cx / W).toFixed(4)}  v=${(cy / H).toFixed(4)}`);
    console.log(`    radio       : ${(r / W).toFixed(4)} (en unidades de ANCHO de imagen)`);
    console.log(`    error ajuste: ${(err / r * 100).toFixed(1)}% del radio ${err / r < 0.12 ? '(buen circulo)' : '(NO es un circulo limpio)'}`);
    console.log(`    luz         : (${lx.toFixed(3)}, ${ly.toFixed(3)})  [+v = hacia abajo]`);
  }
}
