// SPDX-License-Identifier: GPL-2.0-or-later
import type { loadGl } from "../../platform/gl.ts";
import { loadGlFramebuffers } from "../../platform/gl-framebuffers.ts";
import { loadGlPrograms } from "../../platform/gl-programs.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import { compileProgram } from "./programs.ts";

type Gl = ReturnType<typeof loadGl>["symbols"];
function value(values: Int32Array | Uint32Array, index = 0): number {
  const result = values[index];
  if (result === undefined) throw new Error("OpenGL opacity state is incomplete");
  return result;
}
const vertex = `#version 120
varying vec2 tc;
void main() { tc = gl_Vertex.xy * 0.5 + 0.5; gl_Position = gl_Vertex; }
`;
const fragment = `#version 120
uniform sampler2D backdrop;
uniform sampler2D result;
uniform float opacity;
varying vec2 tc;
void main() {
  vec4 b = texture2D(backdrop, tc);
  gl_FragColor = b + opacity * (texture2D(result, tc) - b);
}
`;

/** Private scratch storage; child draws keep the renderer's live image registry. */
export class GlObjectOpacity {
  private readonly framebuffers;
  private readonly shaders;
  private readonly targets = new Uint32Array(2);
  private readonly colors = new Uint32Array(2);
  private readonly depth = new Uint32Array(1);
  private readonly program: number;
  private readonly backdropUniform: number;
  private readonly resultUniform: number;
  private readonly opacityUniform: number;
  private dimensions = "";
  private active = false;

  constructor(context: SdlRenderContext, private readonly gl: Gl, private readonly precision: {
    readonly depthBits: number; readonly stencilBits: number; readonly colorBits: number; readonly alphaBits: number;
  }) {
    this.framebuffers = loadGlFramebuffers(context);
    try { this.shaders = loadGlPrograms(context); }
    catch (error) { this.framebuffers.close(); throw error; }
    let program = 0;
    try {
      this.framebuffers.symbols.glGenFramebuffers(2, this.targets);
      gl.glGenTextures(2, this.colors); gl.glGenTextures(1, this.depth);
      if ([...this.targets, ...this.colors, ...this.depth].some(name => name === 0)) throw new Error("OpenGL opacity allocation failed");
      program = compileProgram(this.shaders, vertex, fragment); this.program = program;
      this.backdropUniform = this.uniform("backdrop"); this.resultUniform = this.uniform("result"); this.opacityUniform = this.uniform("opacity");
    } catch (error) {
      if (program !== 0) this.shaders.symbols.glDeleteProgram(program);
      this.framebuffers.symbols.glDeleteFramebuffers(2, this.targets);
      gl.glDeleteTextures(2, this.colors); gl.glDeleteTextures(1, this.depth);
      this.shaders.close(); this.framebuffers.close(); throw error;
    }
  }

