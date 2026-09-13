// Q3 screenshot and levelshot capture over owned renderer readbacks.
// Copyright (C) id Software. GPL-2.0-or-later.
import { open, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImageLevel } from "../contracts/render.ts";
import { encodeTga } from "../formats/images/tga.ts";
import { encodePng } from "../formats/images/png-encoder.ts";
import { encodeJpeg } from "../formats/images/jpeg-encoder.ts";
import { settingsPath, writeAtomic } from "../settings/config.ts";

export type ScreenshotFormat = "tga" | "png" | "jpg";
export interface FrameReadback { readRgba(): ImageLevel | Promise<ImageLevel>; }
function checkFrame(image: ImageLevel): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
    || image.pixels.length !== image.width * image.height * 4) throw new Error("Renderer returned invalid RGBA frame dimensions");
}
export function encodeScreenshot(image: ImageLevel, format: ScreenshotFormat, quality = 90): Uint8Array {
  checkFrame(image);
  switch (format) {
    case "tga": return encodeTga(image);
    case "png": return encodePng(image.width, image.height, image.pixels);
    case "jpg": return encodeJpeg(image, quality);
  }
}
/** R_LevelShot samples a 512x384 grid, averaging twelve samples into each 128x128 texel. */
export function makeLevelshot(image: ImageLevel, gamma: Uint8Array | null = null): ImageLevel {
  checkFrame(image);
  if (gamma !== null && gamma.length !== 256) throw new Error("Gamma table must contain 256 entries");
  const pixels = new Uint8Array(128 * 128 * 4), input = new DataView(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);
  const xScale = Math.fround(image.width / 512), yScale = Math.fround(image.height / 384);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 4; xx++) {
      const sx = Math.min(image.width - 1, Math.trunc(Math.fround((x * 4 + xx) * xScale)));
      const sy = Math.min(image.height - 1, Math.trunc(Math.fround((y * 3 + yy) * yScale)));
      const offset = (sy * image.width + sx) * 4;
      r += input.getUint8(offset); g += input.getUint8(offset + 1); b += input.getUint8(offset + 2);
    }
    const offset = (y * 128 + x) * 4;
    pixels[offset] = gamma?.[Math.trunc(r / 12)] ?? Math.trunc(r / 12);
    pixels[offset + 1] = gamma?.[Math.trunc(g / 12)] ?? Math.trunc(g / 12);
    pixels[offset + 2] = gamma?.[Math.trunc(b / 12)] ?? Math.trunc(b / 12); pixels[offset + 3] = 255;
  }
  return { width: 128, height: 128, pixels };
}
export interface CaptureResult { readonly path: string; readonly width: number; readonly height: number; readonly byteLength: number; }
export class FrameCapture {
  private writes: Promise<void> = Promise.resolve();
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(() => undefined, () => undefined);
    return result;
  }
  constructor(readonly root: string, private readonly readback: FrameReadback) {}
  async screenshot(options: { readonly format?: ScreenshotFormat; readonly name?: string; readonly quality?: number } = {}): Promise<CaptureResult> {
    const format = options.format ?? "png", image = await this.readback.readRgba(), bytes = encodeScreenshot(image, format, options.quality);
    return this.write(async () => {
      let path: string;
      if (options.name !== undefined) {
        path = settingsPath(this.root, `screenshots/${options.name}.${format}`); await writeAtomic(path, bytes);
      } else {
        path = "";
        for (let index = 0; index < 10000; index++) {
          const candidate = settingsPath(this.root, `screenshots/shot${String(index).padStart(4, "0")}.${format}`);
          await mkdir(dirname(candidate), { recursive: true });
          let file: FileHandle;
          try { file = await open(candidate, "wx"); }
          catch (error) { if (error instanceof Error && "code" in error && error.code === "EEXIST") continue; throw error; }
          try { await file.writeFile(bytes); } finally { await file.close(); }
          path = candidate; break;
        }
        if (path === "") throw new Error("No free screenshot filename between shot0000 and shot9999");
      }
      return { path, width: image.width, height: image.height, byteLength: bytes.length };
    });
  }
  async levelshot(mapName: string, gamma: Uint8Array | null = null): Promise<CaptureResult> {
    const map = mapName.replace(/^maps\//, "").replace(/\.bsp$/, "");
    const image = makeLevelshot(await this.readback.readRgba(), gamma), bytes = encodeTga(image);
    const path = settingsPath(this.root, `levelshots/${map}.tga`);
    return this.write(async () => {
      await writeAtomic(path, bytes);
      return { path, width: image.width, height: image.height, byteLength: bytes.length };
    });
  }
}
