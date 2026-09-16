// SPDX-License-Identifier: GPL-2.0-or-later
// Q3 texture environments, implemented with the Q2 rerelease port's
// compatibility GLSL submission convention. Shader text is embedded source.
import { loadGlPrograms } from "../../platform/gl-programs.ts";
import type { Mat4 } from "../../contracts/math.ts";
import type { SdlRenderContext } from "../../platform/sdl-render-context.ts";
import type { BatchLighting, RenderState, TextureBundle } from "../../contracts/render.ts";
import { shadowFactorLines } from "./shadow-shader.ts";

export const stageVertexShader = `#version 120
varying vec4 vertexColor;
varying vec2 coordinates0;
varying vec2 coordinates1;
varying vec3 worldPosition;
varying vec3 worldNormal;
void main() {
  gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;
  gl_ClipVertex = gl_ModelViewMatrix * gl_Vertex;
  vertexColor = clamp(gl_Color, 0.0, 1.0);
  coordinates0 = gl_MultiTexCoord0.xy;
  coordinates1 = gl_MultiTexCoord1.xy;
  worldPosition = gl_MultiTexCoord2.xyz;
  worldNormal = gl_MultiTexCoord3.xyz;
}
`;

export const stageFragmentShader = `#version 120
uniform sampler2D primaryTexture;
uniform sampler2D secondaryTexture;
uniform int secondaryMode;
uniform int alphaMode;
varying vec4 vertexColor;
varying vec2 coordinates0;
varying vec2 coordinates1;
varying vec3 worldPosition;
varying vec3 worldNormal;
uniform int u_lighting_mode;
uniform int u_luminance_alpha;
uniform int u_light_count;
uniform sampler2D u_shadow_map;
uniform float u_shadow_texel;
uniform float u_shadow_near;
uniform vec3 u_light_pos[8];
uniform float u_light_radius[8];
uniform vec3 u_light_color[8];
uniform float u_light_scale[8];
uniform vec3 u_light_cone_dir[8];
uniform float u_light_cone_cos[8];
uniform mat4 u_light_matrix[8];
uniform vec4 u_light_atlas[8];
uniform float u_light_shadow[8];
uniform vec3 u_light_frac[8];
uniform float u_shade_scale;
#define SHADOW_NEAR u_shadow_near
#define SHADOW_CUBE_COLS 3.0
#define SHADOW_CUBE_ROWS 2.0
vec3 dynamicLights() {
  vec3 shade = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= u_light_count) break;
    if (u_light_scale[i] == 0.0 || all(equal(u_light_color[i], vec3(0.0)))) continue;
    vec3 lightPosition = u_light_pos[i];
    float cone = u_light_cone_cos[i];
    if (cone == 0.0) lightPosition += worldNormal * 16.0;
    vec3 towardLight = lightPosition - worldPosition;
    float distance = length(towardLight);
    float radius = u_light_radius[i] + 64.0;
    float falloff = max(radius - distance - 64.0, 0.0) / radius;
    vec3 direction = towardLight / max(distance, 1.0);
    float lambert = u_light_color[i].r < 0.0 ? 1.0 : max(dot(worldNormal, direction), 0.0);
    vec3 result = u_light_color[i] * u_light_scale[i] * falloff * lambert;
    if (cone != 0.0) {
      float magnitude = -dot(direction, u_light_cone_dir[i]);
      result *= cone >= 1.0 ? 0.0 : max(1.0 - (1.0 - magnitude) / (1.0 - cone), 0.0);
    }
    if (u_light_shadow[i] != 0.0) {
${shadowFactorLines("world").join("\n")}
      result *= lit;
    }
    shade += result;
  }
  return shade;
}
vec4 modelShadow(vec4 texel) {
  vec3 shade = vertexColor.rgb * u_shade_scale;
  vec3 keep = vec3(1.0);
  for (int i = 0; i < 8; i++) {
    if (i >= u_light_count) break;
    if (all(equal(u_light_frac[i], vec3(0.0)))) continue;
    if (u_light_shadow[i] != 0.0) {
${shadowFactorLines("model").join("\n")}
      keep -= u_light_frac[i] * (1.0 - lit);
    }
  }
  shade *= max(keep, vec3(0.0));
  return vec4(texel.rgb * min(shade, vec3(1.0)), texel.a * vertexColor.a);
}
void main() {
  vec4 texel = texture2D(primaryTexture, coordinates0);
  if (u_luminance_alpha != 0) texel.rgb *= (texel.r + texel.g + texel.b) / 3.0 * vertexColor.a;
  vec4 color = clamp(texel * vertexColor, 0.0, 1.0);
  if (u_lighting_mode == 1) color = vec4(texel.rgb + dynamicLights(), 1.0);
  else if (u_lighting_mode == 2) color.rgb += dynamicLights();
  else if (u_lighting_mode == 3) color = modelShadow(texel);
  else if (u_lighting_mode == 4) color = vec4((texel.rgb + dynamicLights()) * vertexColor.rgb, texel.a * vertexColor.a);
  else if (u_lighting_mode == 5) {
    color = u_shade_scale > 0.0 ? modelShadow(texel) : texel * vertexColor;
    color.rgb += texel.rgb * dynamicLights();
  }
  if (secondaryMode != 0) {
    vec4 second = texture2D(secondaryTexture, coordinates1);
    if (secondaryMode == 1) color *= second;
    else if (secondaryMode == 2) color = vec4(color.rgb + second.rgb, color.a * second.a);
    else color = second;
    color = clamp(color, 0.0, 1.0);
  }
  if (alphaMode == 1 && color.a <= 0.0) discard;
  if (alphaMode == 2 && color.a >= 0.5) discard;
  if (alphaMode == 3 && color.a < 0.5) discard;
  gl_FragColor = color;
}
`;

