import { decodePcx } from "../formats/images/indexed.ts";
import { cinRgba } from "./cin.ts";
import type { CinematicSource } from "./playback.ts";

export function cinematicPcx(bytes: Uint8Array, source = "<cinematic PCX>"): CinematicSource {
  const image = decodePcx(bytes, source);
  if (image.palette === null) throw new Error("A cinematic PCX needs its own palette");
  return { format: "image", source, width: image.width, height: image.height, rgba: cinRgba(image.indices, image.palette) };
}
