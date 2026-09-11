import type { RenderImage } from "../../contracts/render.ts";
import { applyImageGamma, expandIndexedImage } from "../../formats/images/palette.ts";
import { generateMipChain } from "../../formats/images/index.ts";

/** Q2 GL_Upload32 applies intensity before building mipmaps; UI and sky skip it. */
export function q2MipmappedImage(content: RenderImage): RenderImage {
  if (content.kind === "depth32f") return content;
  const first = content.kind === "indexed8" ? expandIndexedImage(content) : content.levels[0];
  const scaled = applyImageGamma(first, { kind: "q2-gl", gamma: 1, intensity: 2, onlyGamma: false });
  return { kind: "rgba8", levels: generateMipChain(scaled), borderColor: { x: 0, y: 0, z: 0, w: 0 } };
}