const alphaModes: Record<RenderState["alphaTest"], number> = { none: 0, gt0: 1, lt128: 2, ge128: 3 };
const secondaryModes: Record<TextureBundle["environment"], number> = { modulate: 1, add: 2, replace: 3 };
function finiteUniforms(values: readonly number[]): void {
  if (!values.every(value => Number.isFinite(Math.fround(value)))) throw new RangeError("OpenGL lighting uniforms must be finite float32 values");
}

export function compileProgram(library: ReturnType<typeof loadGlPrograms>, vertex: string, fragment: string): number {
  const gl = library.symbols, shaders: number[] = [];
  let program = 0;
  try {
    for (const [kind, source] of [[0x8b31, vertex], [0x8b30, fragment]] satisfies readonly (readonly [number, string])[]) {
      const shader = gl.glCreateShader(kind);
      if (shader === 0) throw new Error("OpenGL could not allocate a shader");
      shaders.push(shader);
      library.shaderSource(shader, source);
      gl.glCompileShader(shader);
      const status = new Int32Array(1);
      gl.glGetShaderiv(shader, 0x8b81, status);
      if (status[0] !== 1) {
        const log = new Uint8Array(8192), size = new Int32Array(1);
        gl.glGetShaderInfoLog(shader, log.length, size, log);
        throw new Error(`OpenGL shader compilation failed: ${new TextDecoder().decode(log).replace(/\0.*$/s, "")}`);
      }
    }
    program = gl.glCreateProgram();
    if (program === 0) throw new Error("OpenGL could not allocate a program");
    for (const shader of shaders) gl.glAttachShader(program, shader);
    gl.glLinkProgram(program);
    const status = new Int32Array(1);
    gl.glGetProgramiv(program, 0x8b82, status);
    if (status[0] !== 1) {
      const log = new Uint8Array(8192), size = new Int32Array(1);
      gl.glGetProgramInfoLog(program, log.length, size, log);
      throw new Error(`OpenGL program linking failed: ${new TextDecoder().decode(log).replace(/\0.*$/s, "")}`);
    }
    return program;
  } catch (error) {
    if (program !== 0) gl.glDeleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.glDeleteShader(shader);
  }
}

export class StageProgram {
  private readonly library: ReturnType<typeof loadGlPrograms>;
  private readonly program: number;
  private readonly depthProgram: number;
  private readonly uniforms = new Map<string, number>();
  private readonly locations: Partial<Record<"secondaryMode" | "alphaMode" | "u_luminance_alpha" | "u_lighting_mode" | "u_light_count" | "u_shadow_texel" | "u_shadow_near" | "u_shade_scale", number>> = {};
  private readonly lightLocations: Partial<Record<"u_light_pos" | "u_light_radius" | "u_light_color" | "u_light_scale" | "u_light_cone_cos" | "u_light_cone_dir" | "u_light_frac" | "u_light_shadow" | "u_light_atlas" | "u_light_matrix", number>>[] = [];
  private readonly integers = new Map<number, number>();
  private readonly scalars = new Map<number, number>();
  private readonly vectors3 = new Map<number, readonly [number, number, number]>();
  private readonly vectors4 = new Map<number, readonly [number, number, number, number]>();
  private readonly matrices = new Map<number, Mat4>();
  private closed = false;

