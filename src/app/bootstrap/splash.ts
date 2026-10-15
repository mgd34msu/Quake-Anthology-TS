import titleImage from "../../../assets/ui/title.png" with { type: "file" };
import type { PngImage } from "../../formats/images/png.ts";

export interface SplashScreen { close(): void; }

/** Bilinear cover-fit scale of the title art into a width*height RGBA frame. */
export function scaleCover(image: PngImage, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  // Anchor vertical crops to the top so the title treatment is never cut.
  const originX = (image.width - sourceWidth) / 2, originY = 0;
  for (let y = 0; y < height; y++) {
    const sourceY = originY + (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sourceY))), y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < width; x++) {
      const sourceX = originX + (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sourceX))), x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = (image.pixels[(y0 * image.width + x0) * 4 + channel] ?? 0) * (1 - fx) + (image.pixels[(y0 * image.width + x1) * 4 + channel] ?? 0) * fx;
        const bottom = (image.pixels[(y1 * image.width + x0) * 4 + channel] ?? 0) * (1 - fx) + (image.pixels[(y1 * image.width + x1) * 4 + channel] ?? 0) * fx;
        out[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
      out[target + 3] = 255;
    }
  }
  return out;
}

/** Best-effort title splash shown while the application loads; failures never block launch. */
export async function openSplash(width: number, height: number): Promise<SplashScreen | null> {
  try {
    const [{ SdlWindow }, { decodePng }] = await Promise.all([import("../../platform/sdl.ts"), import("../../formats/images/png.ts")]);
    const image = decodePng(await Bun.file(titleImage).bytes(), "assets/ui/title.png");
    const window = SdlWindow.open({ title: "Quake Anthology", width, height, backend: "cpu" });
    try { window.present(scaleCover(image, width, height)); }
    catch { window.close(); return null; }
    return { close: () => { try { window.close(); } catch { /* Already closed. */ } } };
  } catch { return null; }
}
