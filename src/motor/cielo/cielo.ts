import atmosferaWgsl from "./atmosfera.wgsl?raw";
import postWgsl from "../post/post.wgsl?raw";
import { crearTexturaHDR, MedidorGpu, type Dispositivo } from "../dispositivo";

// Orquestador del cielo físico.
//
// El reparto de costo es la clave de que esto sea barato en vivo:
//
//   - La tabla de TRANSMITANCIA no depende de nada que cambie. Se
//     calcula una sola vez al arrancar y no se toca más.
//   - La de DISPERSIÓN MÚLTIPLE tampoco. Una vez.
//   - La de VISTA DEL CIELO depende del sol, así que se recalcula solo
//     cuando el sol se mueve lo suficiente -- no en cada cuadro.
//   - Por cuadro queda apenas: consultar la tabla y mapear tonos.
//
// Es la misma lógica que el horneado de las escenas anteriores
// (calcular una vez lo que no cambia) pero llevada al pipeline.

const TAM_TRANSMITANCIA = { ancho: 256, alto: 64 };
const TAM_MULTIPLE = { ancho: 32, alto: 32 };
const TAM_VISTA = { ancho: 192, alto: 108 };

export interface OpcionesCielo {
  /** Hora del día, 0 a 24. Define la altura del sol. */
  hora: number;
  /** Intensidad del sol. */
  intensidad?: number;
  /** Exposición del mapeo de tonos. */
  exposicion?: number;
}

export class Cielo {
  private readonly d: Dispositivo;
  private readonly uniforme: GPUBuffer;
  private readonly uniformePost: GPUBuffer;
  private readonly muestreador: GPUSampler;

  private readonly lutTransmitancia: GPUTexture;
  private readonly lutMultiple: GPUTexture;
  private readonly lutVista: GPUTexture;

  private readonly pipeTransmitancia: GPURenderPipeline;
  private readonly pipeMultiple: GPURenderPipeline;
  private readonly pipeVista: GPURenderPipeline;
  private readonly pipeCielo: GPURenderPipeline;
  private readonly pipePost: GPURenderPipeline;

  // Un grupo POR PASADA, no uno compartido. WebGPU prohíbe que una
  // textura sea destino de escritura y binding de lectura en la misma
  // pasada, y con un solo grupo la tabla que se está generando queda
  // atada como lectura. En los huecos va una textura de 1x1: el shader
  // no la consulta, pero el layout exige algo ahí.
  private readonly grupoTransmitancia: GPUBindGroup;
  private readonly grupoMultiple: GPUBindGroup;
  private readonly grupoVista: GPUBindGroup;
  private readonly grupoCielo: GPUBindGroup;
  private readonly layoutPost: GPUBindGroupLayout;
  private grupoPost: GPUBindGroup | null = null;

  private hdr: GPUTexture | null = null;
  private anchoHdr = 0;
  private altoHdr = 0;

  private tablasBaseListas = false;
  private alturaSolVista = Number.NaN;

  readonly medidor: MedidorGpu;
  opciones: Required<OpcionesCielo>;

