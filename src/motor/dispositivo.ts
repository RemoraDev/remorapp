// Base del motor de fondos en WebGPU PURO (sin Three.js).
//
// Por qué sin Three: lo que hay hoy son escenas pintadas en un fragment
// shader sobre Three, y eso alcanzó hasta acá. Pero dispersión
// atmosférica por LUTs, FFT de oleaje y vegetación por compute shader
// necesitan controlar pasadas, bind groups y cómputo directamente, y
// Three se vuelve una capa que estorba más de lo que ayuda.
//
// Los shaders viven en archivos .wgsl de verdad, importados con ?raw.
// Además de ser más legibles, eso elimina de raíz la trampa que ya
// costó un shader truncado en silencio: una comilla invertida dentro de
// un template literal de JS cortaba la cadena sin que nada se quejara.

export interface OpcionesDispositivo {
  canvas: HTMLCanvasElement;
  /** Si no se pide, el navegador puede elegir la GPU integrada. */
  altoRendimiento?: boolean;
}

export interface Dispositivo {
  adaptador: GPUAdapter;
  device: GPUDevice;
  contexto: GPUCanvasContext;
  /** Formato de presentación del canvas (suele ser bgra8unorm). */
  formato: GPUTextureFormat;
  /** Formato HDR interno: todo se renderiza acá y se mapea al final. */
  formatoHDR: GPUTextureFormat;
  /** true si la GPU soporta timestamp-query (medición por pasada). */
  puedeMedir: boolean;
  info: string;
}

// rgba16float y no un formato de 8 bits: el pipeline tiene que poder
// llevar valores POR ENCIMA de 1 sin recortar. Toda la sesión anterior
// peleé con que las fuentes de luz se aplanaran contra su propio halo,
// y la causa de fondo es justamente trabajar en un buffer que no puede
// representar más de 1.
const FORMATO_HDR: GPUTextureFormat = "rgba16float";

export async function crearDispositivo(o: OpcionesDispositivo): Promise<Dispositivo> {
  if (!navigator.gpu) throw new Error("Este navegador no expone WebGPU.");

  const adaptador = await navigator.gpu.requestAdapter({
    powerPreference: o.altoRendimiento === false ? "low-power" : "high-performance",
  });
  if (!adaptador) throw new Error("No hay adaptador WebGPU disponible.");

  // timestamp-query es opcional: sin él no se puede medir el tiempo de
  // GPU por pasada, pero todo lo demás funciona igual. Se pide solo si
  // existe, porque pedir una feature ausente hace fallar requestDevice.
  const puedeMedir = adaptador.features.has("timestamp-query");
  const device = await adaptador.requestDevice({
    requiredFeatures: puedeMedir ? ["timestamp-query"] : [],
    requiredLimits: {},
  });

  const contexto = o.canvas.getContext("webgpu");
  if (!contexto) throw new Error("No se pudo obtener el contexto WebGPU del canvas.");

  const formato = navigator.gpu.getPreferredCanvasFormat();
  contexto.configure({
    device,
    format: formato,
    alphaMode: "opaque",
    // El canvas es la salida FINAL, ya mapeada a tonos. El trabajo en
    // alto rango dinámico ocurre en las texturas intermedias.
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const i = adaptador.info;
  const info = i ? `${i.vendor || "?"} / ${i.architecture || "?"}` : "desconocida";

  return { adaptador, device, contexto, formato, formatoHDR: FORMATO_HDR, puedeMedir, info };
}

/**
 * Medidor de tiempo de GPU por timestamp-query.
 *
 * No se puede leer el mismo buffer que la GPU está escribiendo, así que
 * hay dos: uno donde la GPU resuelve las marcas y otro mapeable para
 * leerlas desde la CPU. Y la lectura es asíncrona y llega con varios
 * cuadros de retraso -- de ahí que se informe un promedio móvil y no el
 * valor del cuadro actual, que todavía no existe.
 */
export class MedidorGpu {
  private readonly conjunto: GPUQuerySet | null;
  private readonly resolucion: GPUBuffer | null;
  private readonly lectura: GPUBuffer | null;
  private leyendo = false;
  private muestras: number[] = [];

  constructor(device: GPUDevice, habilitado: boolean) {
    if (!habilitado) {
      this.conjunto = null;
      this.resolucion = null;
      this.lectura = null;
      return;
    }
    this.conjunto = device.createQuerySet({ type: "timestamp", count: 2 });
    this.resolucion = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.lectura = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  get habilitado(): boolean {
    return this.conjunto !== null;
  }

  /** Se pasa al descriptor de la primera pasada del cuadro. */
  escrituras(): GPURenderPassTimestampWrites | undefined {
    if (!this.conjunto) return undefined;
    return { querySet: this.conjunto, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  /** Se llama con el encoder del cuadro, antes de enviarlo. */
  resolver(encoder: GPUCommandEncoder): void {
    if (!this.conjunto || !this.resolucion || !this.lectura) return;
    encoder.resolveQuerySet(this.conjunto, 0, 2, this.resolucion, 0);
    // Si todavía se está leyendo la vuelta anterior, saltear: copiar a
    // un buffer mapeado es un error de validación.
    if (!this.leyendo) encoder.copyBufferToBuffer(this.resolucion, 0, this.lectura, 0, 16);
  }

  /** Se llama después de enviar el cuadro. No bloquea. */
  async recoger(): Promise<void> {
    if (!this.lectura || this.leyendo) return;
    this.leyendo = true;
    try {
      await this.lectura.mapAsync(GPUMapMode.READ);
      const marcas = new BigUint64Array(this.lectura.getMappedRange().slice(0));
      this.lectura.unmap();
      // Las marcas vienen en nanosegundos.
      const ms = Number(marcas[1] - marcas[0]) / 1e6;
      if (ms > 0 && ms < 1000) {
        this.muestras.push(ms);
        if (this.muestras.length > 90) this.muestras.shift();
      }
    } catch {
      /* el buffer puede quedar inválido al redimensionar; no es fatal */
    } finally {
      this.leyendo = false;
    }
  }

  /** Promedio móvil en milisegundos, o null si todavía no hay datos. */
  get promedioMs(): number | null {
    if (this.muestras.length < 8) return null;
    return this.muestras.reduce((a, b) => a + b, 0) / this.muestras.length;
  }
}

/**
 * Crea (o recrea) una textura HDR del tamaño del canvas. Devuelve null
 * si el tamaño es degenerado, que pasa al minimizar la ventana.
 */
export function crearTexturaHDR(
  device: GPUDevice,
  formato: GPUTextureFormat,
  ancho: number,
  alto: number,
): GPUTexture | null {
  if (ancho < 1 || alto < 1) return null;
  return device.createTexture({
    size: { width: ancho, height: alto },
    format: formato,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}