  private integer(name: number, count = 1): Int32Array {
    const result = new Int32Array(count); this.gl.glGetIntegerv(name, result); return result;
  }
  private uniform(name: string): number {
    const location = this.shaders.symbols.glGetUniformLocation(this.program, new TextEncoder().encode(`${name}\0`));
    if (location < 0) throw new Error(`OpenGL opacity uniform missing: ${name}`);
    return location;
  }
  private check(): void {
    const status = this.framebuffers.symbols.glCheckFramebufferStatus(0x8d40);
    if (status !== 0x8cd5) throw new Error(`OpenGL opacity framebuffer incomplete: 0x${status.toString(16)}`);
  }
  private allocate(width: number, height: number): void {
    const gl = this.gl, fbo = this.framebuffers.symbols;
    const component = new Int32Array(1);
    fbo.glGetFramebufferAttachmentParameteriv(0x8ca9, value(this.integer(0x8ca6)) === 0 ? 0x1801 : 0x8d00, 0x8211, component);
    const floating = value(component) === 0x1406;
    const dimensions = `${width}:${height}:${floating}`;
    if (dimensions === this.dimensions) return;
    const active = value(this.integer(0x84e0)); gl.glActiveTexture(0x84c0);
    const previous = value(this.integer(0x8069));
    const allocate = (name: number, internal: number, format: number, type: number): void => {
      gl.glBindTexture(0xde1, name);
      gl.glTexParameteri(0xde1, 0x2801, 0x2600); gl.glTexParameteri(0xde1, 0x2800, 0x2600);
      gl.glTexParameteri(0xde1, 0x2802, 0x812f); gl.glTexParameteri(0xde1, 0x2803, 0x812f);
      fbo.glTexImage2D(0xde1, 0, internal, width, height, 0, format, type, null);
    };
    try {
      for (const color of this.colors) allocate(color, this.precision.alphaBits > 0 ? 0x8058 : this.precision.colorBits <= 16 ? 0x8d62 : 0x8051, 0x1908, 0x1401);
      const stencil = this.precision.stencilBits > 0;
      allocate(value(this.depth), stencil ? floating ? 0x8cad : 0x88f0 : floating ? 0x8cac : this.precision.depthBits <= 16 ? 0x81a5 : this.precision.depthBits <= 24 ? 0x81a6 : 0x81a7,
        stencil ? 0x84f9 : 0x1902, stencil ? floating ? 0x8dad : 0x84fa : floating ? 0x1406 : 0x1405);
      for (let index = 0; index < 2; index++) {
        fbo.glBindFramebuffer(0x8d40, value(this.targets, index));
        fbo.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, value(this.colors, index), 0);
        if (index === 1) fbo.glFramebufferTexture2D(0x8d40, stencil ? 0x821a : 0x8d00, 0xde1, value(this.depth), 0);
        gl.glDrawBuffer(0x8ce0); fbo.glReadBuffer(0x8ce0); this.check();
      }
      this.dimensions = dimensions;
    } finally { gl.glBindTexture(0xde1, previous); gl.glActiveTexture(active); }
  }

  /** Called by the renderer's normal target selector while child geometry executes. */
  bind(): boolean {
    if (!this.active) return false;
    this.framebuffers.symbols.glBindFramebuffer(0x8d40, value(this.targets, 1));
    this.gl.glDrawBuffer(0x8ce0); this.framebuffers.symbols.glReadBuffer(0x8ce0);
    return true;
  }

  draw(opacity: number, width: number, height: number, draw: () => undefined): undefined {
    if (this.active) throw new Error("Nested OpenGL object opacity is unsupported");
    const gl = this.gl, fbo = this.framebuffers.symbols;
    const destination = value(this.integer(0x8ca6)), readTarget = value(this.integer(0x8caa));
    const drawBuffer = value(this.integer(0xc01)), readBuffer = value(this.integer(0xc02));
    const viewport = this.integer(0xba2, 4), scissor = this.integer(0xc10, 4), clipped = gl.glIsEnabled(0xc11) !== 0;
    if (value(this.integer(0x80a9)) !== 0) throw new Error("Object opacity requires a single-sample framebuffer");
    try {
      this.allocate(width, height);
      gl.glDisable(0xc11);
      for (let index = 0; index < 2; index++) {
        fbo.glBindFramebuffer(0x8ca8, destination); fbo.glReadBuffer(drawBuffer);
        fbo.glBindFramebuffer(0x8ca9, value(this.targets, index)); gl.glDrawBuffer(0x8ce0);
        fbo.glBlitFramebuffer(0, 0, width, height, 0, 0, width, height,
          0x4000 | (index === 0 ? 0 : 0x100 | (this.precision.stencilBits > 0 ? 0x400 : 0)), 0x2600);
      }
      const copyError = gl.glGetError();
      if (copyError !== 0) throw new Error(`OpenGL opacity backdrop copy failed: 0x${copyError.toString(16)}`);
      if (clipped) gl.glEnable(0xc11);
      this.active = true; this.bind();
      try { draw(); } finally { this.active = false; }
      fbo.glBindFramebuffer(0x8ca9, destination); gl.glDrawBuffer(drawBuffer);
      this.composite(opacity, width, height, viewport, scissor, clipped);
    } finally {
      this.active = false;
      fbo.glBindFramebuffer(0x8ca9, destination); gl.glDrawBuffer(drawBuffer);
      fbo.glBindFramebuffer(0x8ca8, readTarget); fbo.glReadBuffer(readBuffer);
      gl.glScissor(value(scissor, 0), value(scissor, 1), value(scissor, 2), value(scissor, 3));
      if (clipped) gl.glEnable(0xc11); else gl.glDisable(0xc11);
    }
    return undefined;
  }

  private composite(opacity: number, width: number, height: number, viewport: Int32Array, scissor: Int32Array, clipped: boolean): void {
    const gl = this.gl, shader = this.shaders.symbols;
    // Snapshot after child uploads: old names may have been released while drawing.
    const program = value(this.integer(0x8b8d)), active = value(this.integer(0x84e0));
    const colorMask = this.integer(0xc23, 4), depthMask = value(this.integer(0xb72)), modes = this.integer(0xb40, 2);
    const enables = [0xb71, 0xb44, 0xbc0, 0xb90, 0x3000, 0xc11, 0xbe2, 0xbd0, 0x8037].map(name => ({ name, enabled: gl.glIsEnabled(name) !== 0 }));
    gl.glActiveTexture(0x84c0); const texture0 = value(this.integer(0x8069));
    gl.glActiveTexture(0x84c1); const texture1 = value(this.integer(0x8069));
    try {
      gl.glViewport(0, 0, width, height); gl.glDepthMask(0); gl.glColorMask(1, 1, 1, 1); gl.glPolygonMode(0x408, 0x1b02);
      for (const { name } of enables) gl.glDisable(name);
      const x = Math.max(0, value(viewport, 0), clipped ? value(scissor, 0) : 0);
      const y = Math.max(0, value(viewport, 1), clipped ? value(scissor, 1) : 0);
      const right = Math.min(width, value(viewport, 0) + value(viewport, 2), clipped ? value(scissor, 0) + value(scissor, 2) : width);
      const top = Math.min(height, value(viewport, 1) + value(viewport, 3), clipped ? value(scissor, 1) + value(scissor, 3) : height);
      gl.glEnable(0xc11); gl.glScissor(x, y, Math.max(0, right - x), Math.max(0, top - y));
      shader.glUseProgram(this.program); shader.glUniform1i(this.backdropUniform, 0); shader.glUniform1i(this.resultUniform, 1); shader.glUniform1f(this.opacityUniform, opacity);
      gl.glBindTexture(0xde1, value(this.colors, 1)); gl.glActiveTexture(0x84c0); gl.glBindTexture(0xde1, value(this.colors));
      gl.glBegin(7);
      gl.glVertex4f(-1, -1, 0, 1);
      gl.glVertex4f(1, -1, 0, 1);
      gl.glVertex4f(1, 1, 0, 1);
      gl.glVertex4f(-1, 1, 0, 1); gl.glEnd();
      const error = gl.glGetError();
      if (error !== 0) throw new Error(`OpenGL opacity composite failed: 0x${error.toString(16)}`);
    } finally {
      gl.glBindTexture(0xde1, texture0); gl.glActiveTexture(0x84c1); gl.glBindTexture(0xde1, texture1); gl.glActiveTexture(active);
      shader.glUseProgram(program); gl.glDepthMask(depthMask); gl.glColorMask(value(colorMask, 0), value(colorMask, 1), value(colorMask, 2), value(colorMask, 3));
      gl.glPolygonMode(0x404, value(modes, 0)); gl.glPolygonMode(0x405, value(modes, 1));
      gl.glViewport(value(viewport, 0), value(viewport, 1), value(viewport, 2), value(viewport, 3));
      for (const { name, enabled } of enables) { if (enabled) gl.glEnable(name); else gl.glDisable(name); }
    }
  }

  close(): void {
    this.framebuffers.symbols.glDeleteFramebuffers(2, this.targets);
    this.gl.glDeleteTextures(2, this.colors); this.gl.glDeleteTextures(1, this.depth);
    this.shaders.symbols.glDeleteProgram(this.program); this.shaders.close(); this.framebuffers.close();
  }
}
