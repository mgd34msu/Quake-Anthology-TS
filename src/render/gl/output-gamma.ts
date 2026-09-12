import type { loadGl } from "../../platform/gl.ts";
import { loadGlFramebuffers } from "../../platform/gl-framebuffers.ts";
import { loadGlPrograms } from "../../platform/gl-programs.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import { compileProgram } from "./programs.ts";
import { withPixelStore } from "./textures.ts";

type Gl = ReturnType<typeof loadGl>["symbols"];
const vertex = `#version 120
varying vec2 tc;
void main() { tc = gl_MultiTexCoord0.xy; gl_Position = gl_Vertex; }
`;
const fragment = `#version 120
uniform sampler2D rawColor;
uniform sampler2D gammaTable;
varying vec2 tc;
float corrected(float value) {
  return texture2D(gammaTable, vec2((floor(clamp(value, 0.0, 1.0) * 255.0 + 0.5) + 0.5) / 256.0, 0.5)).r;
}
void main() {
  vec4 color = texture2D(rawColor, tc);
  gl_FragColor = vec4(corrected(color.r), corrected(color.g), corrected(color.b), color.a);
}
`;
function value(values: Int32Array | Uint32Array, index = 0): number {
  const result = values[index];
  if (result === undefined) throw new Error("OpenGL gamma state is incomplete");
  return result;
}

/** Raw color buffers share the source framebuffer's depth/stencil across draw-buffer changes. */
export class GlOutputGamma {
  private readonly framebuffers;
  private readonly shaders;
  private readonly target = new Uint32Array(1);
  private readonly depth = new Uint32Array(1);
  private readonly table = new Uint32Array(1);
  private readonly colors = new Map<number, Uint32Array>();
  private readonly program: number;
  private readonly rawUniform: number;
  private readonly tableUniform: number;
  private readonly depthInternal: number;
  private readonly depthFormat: number;
  private readonly depthType: number;
  private readonly mask: number;
  private width = 0;
  private height = 0;

  constructor(context: SdlRenderContext, private readonly gl: Gl, private readonly precision: {
    readonly depthBits: number; readonly stencilBits: number; readonly colorBits: number; readonly alphaBits: number;
  }, table: Uint8Array) {
    this.framebuffers = loadGlFramebuffers(context);
    try { this.shaders = loadGlPrograms(context); }
    catch (error) { this.framebuffers.close(); throw error; }
    let program = 0;
    try {
      const fbo = this.framebuffers.symbols;
      const component = new Int32Array(1);
      fbo.glGetFramebufferAttachmentParameteriv(0x8d40, 0x1801, 0x8211, component);
      const floating = value(component) === 0x1406;
      this.depthInternal = precision.stencilBits > 0 ? floating ? 0x8cad : 0x88f0
        : floating ? 0x8cac : precision.depthBits <= 16 ? 0x81a5 : precision.depthBits <= 24 ? 0x81a6 : 0x81a7;
      this.depthFormat = precision.stencilBits > 0 ? 0x84f9 : 0x1902;
      this.depthType = precision.stencilBits > 0 ? floating ? 0x8dad : 0x84fa : floating ? 0x1406 : 0x1405;
      this.mask = 0x4000 | 0x100 | (precision.stencilBits > 0 ? 0x400 : 0);
      fbo.glGenFramebuffers(1, this.target);
      gl.glGenTextures(1, this.depth); gl.glGenTextures(1, this.table);
      if (value(this.target) === 0 || value(this.depth) === 0 || value(this.table) === 0) throw new Error("OpenGL gamma allocation failed");
      program = compileProgram(this.shaders, vertex, fragment);
      this.program = program;
      this.rawUniform = this.uniform("rawColor"); this.tableUniform = this.uniform("gammaTable");
      this.update(table);
    } catch (error) {
      if (program !== 0) this.shaders.symbols.glDeleteProgram(program);
      this.framebuffers.symbols.glDeleteFramebuffers(1, this.target);
      gl.glDeleteTextures(1, this.depth); gl.glDeleteTextures(1, this.table);
      this.shaders.close(); this.framebuffers.close(); throw error;
    }
  }

