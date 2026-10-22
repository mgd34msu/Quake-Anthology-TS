/* Adapted from Q1/Q2 GL_ResampleTexture, GL_MipMap and Q3 R_MipMap2.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ImageLevel } from "../../contracts/render.ts";

function imageBytes(image: ImageLevel): Uint8Array {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0
    || image.pixels.length !== image.width * image.height * 4) throw new RangeError("Expected a complete RGBA8 image");
  return image.pixels;
}

export function resampleImage(input: ImageLevel, width: number, height: number, profile: "q1" | "q2" | "q3"): ImageLevel {
  const bytes = imageBytes(input);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height * 4 > 0x7fffffff)
    throw new RangeError("Invalid resampled dimensions");
  const pixels = new Uint8Array(width * height * 4), step = Math.trunc(input.width * 65536 / width);
  const inputWidth = input.width, inputHeight = input.height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (profile === "q1") {
      const sx = Math.min(inputWidth - 1, (Math.floor(step / 2) + x * step) >>> 16), sy = Math.floor(y * inputHeight / height);
      const out = (y * width + x) * 4, source = (sy * inputWidth + sx) * 4;
      pixels[out] = bytes[source] ?? 0; pixels[out + 1] = bytes[source + 1] ?? 0;
      pixels[out + 2] = bytes[source + 2] ?? 0; pixels[out + 3] = bytes[source + 3] ?? 0;
    } else {
      const x1 = (Math.floor(step / 4) + x * step) >>> 16, x2 = (3 * Math.floor(step / 4) + x * step) >>> 16;
      const y1 = Math.floor((y + 0.25) * inputHeight / height), y2 = Math.floor((y + 0.75) * inputHeight / height);
      const out = (y * width + x) * 4;
      const s11 = (y1 * inputWidth + x1) * 4, s12 = (y1 * inputWidth + x2) * 4, s21 = (y2 * inputWidth + x1) * 4, s22 = (y2 * inputWidth + x2) * 4;
      for (let c = 0; c < 4; c++) pixels[out + c] = ((bytes[s11 + c] ?? 0) + (bytes[s12 + c] ?? 0) + (bytes[s21 + c] ?? 0) + (bytes[s22 + c] ?? 0)) >> 2;
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
  const inputWidth = input.width, inputHeight = input.height;
  if (profile === "q3-weighted") {
    const wrapX = inputWidth - 1, wrapY = inputHeight - 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let value = 0;
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
          const weight = (dy === -1 || dy === 2 ? 1 : 2) * (dx === -1 || dx === 2 ? 1 : 2);
          value += weight * (bytes[(((y * 2 + dy) & wrapY) * inputWidth + ((x * 2 + dx) & wrapX)) * 4 + c] ?? 0);
        }
        pixels[out + c] = Math.trunc(value / 36);
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row1 = y * 2 * inputWidth * 4, row2 = Math.min(inputHeight - 1, y * 2 + 1) * inputWidth * 4, outRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const out = outRow + x * 4, s1 = row1 + x * 8, s2 = row2 + x * 8;
        const step = x * 2 + 1 < inputWidth ? 4 : 0;
        pixels[out] = ((bytes[s1] ?? 0) + (bytes[s1 + step] ?? 0) + (bytes[s2] ?? 0) + (bytes[s2 + step] ?? 0)) >> 2;
        pixels[out + 1] = ((bytes[s1 + 1] ?? 0) + (bytes[s1 + step + 1] ?? 0) + (bytes[s2 + 1] ?? 0) + (bytes[s2 + step + 1] ?? 0)) >> 2;
        pixels[out + 2] = ((bytes[s1 + 2] ?? 0) + (bytes[s1 + step + 2] ?? 0) + (bytes[s2 + 2] ?? 0) + (bytes[s2 + step + 2] ?? 0)) >> 2;
        pixels[out + 3] = ((bytes[s1 + 3] ?? 0) + (bytes[s1 + step + 3] ?? 0) + (bytes[s2 + 3] ?? 0) + (bytes[s2 + step + 3] ?? 0)) >> 2;
      }
    }
  }
  return { width, height, pixels };
}

export function generateMipChain(input: ImageLevel, profile: "box" | "q3-weighted" = "box"): readonly [ImageLevel, ...ImageLevel[]] {
  const levels: [ImageLevel, ...ImageLevel[]] = [input];
  let level = input;
  while (level.width > 1 || level.height > 1) { level = mipImage(level, profile); levels.push(level); }
  return levels;
}
