import type { ImageResourceOperation, RendererImage } from "../contracts/render.ts";
import type { ShaderCinematicCall, ShaderCinematicSource } from "../materials/cinematic.ts";
import { CinematicPlayback } from "./playback.ts";
import { CinematicImage } from "./presentation.ts";

export class MaterialCinematic implements ShaderCinematicSource {
  private readonly texture: CinematicImage;
  private enabled = true;
  constructor(readonly playback: CinematicPlayback, readonly image: RendererImage) {
    if (playback.target.kind !== "material") throw new Error("Material cinematic requires a material target");
    this.texture = new CinematicImage(image);
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; this.playback.pause(!enabled); }

  prepareAtExecution(): ShaderCinematicCall | null {
    if (!this.enabled) return null;
    const tick = this.playback.tick();
    if (tick.frame === null || tick.status === "ended" || tick.status === "stopped") return null;
    const upload = this.texture.prepare(tick.frame, this.playback.revision);
    return upload === null ? null : { upload: upload.operation, afterShaderUpload: () => upload.complete() };
  }

  close(): ImageResourceOperation | null { this.playback.close(); return this.texture.release(); }
}
