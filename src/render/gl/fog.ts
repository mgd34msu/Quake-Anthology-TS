// SPDX-License-Identifier: GPL-2.0-or-later
// Q2 rerelease gl_fog.ts depth snapshot and ordered global/height/sky passes.
import type { Q2FogOperation } from "../../contracts/render.ts";
import type { loadGl } from "../../platform/gl.ts";
import { loadGlPrograms } from "../../platform/gl-programs.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import { compileProgram } from "./programs.ts";
import { buildFogFragmentShaderSource, buildFogVertexShaderSource, fogUniformsFor, type FogPassKind } from "./fog-shader.ts";

type Gl = ReturnType<typeof loadGl>["symbols"];
interface FogProgram { readonly name: number; readonly uniforms: ReadonlyMap<string, number>; }
function element(values: Int32Array | Uint32Array | Float32Array, index = 0): number {
  const value = values[index];
  if (value === undefined) throw new Error("OpenGL fog state is incomplete");
  return value;
}

export class Q2FogPass {
  private readonly library: ReturnType<typeof loadGlPrograms>;
  private readonly programs = new Map<FogPassKind, FogProgram>();
  private readonly texture = new Uint32Array(1);
  private readonly textureName: number;

  constructor(context: SdlRenderContext, private readonly gl: Gl) {
    this.library = loadGlPrograms(context);
    try {
      gl.glGenTextures(1, this.texture);
      this.textureName = element(this.texture);
      if (this.textureName === 0) throw new Error("OpenGL could not allocate the fog depth texture");
    } catch (error) { this.library.close(); throw error; }
  }

  private program(kind: FogPassKind): FogProgram {
    const cached = this.programs.get(kind);
    if (cached !== undefined) return cached;
    const gl = this.library.symbols;
    const name = compileProgram(this.library, buildFogVertexShaderSource(kind), buildFogFragmentShaderSource(kind));
    try {
      const uniforms = new Map<string, number>();
      for (const key of fogUniformsFor(kind)) {
        const location = gl.glGetUniformLocation(name, new TextEncoder().encode(`${key}\0`));
        if (location < 0) throw new Error(`OpenGL fog uniform is missing: ${key}`);
        uniforms.set(key, location);
      }
      const result = { name, uniforms };
      this.programs.set(kind, result);
      return result;
    } catch (error) { gl.glDeleteProgram(name); throw error; }
  }