  constructor(d: Dispositivo, o: OpcionesCielo) {
    this.d = d;
    this.opciones = { intensidad: 18, exposicion: 1, ...o };
    this.medidor = new MedidorGpu(d.device, d.puedeMedir);

    const dev = d.device;
    this.uniforme = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniformePost = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // Filtrado lineal y borde repetido en x (el azimut da la vuelta),
    // sujeto en y (la elevación no).
    this.muestreador = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });

    const lut = (ancho: number, alto: number) =>
      dev.createTexture({
        size: { width: ancho, height: alto },
        // Las tablas también en coma flotante: la transmitancia tiene
        // valores muy chicos que en 8 bits se irían a cero.
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });

    this.lutTransmitancia = lut(TAM_TRANSMITANCIA.ancho, TAM_TRANSMITANCIA.alto);
    this.lutMultiple = lut(TAM_MULTIPLE.ancho, TAM_MULTIPLE.alto);
    this.lutVista = lut(TAM_VISTA.ancho, TAM_VISTA.alto);

    const modulo = dev.createShaderModule({ code: atmosferaWgsl, label: "atmosfera" });
    const moduloPost = dev.createShaderModule({ code: postWgsl, label: "post" });

    // Un solo layout para las cuatro pasadas de atmósfera: todas ven
    // las mismas tablas. Las que no usan alguna simplemente no la
    // consultan, y eso no cuesta nada.
    const layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const hacerPipe = (entrada: string, formato: GPUTextureFormat) =>
      dev.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: modulo, entryPoint: "vsPantalla" },
        fragment: { module: modulo, entryPoint: entrada, targets: [{ format: formato }] },
        primitive: { topology: "triangle-list" },
      });

    this.pipeTransmitancia = hacerPipe("fsTransmitancia", "rgba16float");
    this.pipeMultiple = hacerPipe("fsMultiple", "rgba16float");
    this.pipeVista = hacerPipe("fsVistaCielo", "rgba16float");
    this.pipeCielo = hacerPipe("fsCielo", d.formatoHDR);

    const vacia = dev
      .createTexture({
        size: { width: 1, height: 1 },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      .createView();

    const grupo = (t: GPUTextureView, m: GPUTextureView, v: GPUTextureView) =>
      dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.uniforme } },
          { binding: 1, resource: this.muestreador },
          { binding: 2, resource: t },
          { binding: 3, resource: m },
          { binding: 4, resource: v },
        ],
      });

    const vT = this.lutTransmitancia.createView();
    const vM = this.lutMultiple.createView();
    const vV = this.lutVista.createView();

    // Cada pasada ve solo las tablas que ya existen y que no está
    // escribiendo ella misma.
    this.grupoTransmitancia = grupo(vacia, vacia, vacia);
    this.grupoMultiple = grupo(vT, vacia, vacia);
    this.grupoVista = grupo(vT, vM, vacia);
    this.grupoCielo = grupo(vT, vM, vV);

    this.layoutPost = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    this.pipePost = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.layoutPost] }),
      vertex: { module: moduloPost, entryPoint: "vsPantalla" },
      fragment: { module: moduloPost, entryPoint: "fsPost", targets: [{ format: d.formato }] },
      primitive: { topology: "triangle-list" },
    });
  }

  /** Dirección del sol según la hora. Mediodía arriba, 6 y 18 en el horizonte. */
  private direccionSol(): [number, number, number] {
    const ang = ((this.opciones.hora - 6) / 12) * Math.PI;
    // Algo de inclinación en z para que el sol no recorra un plano
    // perfectamente vertical, que se ve artificial.
    return [Math.cos(ang) * 0.35, Math.sin(ang), -Math.cos(ang) * 0.94];
  }

  private escribirUniformes(ancho: number, alto: number, tiempo: number): void {
    const [sx, sy, sz] = this.direccionSol();
    const datos = new Float32Array(12);
    datos.set([sx, sy, sz, this.opciones.intensidad], 0);
    // La cámara a 1 km sobre el suelo: desde ahí el horizonte ya se
    // curva lo justo y el cielo no se ve "de maqueta".
    datos.set([0, 6361, 0, tiempo], 4);
    datos.set([ancho, alto, ancho / Math.max(alto, 1), this.opciones.exposicion], 8);
    this.d.device.queue.writeBuffer(this.uniforme, 0, datos);

    // EXPOSICIÓN ADAPTATIVA.
    //
    // La atmósfera es físicamente correcta, pero el rango real entre
    // mediodía y crepúsculo es brutal: medido, el cielo pasa de 51 de
    // brillo medio al atardecer a 0,8 siete minutos después. Con una
    // exposición fija calibrada para el día, la noche queda negra -- no
    // porque el modelo falle sino porque una cámara real abre el
    // diafragma, y el ojo se adapta.
    //
    // Se calcula de la altura del sol en vez de medir el cuadro
    // anterior: es estable (nada de pulsos al pasar una nube), no
    // cuesta una pasada de reducción, y para una cámara fija alcanza.
    const alturaSol = this.direccionSol()[1];
    // De 1x con el sol alto a 18x de noche cerrada. El smoothstep evita
    // el salto justo en el horizonte, que es donde más se notaría.
    const t01 = Math.min(Math.max((alturaSol + 0.22) / 0.42, 0), 1);
    const suave = t01 * t01 * (3 - 2 * t01);
    const expoAuto = 18 - 17 * suave;
    const post = new Float32Array([this.opciones.exposicion * expoAuto, ancho, alto, tiempo]);
    this.d.device.queue.writeBuffer(this.uniformePost, 0, post);
  }

  private pasada(
    encoder: GPUCommandEncoder,
    pipe: GPURenderPipeline,
    destino: GPUTextureView,
    grupo: GPUBindGroup,
    marcas?: GPURenderPassTimestampWrites,
  ): void {
    const p = encoder.beginRenderPass({
      colorAttachments: [{ view: destino, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      timestampWrites: marcas,
    });
    p.setPipeline(pipe);
    p.setBindGroup(0, grupo);
    p.draw(3);
    p.end();
  }

  private asegurarHdr(ancho: number, alto: number): boolean {
    if (this.hdr && this.anchoHdr === ancho && this.altoHdr === alto) return true;
    this.hdr?.destroy();
    this.hdr = crearTexturaHDR(this.d.device, this.d.formatoHDR, ancho, alto);
    if (!this.hdr) return false;
    this.anchoHdr = ancho;
    this.altoHdr = alto;
    this.grupoPost = this.d.device.createBindGroup({
      layout: this.layoutPost,
      entries: [
        { binding: 0, resource: { buffer: this.uniformePost } },
        { binding: 1, resource: this.muestreador },
        { binding: 2, resource: this.hdr.createView() },
      ],
    });
    return true;
  }

  render(ancho: number, alto: number, tiempo: number): void {
    if (!this.asegurarHdr(ancho, alto) || !this.hdr || !this.grupoPost) return;
    this.escribirUniformes(ancho, alto, tiempo);

    const dev = this.d.device;
    const encoder = dev.createCommandEncoder();

    // Las dos tablas base, una sola vez en toda la vida del motor.
    if (!this.tablasBaseListas) {
      this.pasada(encoder, this.pipeTransmitancia, this.lutTransmitancia.createView(), this.grupoTransmitancia);
      this.pasada(encoder, this.pipeMultiple, this.lutMultiple.createView(), this.grupoMultiple);
      this.tablasBaseListas = true;
    }

    // La vista del cielo solo si el sol se movió de verdad. Recalcular
    // 192x108 en cada cuadro sería gastar sin que se note.
    const alturaSol = this.direccionSol()[1];
    if (!(Math.abs(alturaSol - this.alturaSolVista) < 0.0015)) {
      this.pasada(encoder, this.pipeVista, this.lutVista.createView(), this.grupoVista);
      this.alturaSolVista = alturaSol;
    }

    // Composición en HDR, midiendo esta pasada.
    this.pasada(encoder, this.pipeCielo, this.hdr.createView(), this.grupoCielo, this.medidor.escrituras());

    // Y el mapeo de tonos al canvas.
    this.pasada(encoder, this.pipePost, this.d.contexto.getCurrentTexture().createView(), this.grupoPost);

    this.medidor.resolver(encoder);
    dev.queue.submit([encoder.finish()]);
    void this.medidor.recoger();
  }

  /** Fuerza recalcular la vista del cielo (p. ej. al cambiar la hora). */
  invalidarVista(): void {
    this.alturaSolVista = Number.NaN;
  }
}
