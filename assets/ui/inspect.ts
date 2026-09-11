import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../../src/formats/images/png.ts";
import { menuArtFiles } from "./manifest.ts";

export function inspectMenuArt() {
  return menuArtFiles.map(asset => {
    const file = asset.file;
    const bytes = readFileSync(resolve(import.meta.dir, "../..", file));
    const image = decodePng(bytes, file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (image.width !== asset.width || image.height !== asset.height || sha256 !== asset.sha256) throw new Error(`${file}: dimensions or hash changed`);
    let transparentPixels = 0, opaquePixels = 0, partialAlphaPixels = 0;
    let left = image.width, top = image.height, right = 0, bottom = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3];
      if (alpha === undefined) throw new Error(`${file}: missing alpha sample`);
      if (alpha === 0) transparentPixels++;
      else {
        if (alpha === 255) opaquePixels++; else partialAlphaPixels++;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
    }
    const centerAlpha = image.pixels[(Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4 + 3];
    if (file.endsWith("menu-background.png") ? transparentPixels !== 0 || partialAlphaPixels !== 0 : centerAlpha !== 0 || transparentPixels === 0) throw new Error(`${file}: unexpected background/center alpha`);
    return { file, width: image.width, height: image.height, colorType: image.colorType, bytes: bytes.length, sha256, transparentPixels, opaquePixels, partialAlphaPixels, centerAlpha, alphaBounds: { left, top, right, bottom } };
  });
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(inspectMenuArt(), null, 2)}\n`);
