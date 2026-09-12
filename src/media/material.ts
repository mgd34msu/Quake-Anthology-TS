import type { ImageResourceOperation, RendererImage } from "../contracts/render.ts";
import type { ShaderCinematicSource } from "../materials/cinematic.ts";
import { CinematicPlayback } from "./playback.ts";
import { CinematicImage } from "./presentation.ts";
import type { CinematicImageAllocator } from "./presentation.ts";

export class MaterialCinematic implements ShaderCinematicSource {
  private readonly texture: CinematicImage;
  private enabled = true;
  constructor(readonly playback: CinematicPlayback, image: RendererImage, allocate: CinematicImageAllocator,
    private readonly uploaded: (operation: ImageResourceOperation) => void = () => undefined) {
    if (playback.target.kind !== "material") throw new Error("Material cinematic requires a material target");
    this.texture = new CinematicImage(image, allocate);
  }
  get image(): RendererImage { return this.texture.image; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.playback.pause(!enabled); }
  resolve(apply: (operation: ImageResourceOperation) => void): RendererImage {
    const tick = this.enabled ? this.playback.tick() : null;
    const frame = tick?.frame ?? this.playback.currentFrame;
    // Source RoQ may publish INFO before its first image. Keep the texture clear until a frame exists.
    const image = this.texture.image;
    const picture = frame ?? { width: image.width, height: image.height, rgba: new Uint8Array(image.width * image.height * 4),
      index: 0, loop: 0, sourceTime: 0, time: 0 };
    return this.texture.resolve(picture, frame === null ? -2 : this.playback.revision, operation => { apply(operation); this.uploaded(operation); });
  }
  close(): ImageResourceOperation | null { const release = this.texture.release(); this.playback.close(); return release; }
}