  constructor(context: SdlRenderContext) {
    this.library = loadGlPrograms(context);
    let program = 0, depthProgram = 0;
    try {
      this.program = compileProgram(this.library, stageVertexShader, stageFragmentShader);
      program = this.program;
      this.depthProgram = compileProgram(this.library, `#version 120
void main() { gl_Position = gl_Vertex; }
`, `#version 120
void main() { gl_FragColor = vec4(1.0); }
`);
      depthProgram = this.depthProgram;
      const gl = this.library.symbols;
      gl.glUseProgram(this.program);
      gl.glUniform1i(this.uniform("primaryTexture"), 0);
      gl.glUniform1i(this.uniform("secondaryTexture"), 1);
      gl.glUniform1i(this.uniform("u_shadow_map"), 2);
      gl.glUseProgram(0);
    } catch (error) {
      if (program !== 0) this.library.symbols.glDeleteProgram(program);
      if (depthProgram !== 0) this.library.symbols.glDeleteProgram(depthProgram);
      this.library.close();
      throw error;
    }
  }

  private uniform(name: string): number {
    const cached = this.uniforms.get(name);
    if (cached !== undefined) return cached;
    const location = this.library.symbols.glGetUniformLocation(this.program, new TextEncoder().encode(`${name}\0`));
    if (location < 0) throw new Error(`OpenGL stage uniform is missing: ${name}`);
    this.uniforms.set(name, location);
    return location;
  }

  private integer(location: number, value: number): void {
    if (Object.is(this.integers.get(location), value)) return;
    this.library.symbols.glUniform1i(location, value); this.integers.set(location, value);
  }

  private scalar(location: number, value: number): void {
    if (Object.is(this.scalars.get(location), value)) return;
    this.library.symbols.glUniform1f(location, value); this.scalars.set(location, value);
  }

  private vector3(location: number, x: number, y: number, z: number): void {
    const previous = this.vectors3.get(location);
    if (previous !== undefined && Object.is(previous[0], x) && Object.is(previous[1], y) && Object.is(previous[2], z)) return;
    this.library.symbols.glUniform3f(location, x, y, z); this.vectors3.set(location, [x, y, z]);
  }

  private vector4(location: number, x: number, y: number, z: number, w: number): void {
    const previous = this.vectors4.get(location);
    if (previous !== undefined && Object.is(previous[0], x) && Object.is(previous[1], y) && Object.is(previous[2], z) && Object.is(previous[3], w)) return;
    this.library.symbols.glUniform4f(location, x, y, z, w); this.vectors4.set(location, [x, y, z, w]);
  }

  private matrix(location: number, value: Mat4): void {
    const previous = this.matrices.get(location);
    if (previous !== undefined) {
      let equal = true;
      for (let index = 0; index < value.length; index++) if (!Object.is(previous[index], value[index])) { equal = false; break; }
      if (equal) return;
    }
    this.library.symbols.glUniformMatrix4fv(location, 1, 0, new Float32Array(value));
    this.matrices.set(location, [...value]);
  }

