import type { Palette } from "../../contracts/render.ts";

/** GL_FloodFillSkin replaces the connected skin background before mipmapping. */
export function floodSkin(indices: Uint8Array, width: number, height: number, palette: Palette): Uint8Array {
  const result = indices.slice(), fill = result[0];
  let black = 0;
  for (let index = 0; index < 256; index++) if (palette.colors[index * 3] === 0 && palette.colors[index * 3 + 1] === 0 && palette.colors[index * 3 + 2] === 0) { black = index; break; }
  if (fill === undefined || fill === black || fill === 255) return result;
  const queue = [0]; result[0] = 255;
  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head];
    if (pixel === undefined) throw new Error("Skin flood queue lost a pixel");
    const x = pixel % width, y = Math.trunc(pixel / width);
    let color = black;
    for (const next of [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1]) {
      if (next < 0) continue;
      const value = result[next];
      if (value === fill) { result[next] = 255; queue.push(next); }
      else if (value !== undefined && value !== 255) color = value;
    }
    result[pixel] = color;
  }
  return result;
}
