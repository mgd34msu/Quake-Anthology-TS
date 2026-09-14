// SPDX-License-Identifier: GPL-2.0-or-later
// Q2 rerelease gl_shadowmap.ts depth passes, using already projected caster geometry.
import type { DepthAtlasDraw, DepthAtlasPass } from "../../contracts/render.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { loadGl } from "../../platform/gl.ts";
import { loadGlFramebuffers } from "../../platform/gl-framebuffers.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import type { StageProgram } from "./programs.ts";

type Gl = ReturnType<typeof loadGl>["symbols"];
function value(values: Int32Array | Uint32Array | Float32Array, index = 0): number {
  const result = values[index];
  if (result === undefined) throw new Error("OpenGL state query is incomplete");
  return result;
}

export class DepthAtlasTarget {
  private readonly library: ReturnType<typeof loadGlFramebuffers>;
  private readonly handle = new Uint32Array(1);
  private readonly name: number;
  private readonly positions = new Float32Array(65536 * 4);
  private readonly indices = new Uint32Array(196608);
  private readonly primitiveRestart: boolean;
  private readonly textureCoordinates: number;

  constructor(context: SdlRenderContext, private readonly gl: Gl, private readonly program: StageProgram) {
    this.library = loadGlFramebuffers(context);
    try {
      const version = /^(\d+)\.(\d+)/.exec(String(gl.glGetString(0x1f02)));
      const major = Number(version?.[1] ?? 0), minor = Number(version?.[2] ?? 0);
      this.primitiveRestart = major > 3 || major === 3 && minor >= 1;
      const coordinates = new Int32Array(1); gl.glGetIntegerv(0x8871, coordinates);
      this.textureCoordinates = value(coordinates);
      this.library.symbols.glGenFramebuffers(1, this.handle);
      this.name = value(this.handle);
      if (this.name === 0) throw new Error("OpenGL could not allocate a shadow framebuffer");
    } catch (error) { this.library.close(); throw error; }
  }

