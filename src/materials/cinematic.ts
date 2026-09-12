import type { DynamicImageSource, RendererImage } from "../contracts/render.ts";

export interface ShaderCinematicSource extends DynamicImageSource {
  readonly image: RendererImage;
}
