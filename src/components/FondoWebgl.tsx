import { useEffect, useRef } from "react";
import type { FondoBracketWebgl } from "../types/tournaments";

// Migración 213, a pedido del usuario: 5 fondos animados con WebGL de
// verdad (shader + bloom real) para bracket y lineup, en vez del motor
// CSS de siempre (radial-gradient en mosaico + @keyframes, ver
// halcon.css) -- el usuario probó un prototipo con eso primero
// ("evoluciona los fondos actuales... para ver si vale la pena") y
// pidió más: "incorpora webgl". Usa WebGL1 sin ninguna librería (nunca
// se instaló Three.js/OGL a propósito -- un shader de un solo quad de
// pantalla completa no necesita una librería de escena 3D) y
// preserveDrawingBuffer:true para que "Compartir imagen"
// (html-to-image) siga capturando el canvas bien -- un WebGL sin eso
// limpia su buffer después de cada frame y la captura sale en blanco,
// que fue justo la razón por la que un intento anterior de WebGL en
// este proyecto se descartó (ver el historial de "Fuego" en halcon.css).

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const UTILS = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = sin(dot(p, vec2(41.0, 289.0)));
  return fract(vec2(262144.0, 32768.0) * n);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
`;

// Los 5 shaders de escena -- cada uno pintado en HDR (valores que
// pueden pasarse de 1.0 en los núcleos brillantes), para que el pase
// de bloom de más abajo los infle en un brillo real, no un simple
// recorte plano.
const SCENES: Record<FondoBracketWebgl, string> = {
  nebulosa: UTILS + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.6 + vec2(u_time * 0.015, -u_time * 0.01);
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + u_time * 0.008), fbm(p + 3.5 * q + vec2(8.3, 2.8) - u_time * 0.006));
  float f = fbm(p + 3.5 * r);

  vec3 color = vec3(0.012, 0.01, 0.045);
  color = mix(color, vec3(0.18, 0.1, 0.55), smoothstep(0.15, 0.55, f));
  color = mix(color, vec3(0.05, 0.35, 0.45), smoothstep(0.35, 0.7, length(q) * 0.9));
  color = mix(color, vec3(0.85, 0.15, 0.55), smoothstep(0.55, 0.85, length(r) * 0.8));
  float core = smoothstep(0.78, 1.0, f);
  color += vec3(1.1, 0.55, 0.65) * core * 1.6;

  float vig = smoothstep(1.2, 0.2, length(uv - 0.5));
  color *= 0.35 + 0.75 * vig;

  float sf = hash21(floor(gl_FragCoord.xy / 2.0));
  float star = smoothstep(0.994, 1.0, sf) * (0.5 + 0.5 * sin(u_time * 2.5 + sf * 400.0));
  color += vec3(1.4, 1.5, 1.8) * star;

  gl_FragColor = vec4(color, 1.0);
}`,

  campo_estelar: UTILS + `
float starLayer(vec2 uv, float scale, float speed, float density, float sizeMin, float sizeMax, float brightness, float seedOff) {
  vec2 p = uv * scale; p.y += u_time * speed;
  vec2 cell = floor(p); vec2 f = fract(p);
  float h = hash21(cell + seedOff);
  if (h > density) return 0.0;
  vec2 starPos = hash22(cell + seedOff);
  float d = length(f - starPos);
  float size = mix(sizeMin, sizeMax, hash21(cell + 7.7 + seedOff));
  float star = smoothstep(size, 0.0, d);
  float twinkle = 0.5 + 0.5 * sin(u_time * (1.2 + h * 3.0) + h * 100.0);
  return star * brightness * (0.35 + 0.65 * twinkle);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.y;
  vec2 nebUv = gl_FragCoord.xy / u_resolution.xy * 2.0 + vec2(u_time * 0.006, -u_time * 0.004);
  float nf = fbm(nebUv);
  vec3 color = mix(vec3(0.01, 0.012, 0.035), vec3(0.06, 0.08, 0.16), smoothstep(0.3, 0.8, nf));

  float l1 = starLayer(uv, 8.0, 0.003, 0.14, 0.05, 0.12, 0.6, 0.0);
  float l2 = starLayer(uv, 16.0, 0.008, 0.11, 0.04, 0.1, 1.0, 11.0);
  float l3 = starLayer(uv, 30.0, 0.018, 0.07, 0.025, 0.07, 1.6, 23.0);

  color += vec3(0.55, 0.65, 1.0) * l1;
  color += vec3(0.8, 0.85, 1.0) * l2;
  color += vec3(1.3, 1.3, 1.5) * l3;

  gl_FragColor = vec4(color, 1.0);
}`,

  aurora: UTILS + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 color = vec3(0.01, 0.012, 0.03);

  vec2 suv = gl_FragCoord.xy / u_resolution.y;
  float sf = hash21(floor(suv * 20.0));
  float star = smoothstep(0.985, 1.0, sf) * (0.5 + 0.5 * sin(u_time * 2.0 + sf * 300.0));
  color += vec3(0.8, 0.85, 1.0) * star * 0.8;

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float warp = fbm(vec2(uv.x * 2.2 + fi * 3.1, u_time * 0.08 + fi * 1.7));
    float band = sin((uv.x * 3.0 + warp * 2.5 + fi) * 3.14159 + u_time * 0.3);
    float height = 0.5 + 0.25 * sin(u_time * 0.15 + fi * 2.0);
    float dist = abs(uv.y - height - band * 0.18);
    float ribbon = smoothstep(0.18, 0.0, dist);
    vec3 ribbonColor = mix(vec3(0.1, 1.1, 0.6), vec3(0.5, 0.3, 1.1), fi / 2.0);
    color += ribbonColor * ribbon * 1.1;
  }

  float vig = smoothstep(1.1, 0.3, length(uv - vec2(0.5, 0.6)));
  color *= 0.4 + 0.7 * vig;
  gl_FragColor = vec4(color, 1.0);
}`,

  supernova: UTILS + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float noiseDistort = fbm(vec2(a * 2.0, u_time * 0.1)) * 0.3;
  float ringR = 0.25 + 0.05 * sin(u_time * 0.4) + noiseDistort * 0.4;
  float ring = smoothstep(0.42 + noiseDistort, 0.0, abs(r - ringR));

  vec3 core = vec3(1.8, 1.4, 1.0) * smoothstep(0.14, 0.0, r);
  vec3 mid = mix(vec3(1.2, 0.4, 0.1), vec3(0.9, 0.15, 0.5), smoothstep(0.1, 0.4, r)) * ring;
  vec3 outer = vec3(0.05, 0.08, 0.25) * smoothstep(0.2, 0.9, r);

  vec3 color = outer + mid * 1.3 + core;

  float sf = hash21(floor(gl_FragCoord.xy / 2.0));
  float star = smoothstep(0.996, 1.0, sf);
  color += vec3(star) * smoothstep(0.35, 1.0, r);

  gl_FragColor = vec4(color, 1.0);
}`,

  infierno: UTILS + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * vec2(2.6, 3.2);
  vec2 warp = vec2(fbm(p * 1.3 + vec2(0.0, u_time * 0.35)), fbm(p * 1.3 + vec2(5.0, -u_time * 0.4)));
  p += (warp - 0.5) * 0.9;
  p.y -= u_time * 0.6;
  float f = fbm(p + fbm(p * 1.6 + u_time * 0.12) * 1.6);

  vec3 color = mix(vec3(0.02, 0.0, 0.0), vec3(0.65, 0.05, 0.0), smoothstep(0.18, 0.5, f));
  color = mix(color, vec3(1.05, 0.4, 0.02), smoothstep(0.5, 0.72, f));
  color = mix(color, vec3(1.3, 1.0, 0.4), smoothstep(0.75, 0.95, f));

  vec2 ep = uv * vec2(16.0, 11.0);
  ep.y += u_time * 1.3;
  vec2 cell = floor(ep); vec2 fcell = fract(ep);
  float eh = hash21(cell);
  vec2 emberPos = hash22(cell);
  float d = length(fcell - emberPos);
  float ember = smoothstep(0.055, 0.0, d) * step(0.86, eh);
  color += vec3(1.6, 0.7, 0.2) * ember * (0.6 + 0.4 * sin(u_time * 4.0 + eh * 50.0));

  float vig = smoothstep(1.0, 0.25, length(uv - vec2(0.5, 0.65)));
  color *= 0.45 + 0.6 * vig;
  gl_FragColor = vec4(color, 1.0);
}`,
};

const BRIGHTPASS = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 c = texture2D(u_tex, uv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float t = smoothstep(0.7, 1.4, lum);
  gl_FragColor = vec4(c * t, 1.0);
}`;

