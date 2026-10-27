import atmosferaWgsl from "./atmosfera.wgsl?raw";
import nubesWgsl from "./nubes.wgsl?raw";
import volumenesWgsl from "./volumenes.wgsl?raw";
import postWgsl from "../post/post.wgsl?raw";
import { crearTexturaHDR, MedidorGpu, type Dispositivo } from "../dispositivo";

// Orquestador del cielo físico.
//
// El reparto de costo es la clave de que esto sea barato en vivo:
//
//   - Los VOLÚMENES DE RUIDO de las nubes se hornean una sola vez al
//     arrancar, en compute. Worley 3D por píxel sería impagable.
//   - La tabla de TRANSMITANCIA no depende de nada que cambie. Se
//     calcula una sola vez al arrancar y no se toca más.
//   - La de DISPERSIÓN MÚLTIPLE tampoco. Una vez.
//   - La de VISTA DEL CIELO depende de las luces, así que se recalcula
//     solo cuando el sol o la luna se mueven lo suficiente -- no en
//     cada cuadro.
//   - Por cuadro queda: la capa de nubes a media resolución, consultar
//     la tabla y mapear tonos.
//
// Es la misma lógica que el horneado de las escenas anteriores
// (calcular una vez lo que no cambia) pero llevada al pipeline.

const TAM_TRANSMITANCIA = { ancho: 256, alto: 64 };
const TAM_MULTIPLE = { ancho: 32, alto: 32 };
const TAM_VISTA = { ancho: 192, alto: 108 };

// 128^3 para la forma y 32^3 para el detalle. 8 MB y 128 KB: nada para
// una GPU, y es lo que convierte cada muestra de densidad en dos
// lecturas de textura en vez de ~4000 celdas de Worley.
const TAM_VOL_FORMA = 128;
const TAM_VOL_DETALLE = 32;

export interface OpcionesCielo {
  /** Hora del día, 0 a 24. Define la altura del sol. */
  hora: number;
  /** Intensidad del sol. */
  intensidad?: number;
  /** Exposición del mapeo de tonos. */
  exposicion?: number;
  /**
   * Hora de la luna, 0 a 24, en el mismo reloj que el sol. Si no se
   * pasa, la luna va casi opuesta al sol (hora + 12.4), que es lo que
   * hace que de noche esté arriba.
   */
  horaLuna?: number;
  /** Fase lunar: 0 nueva, 1 llena. */
  faseLuna?: number;
  /**
   * Intensidad de la luna con fase llena, contra los 18 del sol.
   *
   * Calibrado midiendo la imagen, no a ojo. Con 0.3 una nube iluminada
   * por luna llena daba (63,64,71) y la misma nube de dia (84,90,110):
   * la noche rendia casi tan clara como el dia y se leia como "dia con
   * filtro azul". Con 0.06 se fue al otro extremo, (23,22,25), una
   * noche practicamente ciega. Medidos esos dos puntos, la respuesta
   * resulto casi recta (y = 11.75 + 187.5 x para la nube), y 0.15 cae
   * donde se buscaba: la nube iluminada en torno a 45 y el cielo en
   * torno a 36 de azul, un tercio del dia.
   *
   * La proporcion real sol/luna es de unos 400.000 a 1, pero esa no es
   * la referencia: nadie mira una noche con la pupila de mediodia.
   */
  intensidadLuna?: number;
  /** Cobertura de nubes, 0 a 1. */
  nubes?: number;
  /** Densidad de las nubes (multiplicador). */
  densidadNubes?: number;
  /** Velocidad del viento en km/s. ~0.012 es una brisa real. */
  viento?: number;
  /**
   * Depuración: 0 apagado. Con 1 + z se pinta la rebanada z del
   * volumen de ruido horneado en lugar de las nubes. Es la única forma
   * de separar "el ruido está mal" de "el ruido está bien y el
   * raymarch lo usa mal", que de otro modo se diagnostica a ciegas.
   */
  depurarVolumen?: number;
}

