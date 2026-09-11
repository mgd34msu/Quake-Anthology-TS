// SPDX-License-Identifier: GPL-2.0-or-later
// Q2 rerelease global, height and sky fog GLSL from ref_gl/gl_fog.ts.
export const FOG_PASS_GLOBAL = 0;
export const FOG_PASS_HEIGHT = 1;
export const FOG_PASS_SKY = 2;
export type FogPassKind = 0 | 1 | 2;

export function fogUniformsFor(kind: FogPassKind): readonly string[] {
  if (kind === FOG_PASS_SKY) return ["u_depth", "u_far_depth", "u_fog_color"];
  if (kind === FOG_PASS_GLOBAL) return ["u_depth", "u_far_depth", "u_proj", "u_fog_color"];
  return ["u_depth", "u_far_depth", "u_proj", "u_vieworg", "u_forward", "u_right", "u_up", "u_tan", "u_hf_start", "u_hf_end", "u_hf_density", "u_hf_falloff"];
}

/*
The quad is submitted in normalized device coordinates directly (see
drawFullscreenQuad), so gl_Position is gl_Vertex with no matrix at all --
deliberately NOT ftransform(), because there is no fixed-function
transform to match here: nothing else draws this geometry.

v_ray is the eye->fragment direction scaled so that `vieworg + v_ray * w`
lands on the fragment, for w the eye-axis distance. It is linear in NDC, so
interpolating it across two triangles is exact rather than approximate.
*/
export function buildFogVertexShaderSource(kind: FogPassKind): string {
  const lines = ["#version 110", "varying vec2 v_tc;"];
  if (kind === FOG_PASS_HEIGHT) {
    lines.push("uniform vec3 u_forward;", "uniform vec3 u_right;", "uniform vec3 u_up;", "uniform vec4 u_tan;", "varying vec3 v_ray;");
  }
  lines.push("void main() {");
  lines.push("  v_tc = gl_MultiTexCoord0.st;");
  if (kind === FOG_PASS_HEIGHT) {
    lines.push("  v_ray = u_forward + u_right * (gl_Vertex.x * u_tan.x) + u_up * (gl_Vertex.y * u_tan.y);");
  }
  lines.push("  gl_Position = vec4(gl_Vertex.xy, 0.0, 1.0);");
  lines.push("}");
  return lines.join("\n");
}

export function buildFogFragmentShaderSource(kind: FogPassKind): string {
  const lines = ["#version 110", "varying vec2 v_tc;", "uniform sampler2D u_depth;", "uniform float u_far_depth;"];

  if (kind === FOG_PASS_SKY) {
    // shader.c:739 -- flat mix, no distance term. Only the fragments the sky
    // box painted qualify; everything nearer was already handled by the two
    // distance passes.
    lines.push(
      "uniform vec4 u_fog_color;",
      "void main() {",
      "  float d = texture2D(u_depth, v_tc).r;",
      "  if (d < u_far_depth) discard;",
      "  gl_FragColor = vec4(u_fog_color.rgb, u_fog_color.a);",
      "}",
    );
    return lines.join("\n");
  }

  lines.push("uniform vec4 u_proj;");
  if (kind === FOG_PASS_GLOBAL) lines.push("uniform vec4 u_fog_color;");
  else {
    lines.push(
      "varying vec3 v_ray;",
      "uniform vec3 u_vieworg;",
      "uniform vec4 u_hf_start;",
      "uniform vec4 u_hf_end;",
      "uniform float u_hf_density;",
      "uniform float u_hf_falloff;",
    );
  }

  lines.push(
    "void main() {",
    "  float d = texture2D(u_depth, v_tc).r;",
    // Sky and never-drawn background both sit at exactly the far window
    // depth; the sky gets its own flat pass, the background gets nothing.
    "  if (d >= u_far_depth) discard;",
    "  float ndc_z = 2.0 * d - 1.0;",
    "  float w = u_proj.y / (u_proj.x - ndc_z);",
    "  float frag_depth = d * w;",
  );

  if (kind === FOG_PASS_GLOBAL) {
    lines.push(
      // shader.c:723-725
      "  float dd = u_fog_color.a * frag_depth;",
      "  float fog = 1.0 - exp(-(dd * dd));",
      "  gl_FragColor = vec4(u_fog_color.rgb, fog);",
      "}",
    );
    return lines.join("\n");
  }

  // shader.c:541-556's write_height_fog(), line for line.
  lines.push(
    "  vec3 v_world_pos = u_vieworg + v_ray * w;",
    "  float dir_z = normalize(v_world_pos - u_vieworg).z;",
    "  float s = sign(dir_z);",
    "  dir_z += 0.00001 * (1.0 - s * s);",
    "  float eye = u_vieworg.z - u_hf_start.w;",
    "  float pos = v_world_pos.z - u_hf_start.w;",
    "  float density = (exp(-u_hf_falloff * eye) - exp(-u_hf_falloff * pos)) / (u_hf_falloff * dir_z);",
    "  float extinction = 1.0 - clamp(exp(-density), 0.0, 1.0);",
    "  float fraction = clamp((pos - u_hf_start.w) / (u_hf_end.w - u_hf_start.w), 0.0, 1.0);",
    "  vec3 fog_color = mix(u_hf_start.rgb, u_hf_end.rgb, fraction) * extinction;",
    "  float fog = (1.0 - exp(-(u_hf_density * frag_depth))) * extinction;",
    "  gl_FragColor = vec4(fog_color, fog);",
    "}",
  );
  return lines.join("\n");
}