  draw(operation: Q2FogOperation, targetWidth: number, targetHeight: number): void {
    const { camera, fog, farDepth, skyDrawn } = operation;
    if (fog.density <= 0 && (fog.height.density <= 0 || fog.height.falloff <= 0) && (fog.skyFactor <= 0 || !skyDrawn)) return;
    const rect = camera.viewport, bottom = targetHeight - rect.y - rect.height;
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.x < 0 || rect.y < 0
      || rect.width < 1 || rect.height < 1 || rect.x + rect.width > targetWidth || rect.y + rect.height > targetHeight)
      throw new RangeError("OpenGL fog viewport is outside its render target");
    const projection = camera.projection;
    if (projection[1] !== 0 || projection[2] !== 0 || projection[3] !== 0 || projection[4] !== 0
      || projection[6] !== 0 || projection[7] !== 0 || projection[8] !== 0 || projection[9] !== 0
      || projection[12] !== 0 || projection[13] !== 0
      || projection[0] === 0 || projection[5] === 0 || projection[11] !== -1 || projection[15] !== 0)
      throw new RangeError("Q2 fog requires the source symmetric perspective projection");
    const a = -projection[10], b = -projection[14], tanX = 1 / projection[0], tanY = 1 / projection[5];
    const gl = this.gl, shader = this.library.symbols;
    const integer = (name: number, count = 1): Int32Array => {
      const result = new Int32Array(count); gl.glGetIntegerv(name, result); return result;
    };
    const oldProgram = element(integer(0x8b8d)), oldActiveTexture = element(integer(0x84e0));
    const oldViewport = integer(0xba2, 4), oldScissor = integer(0xc10, 4);
    const oldDepthMask = element(integer(0xb72));
    const oldBlendSource = element(integer(0xbe1)), oldBlendDestination = element(integer(0xbe0));
    const oldColor = new Float32Array(4); gl.glGetFloatv(0xb00, oldColor);
    const enables = [0xb71, 0xb44, 0xbc0, 0xb90, 0x3000, 0xc11, 0xbe2].map(name => ({ name, enabled: gl.glIsEnabled(name) !== 0 }));
    gl.glActiveTexture(0x84c0);
    const oldTexture = element(integer(0x8069));
    try {
      gl.glBindTexture(0xde1, this.textureName);
      gl.glTexParameteri(0xde1, 0x2801, 0x2600); gl.glTexParameteri(0xde1, 0x2800, 0x2600);
      gl.glTexParameteri(0xde1, 0x2802, 0x812f); gl.glTexParameteri(0xde1, 0x2803, 0x812f);
      gl.glCopyTexImage2D(0xde1, 0, 0x81a6, rect.x, bottom, rect.width, rect.height, 0);
      gl.glViewport(rect.x, bottom, rect.width, rect.height); gl.glScissor(rect.x, bottom, rect.width, rect.height);
      for (const name of [0xb71, 0xb44, 0xbc0, 0xb90, 0x3000]) gl.glDisable(name);
      gl.glEnable(0xc11); gl.glEnable(0xbe2); gl.glBlendFunc(0x302, 0x303);
      gl.glDepthMask(0); gl.glColor4f(1, 1, 1, 1);
      const draw = (): void => {
        gl.glBegin(7);
        gl.glTexCoord2f(0, 0); gl.glVertex2f(-1, -1);
        gl.glTexCoord2f(1, 0); gl.glVertex2f(1, -1);
        gl.glTexCoord2f(1, 1); gl.glVertex2f(1, 1);
        gl.glTexCoord2f(0, 1); gl.glVertex2f(-1, 1);
        gl.glEnd();
      };
      for (const kind of [0, 1, 2] satisfies readonly FogPassKind[]) {
        if (kind === 0 && fog.density <= 0 || kind === 1 && (fog.height.density <= 0 || fog.height.falloff <= 0)
          || kind === 2 && (fog.skyFactor <= 0 || !skyDrawn)) continue;
        const program = this.program(kind);
        const uniform = (name: string): number => {
          const location = program.uniforms.get(name);
          if (location === undefined) throw new Error(`OpenGL fog uniform was not linked: ${name}`);
          return location;
        };
        shader.glUseProgram(program.name);
        shader.glUniform1i(uniform("u_depth"), 0);
        shader.glUniform1f(uniform("u_far_depth"), farDepth);
        if (kind !== 2) shader.glUniform4f(uniform("u_proj"), a, b, 0, 0);
        if (kind === 0 || kind === 2) {
          shader.glUniform4f(uniform("u_fog_color"), fog.color.x, fog.color.y, fog.color.z, kind === 0 ? fog.density / 64 : fog.skyFactor);
        } else {
          const [forward, left, up] = camera.axis, height = fog.height;
          shader.glUniform3f(uniform("u_vieworg"), camera.origin.x, camera.origin.y, camera.origin.z);
          shader.glUniform3f(uniform("u_forward"), forward.x, forward.y, forward.z);
          shader.glUniform3f(uniform("u_right"), -left.x, -left.y, -left.z);
          shader.glUniform3f(uniform("u_up"), up.x, up.y, up.z);
          shader.glUniform4f(uniform("u_tan"), tanX, tanY, 0, 0);
          shader.glUniform4f(uniform("u_hf_start"), height.start.color.x, height.start.color.y, height.start.color.z, height.start.distance);
          shader.glUniform4f(uniform("u_hf_end"), height.end.color.x, height.end.color.y, height.end.color.z, height.end.distance);
          shader.glUniform1f(uniform("u_hf_density"), height.density);
          shader.glUniform1f(uniform("u_hf_falloff"), height.falloff);
        }
        draw();
      }
      const error = gl.glGetError();
      if (error !== 0) throw new Error(`OpenGL Q2 fog pass failed: 0x${error.toString(16)}`);
    } finally {
      shader.glUseProgram(oldProgram);
      gl.glBindTexture(0xde1, oldTexture); gl.glActiveTexture(oldActiveTexture);
      gl.glDepthMask(oldDepthMask); gl.glBlendFunc(oldBlendSource, oldBlendDestination);
      gl.glViewport(element(oldViewport, 0), element(oldViewport, 1), element(oldViewport, 2), element(oldViewport, 3));
      gl.glScissor(element(oldScissor, 0), element(oldScissor, 1), element(oldScissor, 2), element(oldScissor, 3));
      gl.glColor4f(element(oldColor, 0), element(oldColor, 1), element(oldColor, 2), element(oldColor, 3));
      for (const { name, enabled } of enables) { if (enabled) gl.glEnable(name); else gl.glDisable(name); }
    }
  }

  close(): void {
    for (const program of this.programs.values()) this.library.symbols.glDeleteProgram(program.name);
    this.programs.clear();
    this.gl.glDeleteTextures(1, this.texture);
    this.library.close();
  }
}
