// SPDX-License-Identifier: GPL-2.0-or-later
// Q3 texture environments, implemented with the Q2 rerelease port's
// compatibility GLSL submission convention. Shader text is embedded source.
import { loadGlPrograms } from "../../platform/gl-programs.ts";
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
#define SHADOW_DEPTH_BIAS (u_lighting_mode == 3 ? 0.0025 : 0.0005)
#define SHADOW_CUBE_BIAS (u_lighting_mode == 3 ? 5.0 : 1.0)
#define SHADOW_CUBE_BIAS_TEXELS (u_lighting_mode == 3 ? 6.0 : 2.0)
#define SHADOW_NEAR u_shadow_near
#define SHADOW_CUBE_COLS 3.0
#define SHADOW_CUBE_ROWS 2.0
vec3 dynamicLights() {
  vec3 shade = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= u_light_count) break;
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
${shadowFactorLines().join("\n")}
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
    if (u_light_shadow[i] != 0.0) {
${shadowFactorLines().join("\n")}
      keep -= u_light_frac[i] * (1.0 - lit);
    }
  }
  shade *= max(keep, vec3(0.0));
  return vec4(texel.rgb * min(shade, vec3(1.0)), texel.a * vertexColor.a);
}
void main() {
  vec4 texel = texture2D(primaryTexture, coordinates0);
  vec4 color = clamp(texel * vertexColor, 0.0, 1.0);
  if (u_lighting_mode == 1) color = vec4(texel.rgb + dynamicLights(), 1.0);
  else if (u_lighting_mode == 2) color.rgb += dynamicLights();
  else if (u_lighting_mode == 3) color = modelShadow(texel);
  else if (u_lighting_mode == 4) color = vec4((texel.rgb + dynamicLights()) * vertexColor.rgb, texel.a * vertexColor.a);
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

  use(environment: TextureBundle["environment"] | null, alphaTest: RenderState["alphaTest"], lighting: BatchLighting = { kind: "vertex" }): void {
    if (this.closed) throw new Error("OpenGL stage program is closed");
    const gl = this.library.symbols;
    gl.glUseProgram(this.program);
    gl.glUniform1i(this.uniform("secondaryMode"), environment === null ? 0 : secondaryModes[environment]);
    gl.glUniform1i(this.uniform("alphaMode"), alphaModes[alphaTest]);
    gl.glUniform1i(this.uniform("u_lighting_mode"), lighting.kind === "vertex" ? 0 : lighting.kind === "q2-model-shadow" ? 3 : lighting.pass === "lightmap" ? 1 : lighting.pass === "material-lightmap" ? 4 : 2);
    if (lighting.kind === "vertex") { gl.glUniform1i(this.uniform("u_light_count"), 0); return; }
    if (lighting.lights.length > 8) throw new RangeError("Q2 fragment lighting accepts at most eight selected lights per draw");
    gl.glUniform1i(this.uniform("u_light_count"), lighting.lights.length);
    if (lighting.atlas !== null) {
      finiteUniforms([lighting.atlas.texelSize, lighting.atlas.nearPlane]);
      if (!Number.isFinite(lighting.atlas.texelSize) || lighting.atlas.texelSize <= 0 || !Number.isFinite(lighting.atlas.nearPlane) || lighting.atlas.nearPlane <= 0)
        throw new RangeError("Q2 shadow atlas texel size and near plane must be positive");
      gl.glUniform1f(this.uniform("u_shadow_texel"), lighting.atlas.texelSize);
      gl.glUniform1f(this.uniform("u_shadow_near"), lighting.atlas.nearPlane);
    }
    if (lighting.kind === "q2-model-shadow") {
      finiteUniforms([lighting.shadeScale]);
      gl.glUniform1f(this.uniform("u_shade_scale"), lighting.shadeScale);
    }
    for (const [index, light] of lighting.lights.entries()) {
      finiteUniforms([light.origin.x, light.origin.y, light.origin.z, light.radius]);
      if (light.radius <= 0) throw new RangeError("Q2 fragment light radius must be positive");
      gl.glUniform3f(this.uniform(`u_light_pos[${index}]`), light.origin.x, light.origin.y, light.origin.z);
      gl.glUniform1f(this.uniform(`u_light_radius[${index}]`), light.radius);
      if ("color" in light) {
        finiteUniforms([light.color.x, light.color.y, light.color.z, light.scale]);
        if (light.cone !== null) finiteUniforms([light.cone.direction.x, light.cone.direction.y, light.cone.direction.z, light.cone.cosHalfAngle]);
        gl.glUniform3f(this.uniform(`u_light_color[${index}]`), light.color.x, light.color.y, light.color.z);
        gl.glUniform1f(this.uniform(`u_light_scale[${index}]`), light.scale);
        gl.glUniform1f(this.uniform(`u_light_cone_cos[${index}]`), light.cone?.cosHalfAngle ?? 0);
        const direction = light.cone?.direction;
        gl.glUniform3f(this.uniform(`u_light_cone_dir[${index}]`), direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? 0);
      } else {
        finiteUniforms([light.fraction.x, light.fraction.y, light.fraction.z]);
        gl.glUniform3f(this.uniform(`u_light_frac[${index}]`), light.fraction.x, light.fraction.y, light.fraction.z);
      }
      const shadow = light.shadow;
      if (shadow.kind !== "none" && lighting.atlas === null) throw new Error("Q2 shadow receiver is missing its atlas");
      gl.glUniform1f(this.uniform(`u_light_shadow[${index}]`), shadow.kind === "none" ? 0 : shadow.kind === "cone" ? 1 : 2);
      if (shadow.kind !== "none") {
        const rect = shadow.atlasRect;
        finiteUniforms([rect.x, rect.y, rect.z, rect.w]);
        gl.glUniform4f(this.uniform(`u_light_atlas[${index}]`), rect.x, rect.y, rect.z, rect.w);
        if (shadow.kind === "cone") {
          finiteUniforms(shadow.matrix);
          gl.glUniformMatrix4fv(this.uniform(`u_light_matrix[${index}]`), 1, 0, new Float32Array(shadow.matrix));
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
  }
}
