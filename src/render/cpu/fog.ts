/* True-color depth fog adapted from quake-1-re-ts/ref_soft/r_fog.ts.
 * Copyright (C) 2002-2009 John Fitzgibbons and others;
 * Copyright (C) 2010-2014 QuakeSpasm developers. GPL-2.0-or-later. */
import type { Mat4 } from "../../contracts/math.ts";
import type { Q2FogOperation, Rect } from "../../contracts/render.ts";
import { globalFogAmount, heightFogAmount, heightFogDirZ, heightFogExtinction, heightFogFraction,
  q1FogColor } from "../../materials/legacy-fog.ts";
import type { Q1Fog } from "../../materials/legacy-fog.ts";
import { byte, clamp } from "./triangle-kernel.ts";
import type { Framebuffer } from "./triangle-kernel.ts";

/** Q1 projections keep clip Z/W independent of eye X/Y. */
export function eyeDepthFromWindowDepth(projection: Mat4, windowDepth: number,
  depthRange: readonly [number, number] = [0, 1]): number {
  const normalized = (windowDepth - depthRange[0]) / (depthRange[1] - depthRange[0]) * 2 - 1;
  return Math.abs((projection[14] - normalized * projection[15]) / (normalized * projection[11] - projection[10]));
}

/** Run after Q1 world/entities/particles and before underwater warp and HUD. */
export function applyQ1DepthFog(frame: Framebuffer, viewport: Rect, projection: Mat4, fog: Q1Fog,
  skyFraction: number, output: "truecolor" | "classic-indexed", clearDepth = 1): void {
  if (output === "classic-indexed" || fog.density <= 0) return;
  if (projection[2] !== 0 || projection[6] !== 0 || projection[3] !== 0 || projection[7] !== 0)
    throw new Error("Q1 fog requires a projection whose depth is independent of eye X/Y");
  const sky = clamp(skyFraction), pixels = frame.pixels;
  for (let y = Math.max(0, viewport.y); y < Math.min(frame.height, viewport.y + viewport.height); y++) {
    for (let x = Math.max(0, viewport.x); x < Math.min(frame.width, viewport.x + viewport.width); x++) {
      const index = (y - frame.originY) * frame.stride + x - frame.originX, depth = frame.depth[index], offset = index * 4;
      const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
      if (depth === undefined || red === undefined || green === undefined || blue === undefined)
        throw new RangeError("Q1 fog rectangle lies outside its framebuffer storage");
      const color = { x: red / 255, y: green / 255, z: blue / 255 };
      const result = depth === clearDepth ? { x: color.x + (fog.color.x - color.x) * sky,
        y: color.y + (fog.color.y - color.y) * sky, z: color.z + (fog.color.z - color.z) * sky }
        : q1FogColor(color, fog, eyeDepthFromWindowDepth(projection, depth));
      pixels[offset] = byte(result.x); pixels[offset + 1] = byte(result.y); pixels[offset + 2] = byte(result.z);
    }
  }
}

/** Q2 rerelease fog follows quake-2-re-ts/ref_gl/gl_fog.ts GL_DrawFogPass.
 * Global and height passes blend separately after the finished scene; sky is flat.
 * The donor fog depth is windowDepth * eyeW, including for translucent pixels
 * whose depth remains that of the opaque geometry behind them. */
