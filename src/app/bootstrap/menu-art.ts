import mainBackground from "../../../assets/ui/main-menu-background.png" with { type: "file" };
import background from "../../../assets/ui/menu-background.png" with { type: "file" };
import panel from "../../../assets/ui/menu-panel.png" with { type: "file" };
import focus from "../../../assets/ui/menu-focus.png" with { type: "file" };
import type { ImageLevel } from "../../contracts/render.ts";
import { decodePng } from "../../formats/images/png.ts";

const decodedImages = new Map<string, Promise<ImageLevel>>();

/** Bun embeds these same files in the standalone executable. */
export async function loadMenuArtImage(path: string): Promise<ImageLevel> {
  const file = path === "assets/ui/main-menu-background.png" ? mainBackground : path === "assets/ui/menu-background.png" ? background : path === "assets/ui/menu-panel.png" ? panel
    : path === "assets/ui/menu-focus.png" ? focus : null;
  if (file === null) throw new Error(`Unknown menu artwork: ${path}`);
  let pending = decodedImages.get(file);
  if (pending === undefined) {
    pending = Bun.file(file).bytes().then(bytes => decodePng(bytes, path)).catch((error: unknown) => {
      decodedImages.delete(file);
      throw error;
    });
    decodedImages.set(file, pending);
  }
  const image = await pending;
  return { width: image.width, height: image.height, pixels: image.pixels.slice() };
}