  use(environment: TextureBundle["environment"] | null, alphaTest: RenderState["alphaTest"], lighting: BatchLighting = { kind: "vertex" }, luminanceAlpha = false): void {
    if (this.closed) throw new Error("OpenGL stage program is closed");
    const gl = this.library.symbols;
    gl.glUseProgram(this.program);
    this.integer((this.locations.secondaryMode ??= this.uniform("secondaryMode")), environment === null ? 0 : secondaryModes[environment]);
    this.integer((this.locations.alphaMode ??= this.uniform("alphaMode")), alphaModes[alphaTest]);
    this.integer((this.locations.u_luminance_alpha ??= this.uniform("u_luminance_alpha")), luminanceAlpha ? 1 : 0);
    this.integer((this.locations.u_lighting_mode ??= this.uniform("u_lighting_mode")), lighting.kind === "vertex" ? 0 : lighting.kind === "q2-model-shadow" ? 3 : lighting.pass === "lightmap" ? 1 : lighting.pass === "material-lightmap" ? 4 : lighting.pass === "model" ? 5 : 2);
    if (lighting.kind === "vertex") { this.integer((this.locations.u_light_count ??= this.uniform("u_light_count")), 0); return; }
    if (lighting.lights.length > 8) throw new RangeError("Q2 fragment lighting accepts at most eight selected lights per draw");
    this.integer((this.locations.u_light_count ??= this.uniform("u_light_count")), lighting.lights.length);
    if (lighting.atlas !== null) {
      finiteUniforms([lighting.atlas.texelSize, lighting.atlas.nearPlane]);
      if (!Number.isFinite(lighting.atlas.texelSize) || lighting.atlas.texelSize <= 0 || !Number.isFinite(lighting.atlas.nearPlane) || lighting.atlas.nearPlane <= 0)
        throw new RangeError("Q2 shadow atlas texel size and near plane must be positive");
      this.scalar((this.locations.u_shadow_texel ??= this.uniform("u_shadow_texel")), lighting.atlas.texelSize);
      this.scalar((this.locations.u_shadow_near ??= this.uniform("u_shadow_near")), lighting.atlas.nearPlane);
    }
    if (lighting.kind === "q2-model-shadow" || lighting.pass === "model") {
      const scale = lighting.shadeScale ?? 0;
      finiteUniforms([scale]);
      this.scalar((this.locations.u_shade_scale ??= this.uniform("u_shade_scale")), scale);
    }
    for (const [index, light] of lighting.lights.entries()) {
      const locations = this.lightLocations[index] ??= {};
      finiteUniforms([light.origin.x, light.origin.y, light.origin.z, light.radius]);
      if (light.radius <= 0) throw new RangeError("Q2 fragment light radius must be positive");
      this.vector3((locations.u_light_pos ??= this.uniform(`u_light_pos[${index}]`)), light.origin.x, light.origin.y, light.origin.z);
      this.scalar((locations.u_light_radius ??= this.uniform(`u_light_radius[${index}]`)), light.radius);
      if ("color" in light) {
        finiteUniforms([light.color.x, light.color.y, light.color.z, light.scale]);
        if (light.cone !== null) finiteUniforms([light.cone.direction.x, light.cone.direction.y, light.cone.direction.z, light.cone.cosHalfAngle]);
        this.vector3((locations.u_light_color ??= this.uniform(`u_light_color[${index}]`)), light.color.x, light.color.y, light.color.z);
        this.scalar((locations.u_light_scale ??= this.uniform(`u_light_scale[${index}]`)), light.scale);
        this.scalar((locations.u_light_cone_cos ??= this.uniform(`u_light_cone_cos[${index}]`)), light.cone?.cosHalfAngle ?? 0);
        const direction = light.cone?.direction;
        this.vector3((locations.u_light_cone_dir ??= this.uniform(`u_light_cone_dir[${index}]`)), direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? 0);
      }
      if ("fraction" in light) {
        finiteUniforms([light.fraction.x, light.fraction.y, light.fraction.z]);
        this.vector3((locations.u_light_frac ??= this.uniform(`u_light_frac[${index}]`)), light.fraction.x, light.fraction.y, light.fraction.z);
      } else this.vector3((locations.u_light_frac ??= this.uniform(`u_light_frac[${index}]`)), 0, 0, 0);
      const shadow = light.shadow;
      if (shadow.kind !== "none" && lighting.atlas === null) throw new Error("Q2 shadow receiver is missing its atlas");
      this.scalar((locations.u_light_shadow ??= this.uniform(`u_light_shadow[${index}]`)), shadow.kind === "none" ? 0 : shadow.kind === "cone" ? 1 : 2);
      if (shadow.kind !== "none") {
        const rect = shadow.atlasRect;
        finiteUniforms([rect.x, rect.y, rect.z, rect.w]);
        this.vector4((locations.u_light_atlas ??= this.uniform(`u_light_atlas[${index}]`)), rect.x, rect.y, rect.z, rect.w);
        if (shadow.kind === "cone") {
          finiteUniforms(shadow.matrix);
          this.matrix((locations.u_light_matrix ??= this.uniform(`u_light_matrix[${index}]`)), shadow.matrix);
        }
      }
    }
  }

  useDepth(): void { this.library.symbols.glUseProgram(this.depthProgram); }
  restore(program: number): void { this.library.symbols.glUseProgram(program); }

  close(): void {
    if (this.closed) return;
    this.library.symbols.glUseProgram(0);
    this.library.symbols.glDeleteProgram(this.program);
    this.library.symbols.glDeleteProgram(this.depthProgram);
    this.library.close();
    this.closed = true;
    this.integers.clear(); this.scalars.clear(); this.vectors3.clear(); this.vectors4.clear(); this.matrices.clear();
  }
}