  draw(texture: number, width: number, height: number, passes: readonly DepthAtlasPass[]): void {
    const gl = this.gl, fbo = this.library.symbols;
    for (const pass of passes) {
      const viewport = pass.viewport;
      if (![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isInteger)
        || viewport.x < 0 || viewport.y < 0 || viewport.width <= 0 || viewport.height <= 0
        || viewport.x + viewport.width > width || viewport.y + viewport.height > height)
        throw new RangeError("OpenGL depth atlas viewport is outside its image");
      if (pass.clearDepth !== null && (!Number.isFinite(pass.clearDepth) || pass.clearDepth < 0 || pass.clearDepth > 1))
        throw new RangeError("OpenGL depth atlas clear must be in 0..1");
      for (const draw of pass.draws) {
        if (draw.indices.length % 3 !== 0) throw new RangeError("OpenGL depth atlas triangles are incomplete");
        for (const position of draw.positions) {
          if (![position.x, position.y, position.z, position.w].every(number => Number.isFinite(Math.fround(number))))
            throw new RangeError("OpenGL depth atlas vertices must be finite float32");
        }
        for (const index of draw.indices) {
          if (!Number.isInteger(index) || index < 0 || index >= draw.positions.length) throw new RangeError("OpenGL depth atlas vertex index is invalid");
        }
      }
    }
    const integer = (name: number, count = 1): Int32Array => {
      const values = new Int32Array(count); gl.glGetIntegerv(name, values); return values;
    };
    const floating = (name: number, count = 1): Float32Array => {
      const values = new Float32Array(count); gl.glGetFloatv(name, values); return values;
    };
    const oldTarget = value(integer(0x8ca6)), oldReadTarget = value(integer(0x8caa));
    const oldDrawBuffer = value(integer(0xc01)), oldReadBuffer = value(integer(0xc02));
    const viewport = integer(0xba2, 4), scissor = integer(0xc10, 4), colorMask = integer(0xc23, 4);
    const depthRange = floating(0xb70, 2), depthClear = value(floating(0xb73));
    const depthMask = value(integer(0xb72)), depthFunction = value(integer(0xb74));
    const cull = value(integer(0xb45)), polygonMode = integer(0xb40, 2);
    const offsetFactor = value(floating(0x8038)), offsetUnits = value(floating(0x2a00));
    const program = value(integer(0x8b8d));
    const enables = [0xb71, 0xb44, 0xbe2, 0xb90, 0xbc0, 0x3000, 0xc11, 0x8037, ...(this.primitiveRestart ? [0x8f9d] : [])]
      .map(name => ({ name, enabled: gl.glIsEnabled(name) !== 0 }));
    if (value(integer(0xbb1)) >= value(integer(0xd3b))) throw new Error("OpenGL client attribute stack is full");
    gl.glPushClientAttrib(2);
    try {
      gl.glBindBuffer(0x8892, 0); gl.glBindBuffer(0x8893, 0);
      for (const name of [0x8075, 0x8076, 0x8077, 0x8079, 0x8457, 0x845e]) gl.glDisableClientState(name);
      for (let unit = 0; unit < this.textureCoordinates; unit++) {
        gl.glClientActiveTexture(0x84c0 + unit); gl.glDisableClientState(0x8078);
      }
      gl.glEnableClientState(0x8074); gl.glVertexPointer(4, 0x1406, 0, this.positions);
      if (this.primitiveRestart) gl.glDisable(0x8f9d);
      fbo.glBindFramebuffer(0x8d40, this.name);
      fbo.glFramebufferTexture2D(0x8d40, 0x8d00, 0xde1, texture, 0);
      gl.glDrawBuffer(0); fbo.glReadBuffer(0);
      const status = fbo.glCheckFramebufferStatus(0x8d40);
      if (status !== 0x8cd5) throw new Error(`OpenGL shadow framebuffer is incomplete: 0x${status.toString(16)}`);
      this.program.useDepth();
      gl.glEnable(0xb71); gl.glDepthMask(1); gl.glDepthFunc(0x203); gl.glDepthRange(0, 1);
      gl.glEnable(0xc11); gl.glColorMask(0, 0, 0, 0); gl.glPolygonMode(0x408, 0x1b02);
      for (const name of [0xbe2, 0xb90, 0xbc0, 0x3000]) gl.glDisable(name);
      for (const pass of passes) {
        const rect = pass.viewport;
        gl.glViewport(rect.x, rect.y, rect.width, rect.height);
        gl.glScissor(rect.x, rect.y, rect.width, rect.height);
        if (pass.clearDepth !== null) { gl.glClearDepth(pass.clearDepth); gl.glClear(0x100); }
        let previous: DepthAtlasDraw | null = null, vertexCount = 0, indexCount = 0;
        const flush = (): void => {
          if (indexCount !== 0) gl.glDrawElements(4, indexCount, 0x1405, this.indices);
          vertexCount = 0; indexCount = 0;
        };
        const append = (position: Vec4): void => {
          const offset = vertexCount++ * 4;
          this.positions[offset] = position.x; this.positions[offset + 1] = position.y;
          this.positions[offset + 2] = position.z; this.positions[offset + 3] = position.w;
        };
        for (const draw of pass.draws) {
          const same = previous !== null && previous.cull === draw.cull && (previous.polygonOffset === null ? draw.polygonOffset === null
            : draw.polygonOffset !== null && Object.is(previous.polygonOffset.factor, draw.polygonOffset.factor)
              && Object.is(previous.polygonOffset.units, draw.polygonOffset.units));
          if (!same) {
            flush();
            if (draw.cull === "none") gl.glDisable(0xb44);
            else { gl.glEnable(0xb44); gl.glCullFace(draw.cull === "front" ? 0x404 : 0x405); }
            if (draw.polygonOffset === null) gl.glDisable(0x8037);
            else { gl.glEnable(0x8037); gl.glPolygonOffset(draw.polygonOffset.factor, draw.polygonOffset.units); }
            previous = draw;
          }
          if (draw.positions.length <= this.positions.length / 4 && draw.indices.length <= this.indices.length) {
            if (vertexCount + draw.positions.length > this.positions.length / 4 || indexCount + draw.indices.length > this.indices.length) flush();
            const base = vertexCount;
            for (const position of draw.positions) append(position);
            for (const index of draw.indices) this.indices[indexCount++] = base + index;
          } else {
            flush();
            for (let triangle = 0; triangle < draw.indices.length; triangle += 3) {
              if (vertexCount + 3 > this.positions.length / 4 || indexCount + 3 > this.indices.length) flush();
              for (let corner = 0; corner < 3; corner++) {
                const index = draw.indices[triangle + corner], position = index === undefined ? undefined : draw.positions[index];
                if (position === undefined) throw new Error("OpenGL validated depth vertex disappeared");
                this.indices[indexCount++] = vertexCount; append(position);
              }
            }
          }
        }
        flush();
      }
      const error = gl.glGetError();
      if (error !== 0) throw new Error(`OpenGL shadow atlas draw failed: 0x${error.toString(16)}`);
    } finally {
      gl.glPopClientAttrib();
      fbo.glFramebufferTexture2D(0x8d40, 0x8d00, 0xde1, 0, 0);
      fbo.glBindFramebuffer(0x8ca9, oldTarget);
      fbo.glBindFramebuffer(0x8ca8, oldReadTarget);
      gl.glDrawBuffer(oldDrawBuffer); fbo.glReadBuffer(oldReadBuffer);
      gl.glViewport(value(viewport, 0), value(viewport, 1), value(viewport, 2), value(viewport, 3));
      gl.glScissor(value(scissor, 0), value(scissor, 1), value(scissor, 2), value(scissor, 3));
      gl.glColorMask(value(colorMask, 0), value(colorMask, 1), value(colorMask, 2), value(colorMask, 3));
      gl.glDepthRange(value(depthRange, 0), value(depthRange, 1)); gl.glClearDepth(depthClear);
      gl.glDepthMask(depthMask); gl.glDepthFunc(depthFunction); gl.glCullFace(cull);
      gl.glPolygonMode(0x404, value(polygonMode, 0)); gl.glPolygonMode(0x405, value(polygonMode, 1));
      gl.glPolygonOffset(offsetFactor, offsetUnits);
      for (const { name, enabled } of enables) { if (enabled) gl.glEnable(name); else gl.glDisable(name); }
      this.program.restore(program);
    }
  }

  close(): void { this.library.symbols.glDeleteFramebuffers(1, this.handle); this.library.close(); }
}