const BLUR = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_dir;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec3 sum = texture2D(u_tex, uv).rgb * 0.227027;
  vec2 off1 = u_dir * u_texel * 1.3846153846;
  vec2 off2 = u_dir * u_texel * 3.2307692308;
  sum += texture2D(u_tex, uv + off1).rgb * 0.3162162162;
  sum += texture2D(u_tex, uv - off1).rgb * 0.3162162162;
  sum += texture2D(u_tex, uv + off2).rgb * 0.0702702703;
  sum += texture2D(u_tex, uv - off2).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE = `
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_time;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 tonemap(vec3 c) {
  c *= 0.85;
  float a = 2.51, b = 0.03, cc = 2.43, d = 0.59, e = 0.14;
  return clamp((c * (a * c + b)) / (c * (cc * c + d) + e), 0.0, 1.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 scene = texture2D(u_scene, uv).rgb;
  vec3 bloom = texture2D(u_bloom, uv).rgb;
  vec3 color = scene + bloom * 1.15;
  color = tonemap(color);
  float grain = (hash21(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) * 0.02;
  color += grain;
  gl_FragColor = vec4(color, 1.0);
}`;

interface FBO {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

interface Props {
  variante: FondoBracketWebgl;
}

export default function FondoWebgl({ variante }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Detección de hardware/preferencia: sin WebGL, o con "menos
    // movimiento" pedido, no se monta el loop -- el contenedor ya
    // tiene su color de fondo oscuro de siempre (halcon.css), así que
    // no mostrar nada acá no deja la pantalla rota, solo sin el extra.
    const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gl = canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const floatExt = gl.getExtension("OES_texture_float");
    gl.getExtension("OES_texture_float_linear");
    const texType = floatExt ? gl.FLOAT : gl.UNSIGNED_BYTE;

    function compilar(tipo: number, fuente: string): WebGLShader {
      const sh = gl!.createShader(tipo)!;
      gl!.shaderSource(sh, fuente);
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
        const log = gl!.getShaderInfoLog(sh);
        gl!.deleteShader(sh);
        throw new Error(log ?? "Error de compilación de shader desconocido");
      }
      return sh;
    }
    function armarPrograma(fragSrc: string): WebGLProgram {
      const vs = compilar(gl!.VERTEX_SHADER, VERT);
      const fs = compilar(gl!.FRAGMENT_SHADER, fragSrc);
      const prog = gl!.createProgram()!;
      gl!.attachShader(prog, vs);
      gl!.attachShader(prog, fs);
      gl!.linkProgram(prog);
      gl!.deleteShader(vs);
      gl!.deleteShader(fs);
      if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
        const log = gl!.getProgramInfoLog(prog);
        gl!.deleteProgram(prog);
        throw new Error(log ?? "Error de link de programa desconocido");
      }
      return prog;
    }
    function crearFBO(w: number, h: number): FBO {
      const tex = gl!.createTexture()!;
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, texType, null);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      const fbo = gl!.createFramebuffer()!;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      return { fbo, tex };
    }
    function borrarFBO(f: FBO | null) {
      if (!f) return;
      gl!.deleteFramebuffer(f.fbo);
      gl!.deleteTexture(f.tex);
    }

    let destruido = false;
    let rafId: number | null = null;
    let progScene: WebGLProgram | null = null;
    const progBright = armarPrograma(BRIGHTPASS);
    const progBlur = armarPrograma(BLUR);
    const progComposite = armarPrograma(COMPOSITE);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    function dibujarQuad(prog: WebGLProgram) {
      gl!.useProgram(prog);
      const posLoc = gl!.getAttribLocation(prog, "a_pos");
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf);
      gl!.enableVertexAttribArray(posLoc);
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }

    let fullW = 0;
    let fullH = 0;
    let halfW = 0;
    let halfH = 0;
    let sceneFBO: FBO | null = null;
    let brightFBO: FBO | null = null;
    let blurHFBO: FBO | null = null;
    let blurVFBO: FBO | null = null;

    function redimensionar() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (w === fullW && h === fullH) return;
      fullW = w;
      fullH = h;
      halfW = Math.max(1, Math.floor(w / 2));
      halfH = Math.max(1, Math.floor(h / 2));
      canvas!.width = w;
      canvas!.height = h;
      borrarFBO(sceneFBO);
      borrarFBO(brightFBO);
      borrarFBO(blurHFBO);
      borrarFBO(blurVFBO);
      sceneFBO = crearFBO(fullW, fullH);
      brightFBO = crearFBO(halfW, halfH);
      blurHFBO = crearFBO(halfW, halfH);
      blurVFBO = crearFBO(halfW, halfH);
    }

    // Pausa cuando no sirve de nada seguir dibujando: fuera de la
    // vista (IntersectionObserver), pestaña/ventana sin foco
    // (visibilitychange + blur/focus -- cubre tanto el navegador como
    // la app de escritorio, a diferencia de la clase CSS
    // "es-escritorio-sin-foco" que solo pausa animaciones CSS, nunca
    // un loop de JS como este).
    let visible = true;
    let conFoco = !document.hidden && document.hasFocus();

    const inicio = performance.now();

    function frame() {
      if (destruido) return;
      redimensionar();
      const t = (performance.now() - inicio) / 1000;

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, sceneFBO!.fbo);
      gl!.viewport(0, 0, fullW, fullH);
      gl!.useProgram(progScene!);
      gl!.uniform1f(gl!.getUniformLocation(progScene!, "u_time"), t);
      gl!.uniform2f(gl!.getUniformLocation(progScene!, "u_resolution"), fullW, fullH);
      dibujarQuad(progScene!);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, brightFBO!.fbo);
      gl!.viewport(0, 0, halfW, halfH);
      gl!.useProgram(progBright);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, sceneFBO!.tex);
      gl!.uniform1i(gl!.getUniformLocation(progBright, "u_tex"), 0);
      gl!.uniform2f(gl!.getUniformLocation(progBright, "u_resolution"), halfW, halfH);
      dibujarQuad(progBright);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, blurHFBO!.fbo);
      gl!.viewport(0, 0, halfW, halfH);
      gl!.useProgram(progBlur);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, brightFBO!.tex);
      gl!.uniform1i(gl!.getUniformLocation(progBlur, "u_tex"), 0);
      gl!.uniform2f(gl!.getUniformLocation(progBlur, "u_texel"), 1 / halfW, 1 / halfH);
      gl!.uniform2f(gl!.getUniformLocation(progBlur, "u_dir"), 1, 0);
      dibujarQuad(progBlur);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, blurVFBO!.fbo);
      gl!.viewport(0, 0, halfW, halfH);
      gl!.useProgram(progBlur);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, blurHFBO!.tex);
      gl!.uniform1i(gl!.getUniformLocation(progBlur, "u_tex"), 0);
      gl!.uniform2f(gl!.getUniformLocation(progBlur, "u_texel"), 1 / halfW, 1 / halfH);
      gl!.uniform2f(gl!.getUniformLocation(progBlur, "u_dir"), 0, 1);
      dibujarQuad(progBlur);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, fullW, fullH);
      gl!.useProgram(progComposite);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, sceneFBO!.tex);
      gl!.uniform1i(gl!.getUniformLocation(progComposite, "u_scene"), 0);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, blurVFBO!.tex);
      gl!.uniform1i(gl!.getUniformLocation(progComposite, "u_bloom"), 1);
      gl!.uniform2f(gl!.getUniformLocation(progComposite, "u_resolution"), fullW, fullH);
      gl!.uniform1f(gl!.getUniformLocation(progComposite, "u_time"), t);
      dibujarQuad(progComposite);

      if (visible && conFoco && !prefiereMenosMovimiento) {
        rafId = requestAnimationFrame(frame);
      } else {
        rafId = null;
      }
    }

    function asegurarLoopCorriendo() {
      if (rafId === null && visible && conFoco && !destruido) {
        rafId = requestAnimationFrame(frame);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) asegurarLoopCorriendo();
      },
      { threshold: 0 }
    );
    observer.observe(canvas);

    const alPerderFoco = () => {
      conFoco = false;
    };
    const alGanarFoco = () => {
      conFoco = true;
      asegurarLoopCorriendo();
    };
    const alCambiarVisibilidad = () => {
      if (document.hidden) alPerderFoco();
      else alGanarFoco();
    };
    window.addEventListener("blur", alPerderFoco);
    window.addEventListener("focus", alGanarFoco);
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    try {
      progScene = armarPrograma(SCENES[variante]);
      redimensionar();
      if (prefiereMenosMovimiento) {
        // Un solo frame estático, sin loop -- sigue corriendo todo el
        // pipeline (incluido el bloom) una vez, pero no programa el
        // próximo requestAnimationFrame.
        frame();
      } else {
        asegurarLoopCorriendo();
      }
    } catch (e) {
      console.error("Error armando el fondo WebGL:", e);
    }

    return () => {
      destruido = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("blur", alPerderFoco);
      window.removeEventListener("focus", alGanarFoco);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      borrarFBO(sceneFBO);
      borrarFBO(brightFBO);
      borrarFBO(blurHFBO);
      borrarFBO(blurVFBO);
      gl.deleteBuffer(quadBuf);
      if (progScene) gl.deleteProgram(progScene);
      gl.deleteProgram(progBright);
      gl.deleteProgram(progBlur);
      gl.deleteProgram(progComposite);
      // Libera el contexto de verdad -- sin esto, montar/desmontar
      // muchas veces (cambiar de pestaña en un picker, por ejemplo)
      // puede agotar el límite de contextos WebGL simultáneos del
      // navegador.
      const perderContexto = gl.getExtension("WEBGL_lose_context");
      perderContexto?.loseContext();
    };
    // Recompila todo el pipeline si cambia la variante -- más simple y
    // seguro que tratar de "parchear" solo el programa de escena en
    // caliente, y esto nunca se monta/desmonta con tanta frecuencia
    // como para que el costo de rearmar los programas compartidos
    // importe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variante]);

  return <canvas ref={canvasRef} className="fondo-webgl-canvas" aria-hidden="true" />;
}