export function applyQ2DepthFog(frame: Framebuffer, operation: Q2FogOperation, alphaBits: 0 | 8 = 8): void {
  const { camera, fog, farDepth, skyDrawn } = operation, viewport = camera.viewport;
  const global = fog.density > 0, height = fog.height.density > 0 && fog.height.falloff > 0,
    sky = skyDrawn && fog.skyFactor > 0;
  if (!global && !height && !sky) return;
  const projection = camera.projection;
  if (projection[1] !== 0 || projection[2] !== 0 || projection[3] !== 0 || projection[4] !== 0
    || projection[6] !== 0 || projection[7] !== 0 || projection[8] !== 0 || projection[9] !== 0
    || projection[12] !== 0 || projection[13] !== 0
    || projection[11] !== -1 || projection[15] !== 0 || projection[0] === 0 || projection[5] === 0)
    throw new Error("Q2 fog requires the source symmetric perspective projection");
  const [forward, left, up] = camera.axis, origin = camera.origin;
  const a = Math.fround(-projection[10]), b = Math.fround(-projection[14]),
    tanX = Math.fround(1 / projection[0]), tanY = Math.fround(1 / projection[5]);
  const density = Math.fround(fog.density / 64), threshold = Math.fround(farDepth);
  const pixels = frame.pixels;
  // Each shader pass converts its result into the byte framebuffer before the
  // next pass reads it. Alpha uses the same source-alpha blend factors as RGB.
  const blendFog = (offset: number, red: number, green: number, blue: number, amount: number): void => {
    const r = pixels[offset], g = pixels[offset + 1], colorB = pixels[offset + 2], alpha = pixels[offset + 3];
    if (r === undefined || g === undefined || colorB === undefined || alpha === undefined)
      throw new RangeError("Q2 fog rectangle lies outside its framebuffer storage");
    const factor = clamp(amount), inverse = 1 - factor;
    pixels[offset] = byte(clamp(red) * factor + r / 255 * inverse);
    pixels[offset + 1] = byte(clamp(green) * factor + g / 255 * inverse);
    pixels[offset + 2] = byte(clamp(blue) * factor + colorB / 255 * inverse);
    pixels[offset + 3] = alphaBits === 0 ? 255 : byte(factor * factor + alpha / 255 * inverse);
  };
  for (let y = Math.max(0, viewport.y); y < Math.min(frame.height, viewport.y + viewport.height); y++) {
    const ndcY = 1 - (y + 0.5 - viewport.y) * 2 / viewport.height;
    for (let x = Math.max(0, viewport.x); x < Math.min(frame.width, viewport.x + viewport.width); x++) {
      const index = (y - frame.originY) * frame.stride + x - frame.originX, storedDepth = frame.depth[index], offset = index * 4;
      if (storedDepth === undefined) throw new RangeError("Q2 fog rectangle lies outside its depth storage");
      const depth = Math.fround(storedDepth);
      if (depth >= threshold) {
        if (sky) blendFog(offset, fog.color.x, fog.color.y, fog.color.z, fog.skyFactor);
        continue;
      }
      const eyeW = b / (a - (2 * depth - 1)), fragDepth = depth * eyeW;
      if (global) blendFog(offset, fog.color.x, fog.color.y, fog.color.z, globalFogAmount(density, fragDepth));
      if (height) {
        const ndcX = (x + 0.5 - viewport.x) * 2 / viewport.width - 1;
        const rayX = forward.x - left.x * ndcX * tanX + up.x * ndcY * tanY;
        const rayY = forward.y - left.y * ndcX * tanX + up.y * ndcY * tanY;
        const rayZ = forward.z - left.z * ndcX * tanX + up.z * ndcY * tanY;
        const worldX = origin.x + rayX * eyeW, worldY = origin.y + rayY * eyeW, worldZ = origin.z + rayZ * eyeW;
        const distance = Math.hypot(worldX - origin.x, worldY - origin.y, worldZ - origin.z);
        const directionZ = heightFogDirZ(distance === 0 ? 0 : (worldZ - origin.z) / distance);
        const hf = fog.height, extinction = heightFogExtinction(origin.z, worldZ, hf.start.distance, hf.falloff, directionZ);
        const fraction = heightFogFraction(worldZ, hf.start.distance, hf.end.distance);
        blendFog(offset, (hf.start.color.x + (hf.end.color.x - hf.start.color.x) * fraction) * extinction,
          (hf.start.color.y + (hf.end.color.y - hf.start.color.y) * fraction) * extinction,
          (hf.start.color.z + (hf.end.color.z - hf.start.color.z) * fraction) * extinction,
          heightFogAmount(hf.density, fragDepth, extinction));
      }
    }
  }
}
