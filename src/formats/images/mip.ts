/* Adapted from Q1/Q2 GL_ResampleTexture, GL_MipMap and Q3 R_MipMap2.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ImageLevel } from "../../contracts/render.ts";

function imageBytes(image: ImageLevel): DataView {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0
    || image.pixels.length !== image.width * image.height * 4) throw new RangeError("Expected a complete RGBA8 image");
  return new DataView(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);
}

export function resampleImage(input: ImageLevel, width: number, height: number, profile: "q1" | "q2" | "q3"): ImageLevel {
  const bytes = imageBytes(input);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height * 4 > 0x7fffffff)
    throw new RangeError("Invalid resampled dimensions");
  const pixels = new Uint8Array(width * height * 4), step = Math.trunc(input.width * 65536 / width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (profile === "q1") {
      const sx = Math.min(input.width - 1, (Math.floor(step / 2) + x * step) >>> 16), sy = Math.floor(y * input.height / height);
      for (let c = 0; c < 4; c++) pixels[(y * width + x) * 4 + c] = bytes.getUint8((sy * input.width + sx) * 4 + c);
    } else {
      const x1 = (Math.floor(step / 4) + x * step) >>> 16, x2 = (3 * Math.floor(step / 4) + x * step) >>> 16;
      const y1 = Math.floor((y + 0.25) * input.height / height), y2 = Math.floor((y + 0.75) * input.height / height);
      for (let c = 0; c < 4; c++) pixels[(y * width + x) * 4 + c] = (bytes.getUint8((y1 * input.width + x1) * 4 + c)
        + bytes.getUint8((y1 * input.width + x2) * 4 + c) + bytes.getUint8((y2 * input.width + x1) * 4 + c)
        + bytes.getUint8((y2 * input.width + x2) * 4 + c)) >> 2;
    }
  }
  return { width, height, pixels };
}

export function mipImage(input: ImageLevel, profile: "box" | "q3-weighted" = "box"): ImageLevel {
  const bytes = imageBytes(input), width = Math.max(1, input.width >> 1), height = Math.max(1, input.height >> 1);
  if (input.width === 1 && input.height === 1) return { width, height, pixels: input.pixels.slice() };
  if (profile === "q3-weighted") {
    if ((input.width & (input.width - 1)) !== 0 || (input.height & (input.height - 1)) !== 0)
      throw new RangeError("Q3 weighted mipmaps require power-of-two dimensions");
    // R_MipMap2's one-dimensional tail has no temporary pixels to copy back.
    if (input.width === 1 || input.height === 1) return { width, height, pixels: input.pixels.slice(0, width * height * 4) };
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
    let value = 0;
    if (profile === "q3-weighted") {
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
        const weight = (dy === -1 || dy === 2 ? 1 : 2) * (dx === -1 || dx === 2 ? 1 : 2);
        value += weight * bytes.getUint8((((y * 2 + dy) & (input.height - 1)) * input.width + ((x * 2 + dx) & (input.width - 1))) * 4 + c);
      }
      value = Math.trunc(value / 36);
    } else {
      const x2 = Math.min(input.width - 1, x * 2 + 1), y2 = Math.min(input.height - 1, y * 2 + 1);
      value = (bytes.getUint8((y * 2 * input.width + x * 2) * 4 + c) + bytes.getUint8((y * 2 * input.width + x2) * 4 + c)
        + bytes.getUint8((y2 * input.width + x * 2) * 4 + c) + bytes.getUint8((y2 * input.width + x2) * 4 + c)) >> 2;
    }
    pixels[(y * width + x) * 4 + c] = value;
  }
  return { width, height, pixels };
}

export function generateMipChain(input: ImageLevel, profile: "box" | "q3-weighted" = "box"): readonly [ImageLevel, ...ImageLevel[]] {
  const levels: [ImageLevel, ...ImageLevel[]] = [input];
  let level = input;
  while (level.width > 1 || level.height > 1) { level = mipImage(level, profile); levels.push(level); }
  return levels;
}