export class Cielo {
  private readonly d: Dispositivo;
  private readonly uniforme: GPUBuffer;
  private readonly uniformePost: GPUBuffer;
  private readonly muestreador: GPUSampler;
  private readonly muestreadorVol: GPUSampler;

  private readonly lutTransmitancia: GPUTexture;
  private readonly lutMultiple: GPUTexture;
  private readonly lutVista: GPUTexture;
  private readonly volForma: GPUTexture;
  private readonly volDetalle: GPUTexture;

  private readonly pipeTransmitancia: GPURenderPipeline;
  private readonly pipeMultiple: GPURenderPipeline;
  private readonly pipeVista: GPURenderPipeline;
  private readonly pipeNubes: GPURenderPipeline;
  private readonly pipeCielo: GPURenderPipeline;
  private readonly pipePost: GPURenderPipeline;

  // Un grupo POR PASADA, no uno compartido. WebGPU prohíbe que una
  // textura sea destino de escritura y binding de lectura en la misma
  // pasada, y con un solo grupo la tabla que se está generando queda
  // atada como lectura. En los huecos va una textura de 1x1: el shader
  // no la consulta, pero el layout exige algo ahí.
  private readonly layoutAtmosfera: GPUBindGroupLayout;
  private readonly vistaVacia: GPUTextureView;
  private readonly grupoTransmitancia: GPUBindGroup;
  private readonly grupoMultiple: GPUBindGroup;
  private readonly grupoVista: GPUBindGroup;
  private readonly grupoNubes: GPUBindGroup;
  private readonly grupoVolumenes: GPUBindGroup;
  private grupoCielo: GPUBindGroup | null = null;
  private readonly layoutPost: GPUBindGroupLayout;
  private grupoPost: GPUBindGroup | null = null;

  private hdr: GPUTexture | null = null;
  private texNubes: GPUTexture | null = null;
  private anchoHdr = 0;
  private altoHdr = 0;

  private tablasBaseListas = false;
  private claveVista = Number.NaN;

  readonly medidor: MedidorGpu;
  opciones: Required<OpcionesCielo>;

