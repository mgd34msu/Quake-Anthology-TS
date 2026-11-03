// SPDX-License-Identifier: GPL-2.0-or-later
import type { DynamicImageSource, RendererImage } from "../contracts/render.ts";

export interface ShaderCinematicSource extends DynamicImageSource {
  readonly image: RendererImage;
}
