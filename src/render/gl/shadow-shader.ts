// SPDX-License-Identifier: GPL-2.0-or-later
// Shadow receiver sampling ported from quake-2-re-ts/ref_gl/gl_shader.ts.
// Cone PCF and 3x2 cube faces keep the donor atlas layout and depth biases.
export function shadowFactorLines(): string[] {
  return [
    // 1.0 == unoccluded. Every path below either leaves it there (the
    // fragment is outside this light's depth data, where a guess is what
    // paints hard black rectangles at map edges) or replaces it with the
    // 2x2 percentage-closer average.
    `      float lit = 1.0;`,
    `      vec2 rect_lo = u_light_atlas[i].xy;`,
    `      vec2 rect_size = u_light_atlas[i].zw;`,
    `      if (u_light_shadow[i] < 1.5) {`,
    // ---- cone light: one perspective depth map, one matrix ----
    `        vec4 lpos = u_light_matrix[i] * vec4(worldPosition, 1.0);`,
    `        if (lpos.w > 0.0) {`,
    `          vec3 lproj = lpos.xyz / lpos.w;`,
    `          if (lproj.x >= 0.0 && lproj.x <= 1.0 && lproj.y >= 0.0 && lproj.y <= 1.0 && lproj.z <= 1.0) {`,
    `            vec2 base = lproj.xy * rect_size + rect_lo;`,
    // Clamp each filter tap inside this light's own rectangle. Without
    // it a tap half a texel past the edge reads the NEIGHBOURING light's
    // depth map, which is how a shadow from one light appears as a
    // one-texel fringe along another's.
    `            vec2 tap_lo = rect_lo + u_shadow_texel;`,
    `            vec2 tap_hi = rect_lo + rect_size - u_shadow_texel;`,
    `            lit = 0.0;`,
    `            for (int sy = 0; sy < 2; sy++) {`,
    `              for (int sx = 0; sx < 2; sx++) {`,
    `                vec2 off = (vec2(float(sx), float(sy)) - 0.5) * u_shadow_texel;`,
    `                float d = texture2D(u_shadow_map, clamp(base + off, tap_lo, tap_hi)).r;`,
    `                lit += (lproj.z - SHADOW_DEPTH_BIAS) > d ? 0.0 : 1.0;`,
    `              }`,
    `            }`,
    `            lit *= 0.25;`,
    `          }`,
    `        }`,
    `      } else {`,
    // ---- point light: six 90-degree faces, 3x2 inside one rectangle ----
    // The face basis table below is gl_shadowmap.ts's CUBE_FACE_BASIS,
    // and the major-axis tie rules are cubeFaceForDirection's, both
    // written out because a fragment that picked a different face than
    // the depth pass rasterized would read a neighbouring face's texels.
    `        vec3 lvec = worldPosition - u_light_pos[i];`,
    `        vec3 lmag = abs(lvec);`,
    `        vec3 face_f;`,
    `        vec3 face_r;`,
    `        vec3 face_u;`,
    `        float face;`,
    `        if (lmag.x >= lmag.y && lmag.x >= lmag.z) {`,
    `          if (lvec.x >= 0.0) { face_f = vec3(1.0, 0.0, 0.0); face_r = vec3(0.0, -1.0, 0.0); face_u = vec3(0.0, 0.0, 1.0); face = 0.0; }`,
    `          else { face_f = vec3(-1.0, 0.0, 0.0); face_r = vec3(0.0, 1.0, 0.0); face_u = vec3(0.0, 0.0, 1.0); face = 1.0; }`,
    `        } else if (lmag.y >= lmag.z) {`,
    `          if (lvec.y >= 0.0) { face_f = vec3(0.0, 1.0, 0.0); face_r = vec3(1.0, 0.0, 0.0); face_u = vec3(0.0, 0.0, 1.0); face = 2.0; }`,
    `          else { face_f = vec3(0.0, -1.0, 0.0); face_r = vec3(-1.0, 0.0, 0.0); face_u = vec3(0.0, 0.0, 1.0); face = 3.0; }`,
    `        } else {`,
    `          if (lvec.z >= 0.0) { face_f = vec3(0.0, 0.0, 1.0); face_r = vec3(0.0, 1.0, 0.0); face_u = vec3(1.0, 0.0, 0.0); face = 4.0; }`,
    `          else { face_f = vec3(0.0, 0.0, -1.0); face_r = vec3(0.0, -1.0, 0.0); face_u = vec3(1.0, 0.0, 0.0); face = 5.0; }`,
    `        }`,
    `        float axial = dot(lvec, face_f);`,
    `        if (axial > SHADOW_NEAR) {`,
    // matrixPerspective's third row, with w divided out: the depth pass
    // stored 0.5 * (-pa + pb / axial) + 0.5, so the stored value inverts
    // back to a distance and the comparison happens in world units.
    `          float zfar = max(u_light_radius[i], SHADOW_NEAR * 2.0);`,
    `          float pa = (zfar + SHADOW_NEAR) / (SHADOW_NEAR - zfar);`,
    `          float pb = (2.0 * zfar * SHADOW_NEAR) / (SHADOW_NEAR - zfar);`,
    `          vec2 cell_size = rect_size / vec2(SHADOW_CUBE_COLS, SHADOW_CUBE_ROWS);`,
    `          vec2 cell_lo = rect_lo + vec2(mod(face, SHADOW_CUBE_COLS), floor(face / SHADOW_CUBE_COLS)) * cell_size;`,
    // tan(45) == 1 for a square 90-degree frustum, so the face UV is just
    // the two off-axis components over the axial one
    `          vec2 face_uv = vec2(dot(lvec, face_r), dot(lvec, face_u)) / axial * 0.5 + 0.5;`,
    `          vec2 base = cell_lo + face_uv * cell_size;`,
    // taps clamp inside this FACE's cell, not just the light's rectangle:
    // the five neighbouring faces are the nearest wrong answers there
    `          vec2 tap_lo = cell_lo + u_shadow_texel;`,
    `          vec2 tap_hi = cell_lo + cell_size - u_shadow_texel;`,
    `          float face_texels = cell_size.x / u_shadow_texel;`,
    `          float bias = SHADOW_CUBE_BIAS + axial * (2.0 / face_texels) * SHADOW_CUBE_BIAS_TEXELS;`,
    `          lit = 0.0;`,
    `          for (int sy = 0; sy < 2; sy++) {`,
    `            for (int sx = 0; sx < 2; sx++) {`,
    `              vec2 off = (vec2(float(sx), float(sy)) - 0.5) * u_shadow_texel;`,
    `              float d = texture2D(u_shadow_map, clamp(base + off, tap_lo, tap_hi)).r;`,
    `              float stored = pb / ((2.0 * d - 1.0) + pa);`,
    `              lit += (axial - bias) > stored ? 0.0 : 1.0;`,
    `            }`,
    `          }`,
    `          lit *= 0.25;`,
    `        }`,
    `      }`,
  ];
}