  constructor(d: Dispositivo, o: OpcionesCielo) {
    this.d = d;
    this.opciones = {
      intensidad: 18,
      exposicion: 1,
      horaLuna: Number.NaN,
      faseLuna: 1,
      intensidadLuna: 0.15,
      nubes: 0.52,
      densidadNubes: 1,
      viento: 0.012,
      depurarVolumen: 0,
      ...o,
    };
    this.medidor = new MedidorGpu(d.device, d.puedeMedir);

    const dev = d.device;
    // 96 bytes: sol, luna, lunaColor, camara, pantalla, nubes.
    this.uniforme = dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniformePost = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // Filtrado lineal y borde repetido en x (el azimut da la vuelta),
    // sujeto en y (la elevación no).
    this.muestreador = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });
    // Los volúmenes se repiten en los tres ejes: están horneados
    // tileables justamente para poder hacerlo sin costura.
    this.muestreadorVol = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      addressModeW: "repeat",
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

    // rgba8unorm alcanza para el ruido: son cuatro campos de 0 a 1 que
    // luego se recombinan. En 16 bits ocuparía el doble sin que se note.
    const vol = (lado: number) =>
      dev.createTexture({
        size: { width: lado, height: lado, depthOrArrayLayers: lado },
        dimension: "3d",
        format: "rgba8unorm",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.volForma = vol(TAM_VOL_FORMA);
    this.volDetalle = vol(TAM_VOL_DETALLE);

    // Un solo módulo con la atmósfera Y las nubes: las nubes necesitan
    // el struct Comun, las tablas y el encuadre de cámara de la
    // atmósfera, y WGSL no tiene include.
    const modulo = dev.createShaderModule({ code: atmosferaWgsl + "\n" + nubesWgsl, label: "cielo" });
    const moduloPost = dev.createShaderModule({ code: postWgsl, label: "post" });
    const moduloVol = dev.createShaderModule({ code: volumenesWgsl, label: "volumenes" });

    // Un solo layout para las pasadas de atmósfera: todas ven las
    // mismas tablas. Las que no usan alguna simplemente no la
    // consultan, y eso no cuesta nada.
    this.layoutAtmosfera = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    // Grupo 1: los volúmenes. Va en un grupo aparte porque solo la
    // pasada de nubes los consulta, pero se ata en todas: atar un grupo
    // que el shader ignora no cuesta nada y evita tener dos layouts de
    // pipeline casi iguales.
    const layoutVol = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "3d" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "3d" } },
      ],
    });

    const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.layoutAtmosfera, layoutVol] });
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
    this.pipeNubes = hacerPipe("fsNubes", "rgba16float");
    this.pipeCielo = hacerPipe("fsCielo", d.formatoHDR);

    this.vistaVacia = dev
      .createTexture({
        size: { width: 1, height: 1 },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      .createView();

    const vT = this.lutTransmitancia.createView();
    const vM = this.lutMultiple.createView();
    const vV = this.lutVista.createView();
    const vac = this.vistaVacia;

    // Cada pasada ve solo las tablas que ya existen y que no está
    // escribiendo ella misma.
    this.grupoTransmitancia = this.grupoAtmosfera(vac, vac, vac, vac);
    this.grupoMultiple = this.grupoAtmosfera(vT, vac, vac, vac);
    this.grupoVista = this.grupoAtmosfera(vT, vM, vac, vac);
    this.grupoNubes = this.grupoAtmosfera(vT, vM, vV, vac);

    this.grupoVolumenes = dev.createBindGroup({
      layout: layoutVol,
      entries: [
        { binding: 0, resource: this.muestreadorVol },
        { binding: 1, resource: this.volForma.createView({ dimension: "3d" }) },
        { binding: 2, resource: this.volDetalle.createView({ dimension: "3d" }) },
      ],
    });

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

    this.hornearVolumenes(moduloVol);
  }

  private grupoAtmosfera(
    t: GPUTextureView,
    m: GPUTextureView,
    v: GPUTextureView,
    n: GPUTextureView,
  ): GPUBindGroup {
    return this.d.device.createBindGroup({
      layout: this.layoutAtmosfera,
      entries: [
        { binding: 0, resource: { buffer: this.uniforme } },
        { binding: 1, resource: this.muestreador },
        { binding: 2, resource: t },
        { binding: 3, resource: m },
        { binding: 4, resource: v },
        { binding: 5, resource: n },
      ],
    });
  }

  /**
   * Hornea los dos volúmenes de ruido. Se corre UNA VEZ en toda la vida
   * del motor, en el constructor, con su propio envío: no tiene sentido
   * arrastrar esto al bucle de cuadro.
   */
  private hornearVolumenes(moduloVol: GPUShaderModule): void {
    const dev = this.d.device;
    const encoder = dev.createCommandEncoder({ label: "hornear volumenes" });

    const correr = (entrada: string, destino: GPUTexture, lado: number) => {
      const pipe = dev.createComputePipeline({
        layout: "auto",
        compute: { module: moduloVol, entryPoint: entrada },
      });
      const grupo = dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: destino.createView({ dimension: "3d" }) }],
      });
      const p = encoder.beginComputePass();
      p.setPipeline(pipe);
      p.setBindGroup(0, grupo);
      // El grupo de trabajo es 4x4x4, así que el despacho es lado/4.
      const g = Math.ceil(lado / 4);
      p.dispatchWorkgroups(g, g, g);
      p.end();
    };

    correr("csForma", this.volForma, TAM_VOL_FORMA);
    correr("csDetalle", this.volDetalle, TAM_VOL_DETALLE);
    dev.queue.submit([encoder.finish()]);
  }

  /** Dirección del sol según la hora. Mediodía arriba, 6 y 18 en el horizonte. */
  private direccionSol(): [number, number, number] {
    return this.direccionAstro(this.opciones.hora);
  }

  /**
   * Dirección de la luna. Por omisión va 12,4 horas detrás del sol: no
   * exactamente opuesta, porque un astro perfectamente antipodal se ve
   * artificial, y 12,4 además deja la luna alta en plena noche.
   */
  private direccionLuna(): [number, number, number] {
    const h = Number.isNaN(this.opciones.horaLuna) ? this.opciones.hora + 12.4 : this.opciones.horaLuna;
    const [x, y, z] = this.direccionAstro(h);
    // Un poco de inclinación distinta a la del sol, para que las dos
    // órbitas no se superpongan exactamente en el cielo.
    return [x * 0.78 - z * 0.2, y, z * 0.78 + x * 0.2];
  }

  private direccionAstro(hora: number): [number, number, number] {
    const ang = ((hora - 6) / 12) * Math.PI;
    // Algo de inclinación en z para que el astro no recorra un plano
    // perfectamente vertical, que se ve artificial.
    return [Math.cos(ang) * 0.35, Math.sin(ang), -Math.cos(ang) * 0.94];
  }

  /** Brillo relativo de la luna por su fase. */
  private brilloFase(): number {
    const f = Math.min(Math.max(this.opciones.faseLuna, 0), 1);
    // Exponente 1.5 y no lineal: una luna llena ilumina mucho más que
    // dos cuartos, por el efecto de oposición. Al cuadrado, que es lo
    // primero que probé, un cuarto creciente quedaba ocho veces más
    // oscuro que la llena y la escena se volvía inservible como fondo.
    // 1.5 mantiene la diferencia legible sin apagarla.
    return Math.pow(f, 1.5);
  }

  /**
   * Cuánta luz de luna hay realmente. De día se apaga: la luna sigue
   * en el cielo y su disco se dibuja, pero no aporta iluminación que
   * compita con el sol.
   */
  private luzLuna(): number {
    const sy = this.direccionSol()[1];
    const t = Math.min(Math.max((sy + 0.04) / 0.14, 0), 1);
    const diurno = 1 - t * t * (3 - 2 * t);
    return this.brilloFase() * diurno;
  }

  private escribirUniformes(ancho: number, alto: number, tiempo: number): void {
    const [sx, sy, sz] = this.direccionSol();
    const [lx, ly, lz] = this.direccionLuna();
    const luzLuna = this.luzLuna();

    const datos = new Float32Array(24);
    datos.set([sx, sy, sz, this.opciones.intensidad], 0);
    datos.set([lx, ly, lz, this.opciones.intensidadLuna * luzLuna], 4);
    // Color de la luz lunar: levemente frío, como pidió el usuario. La
    // luna real es de un gris pardo, pero el ojo adaptado a la
    // oscuridad desplaza su sensibilidad al azul (efecto Purkinje), así
    // que una noche de luna SE PERCIBE azulada. El color va donde
    // corresponde: en la luz, no en un filtro encima de la imagen.
    //
    // Es un frío CONTENIDO (0.86, 0.90, 1.00) y no el (0.74, 0.84,
    // 1.00) del primer intento: el cielo nocturno ya es azul por la
    // dispersión de Rayleigh de esta misma luz, y teñir además la luz
    // sumaba los dos azules. El resultado era un cielo azul eléctrico,
    // más de día nublado que de noche.
    datos.set([0.86, 0.9, 1.0, Math.min(Math.max(this.opciones.faseLuna, 0), 1)], 8);
    // La cámara a 1 km sobre el suelo: desde ahí el horizonte ya se
    // curva lo justo y el cielo no se ve "de maqueta".
    datos.set([0, 6361, 0, tiempo], 12);
    datos.set([ancho, alto, ancho / Math.max(alto, 1), this.opciones.exposicion], 16);
    datos.set([this.opciones.nubes, this.opciones.densidadNubes, this.opciones.viento, this.opciones.depurarVolumen], 20);
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
    // Se calcula de la altura de los astros en vez de medir el cuadro
    // anterior: es estable (nada de pulsos al pasar una nube), no
    // cuesta una pasada de reducción, y para una cámara fija alcanza.
    const t01 = Math.min(Math.max((sy + 0.22) / 0.42, 0), 1);
    const suave = t01 * t01 * (3 - 2 * t01);
    const expoSol = 18 - 17 * suave;
    // LA LUNA CIERRA EL DIAFRAGMA. Una noche de luna llena no se ve
    // igual de oscura que una noche sin luna: hay luz, y la cámara (o
    // el ojo) no necesita abrirse tanto. Sin esto, la exposición
    // nocturna fija de 18x sobre una escena ya iluminada por la luna
    // dejaría el cielo lavado y el disco recortado en blanco.
    const expoAuto = expoSol / (1 + 2.6 * Math.max(0, ly) * luzLuna);
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
    p.setBindGroup(1, this.grupoVolumenes);
    p.draw(3);
    p.end();
  }

  private asegurarDestinos(ancho: number, alto: number): boolean {
    if (this.hdr && this.anchoHdr === ancho && this.altoHdr === alto) return true;
    this.hdr?.destroy();
    this.texNubes?.destroy();
    this.hdr = crearTexturaHDR(this.d.device, this.d.formatoHDR, ancho, alto);
    if (!this.hdr) return false;
    // Media resolución para las nubes: cuesta la cuarta parte y, siendo
    // una capa de baja frecuencia, el upsample bilineal no se nota.
    this.texNubes = crearTexturaHDR(
      this.d.device,
      "rgba16float",
      Math.max(1, ancho >> 1),
      Math.max(1, alto >> 1),
    );
    if (!this.texNubes) return false;
    this.anchoHdr = ancho;
    this.altoHdr = alto;

    this.grupoCielo = this.grupoAtmosfera(
      this.lutTransmitancia.createView(),
      this.lutMultiple.createView(),
      this.lutVista.createView(),
      this.texNubes.createView(),
    );
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
    if (!this.asegurarDestinos(ancho, alto)) return;
    if (!this.hdr || !this.texNubes || !this.grupoPost || !this.grupoCielo) return;
    this.escribirUniformes(ancho, alto, tiempo);

    const dev = this.d.device;
    const encoder = dev.createCommandEncoder();

    // Las dos tablas base, una sola vez en toda la vida del motor.
    if (!this.tablasBaseListas) {
      this.pasada(encoder, this.pipeTransmitancia, this.lutTransmitancia.createView(), this.grupoTransmitancia);
      this.pasada(encoder, this.pipeMultiple, this.lutMultiple.createView(), this.grupoMultiple);
      this.tablasBaseListas = true;
    }

    // La vista del cielo solo si alguna de las dos luces se movió de
    // verdad. Recalcular 192x108 en cada cuadro sería gastar sin que se
    // note. La clave mezcla las dos alturas porque ahora la tabla
    // depende del sol Y de la luna.
    const clave = this.direccionSol()[1] * 1000 + this.direccionLuna()[1] * 31 + this.luzLuna();
    if (!(Math.abs(clave - this.claveVista) < 0.0015)) {
      this.pasada(encoder, this.pipeVista, this.lutVista.createView(), this.grupoVista);
      this.claveVista = clave;
    }

    // Las nubes, a media resolución. Se mide ESTA pasada porque es la
    // más caliente de todo el cuadro con diferencia.
    this.pasada(encoder, this.pipeNubes, this.texNubes.createView(), this.grupoNubes, this.medidor.escrituras());

    // Composición en HDR: cielo, discos del sol y de la luna, nubes.
    this.pasada(encoder, this.pipeCielo, this.hdr.createView(), this.grupoCielo);

    // Y el mapeo de tonos al canvas.
    this.pasada(encoder, this.pipePost, this.d.contexto.getCurrentTexture().createView(), this.grupoPost);

    this.medidor.resolver(encoder);
    dev.queue.submit([encoder.finish()]);
    void this.medidor.recoger();
  }

  /** Fuerza recalcular la vista del cielo (p. ej. al cambiar la hora). */
  invalidarVista(): void {
    this.claveVista = Number.NaN;
  }
}