  private integer(name: number, count = 1): Int32Array {
    const values = new Int32Array(count); this.gl.glGetIntegerv(name, values); return values;
  }
  private uniform(name: string): number {
    const location = this.shaders.symbols.glGetUniformLocation(this.program, new TextEncoder().encode(`${name}\0`));
    if (location < 0) throw new Error(`OpenGL gamma uniform is missing: ${name}`);
    return location;
  }
  private texture(name: number, action: () => void): void {
    const gl = this.gl, active = value(this.integer(0x84e0)); gl.glActiveTexture(0x84c0);
    const previous = value(this.integer(0x8069));
    try {
      gl.glBindTexture(0xde1, name);
      gl.glTexParameteri(0xde1, 0x2801, 0x2600); gl.glTexParameteri(0xde1, 0x2800, 0x2600);
      gl.glTexParameteri(0xde1, 0x2802, 0x812f); gl.glTexParameteri(0xde1, 0x2803, 0x812f);
      action();
    } finally { gl.glBindTexture(0xde1, previous); gl.glActiveTexture(active); }
  }
  update(table: Uint8Array): void {
    this.texture(value(this.table), () => withPixelStore(this.gl, "unpack", () =>
      this.gl.glTexImage2D(0xde1, 0, 0x8040, 256, 1, 0, 0x1909, 0x1401, table)));
  }
  private blit(mask: number): void {
    const gl = this.gl, scissor = gl.glIsEnabled(0xc11) !== 0;
    gl.glDisable(0xc11);
    try { this.framebuffers.symbols.glBlitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, mask, 0x2600); }
    finally { if (scissor) gl.glEnable(0xc11); }
  }

  bind(buffer: number, width: number, height: number): boolean {
    let changed = false;
    const gl = this.gl, fbo = this.framebuffers.symbols;
    if (width !== this.width || height !== this.height) {
      changed = true;
      for (const color of this.colors.values()) gl.glDeleteTextures(1, color);
      this.colors.clear(); this.width = width; this.height = height;
      this.texture(value(this.depth), () => fbo.glTexImage2D(0xde1, 0, this.depthInternal, width, height, 0, this.depthFormat, this.depthType, null));
    }
    let color = this.colors.get(buffer);
    const initializeDepth = this.colors.size === 0;
    if (color === undefined) {
      changed = true;
      color = new Uint32Array(1); gl.glGenTextures(1, color);
      if (value(color) === 0) throw new Error("OpenGL gamma color allocation failed");
      this.colors.set(buffer, color);
      this.texture(value(color), () => fbo.glTexImage2D(0xde1, 0, this.precision.alphaBits > 0 ? 0x8058 : this.precision.colorBits <= 16 ? 0x8d62 : 0x8051,
        width, height, 0, 0x1908, 0x1401, null));
      fbo.glBindFramebuffer(0x8d40, value(this.target));
      fbo.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, value(color), 0);
      fbo.glFramebufferTexture2D(0x8d40, this.precision.stencilBits > 0 ? 0x821a : 0x8d00, 0xde1, value(this.depth), 0);
      gl.glDrawBuffer(0x8ce0); fbo.glReadBuffer(0x8ce0);
      const status = fbo.glCheckFramebufferStatus(0x8d40);
      if (status !== 0x8cd5) throw new Error(`OpenGL gamma framebuffer incomplete: 0x${status.toString(16)}`);
      fbo.glBindFramebuffer(0x8ca8, 0); fbo.glReadBuffer(buffer);
      this.blit(initializeDepth ? this.mask : 0x4000);
    }
    fbo.glBindFramebuffer(0x8d40, value(this.target));
    fbo.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, value(color), 0);
    gl.glDrawBuffer(0x8ce0); fbo.glReadBuffer(0x8ce0);
    return changed;
  }

  selectDefault(buffer: number): void {
    const fbo = this.framebuffers.symbols;
    fbo.glBindFramebuffer(0x8d40, 0); this.gl.glDrawBuffer(buffer); fbo.glReadBuffer(buffer);
  }

  finish(buffer: number): void {
    const gl = this.gl, shader = this.shaders.symbols, fbo = this.framebuffers.symbols;
    const oldProgram = value(this.integer(0x8b8d)), active = value(this.integer(0x84e0));
    const viewport = this.integer(0xba2, 4), colorMask = this.integer(0xc23, 4), depthMask = value(this.integer(0xb72));
    const modes = this.integer(0xb40, 2);
    const enables = [0xb71, 0xb44, 0xbc0, 0xb90, 0x3000, 0xc11, 0xbe2, 0xbd0, 0x8037].map(name => ({ name, enabled: gl.glIsEnabled(name) !== 0 }));
    gl.glActiveTexture(0x84c0); const texture0 = value(this.integer(0x8069));
    gl.glActiveTexture(0x84c1); const texture1 = value(this.integer(0x8069));
    try {
      fbo.glBindFramebuffer(0x8d40, 0);
      gl.glViewport(0, 0, this.width, this.height); gl.glDepthMask(0); gl.glColorMask(1, 1, 1, 1); gl.glPolygonMode(0x408, 0x1b02);
      for (const { name } of enables) gl.glDisable(name);
      shader.glUseProgram(this.program); shader.glUniform1i(this.rawUniform, 0); shader.glUniform1i(this.tableUniform, 1);
      gl.glBindTexture(0xde1, value(this.table));
      gl.glActiveTexture(0x84c0);
      for (const [drawBuffer, color] of this.colors) {
        gl.glDrawBuffer(drawBuffer); gl.glBindTexture(0xde1, value(color));
        gl.glBegin(7);
        gl.glTexCoord2f(0, 0); gl.glVertex4f(-1, -1, 0, 1);
        gl.glTexCoord2f(1, 0); gl.glVertex4f(1, -1, 0, 1);
        gl.glTexCoord2f(1, 1); gl.glVertex4f(1, 1, 0, 1);
        gl.glTexCoord2f(0, 1); gl.glVertex4f(-1, 1, 0, 1);
        gl.glEnd();
      }
    } finally {
      gl.glBindTexture(0xde1, texture0); gl.glActiveTexture(0x84c1); gl.glBindTexture(0xde1, texture1); gl.glActiveTexture(active);
      shader.glUseProgram(oldProgram); gl.glDepthMask(depthMask); gl.glColorMask(value(colorMask, 0), value(colorMask, 1), value(colorMask, 2), value(colorMask, 3));
      gl.glPolygonMode(0x404, value(modes, 0)); gl.glPolygonMode(0x405, value(modes, 1));
      gl.glViewport(value(viewport, 0), value(viewport, 1), value(viewport, 2), value(viewport, 3));
      for (const { name, enabled } of enables) { if (enabled) gl.glEnable(name); else gl.glDisable(name); }
      gl.glDrawBuffer(buffer); fbo.glReadBuffer(buffer);
    }
  }

  restore(buffer: number): void {
    const fbo = this.framebuffers.symbols;
    for (const [drawBuffer, color] of this.colors) {
      fbo.glBindFramebuffer(0x8ca8, value(this.target));
      fbo.glFramebufferTexture2D(0x8ca8, 0x8ce0, 0xde1, value(color), 0); fbo.glReadBuffer(0x8ce0);
      fbo.glBindFramebuffer(0x8ca9, 0); this.gl.glDrawBuffer(drawBuffer); this.blit(this.mask);
    }
    fbo.glBindFramebuffer(0x8d40, 0); this.gl.glDrawBuffer(buffer); fbo.glReadBuffer(buffer);
  }
  close(): void {
    this.framebuffers.symbols.glBindFramebuffer(0x8d40, 0);
    for (const color of this.colors.values()) this.gl.glDeleteTextures(1, color);
    this.colors.clear(); this.gl.glDeleteTextures(1, this.depth); this.gl.glDeleteTextures(1, this.table);
    this.framebuffers.symbols.glDeleteFramebuffers(1, this.target);
    this.shaders.symbols.glDeleteProgram(this.program); this.shaders.close(); this.framebuffers.close();
  }
}
