import type { MediaClock } from "../../media/types.ts";
import type { ImageLevel, ImageResourceOperation, RenderImage, RendererImage, RendererResourceOwner, TextureSampling } from "../../contracts/render.ts";

/** Session-owned images. Uploads and releases enter the same queue as their draws. */
export class SceneImageRegistry {
  private ordinal = 0;
  private closed = false;
  private readonly animations = new Map<RendererImage, { readonly update: (milliseconds: number) => void; readonly stop: () => void }>();
  private readonly images = new Map<number, RendererImage>();
  private operations: ImageResourceOperation[] = [];

  constructor(readonly owner: RendererResourceOwner, private readonly clock: MediaClock = { sample: () => performance.now() }) {}

  register(name: string, content: RenderImage, sampling: TextureSampling,
    source: RendererImage["source"] = { kind: "generated", name }): RendererImage {
    const level = content.levels[0];
    const image = this.allocate(level.width, level.height, source);
    const operation = { kind: "create-image", image, content, sampling } satisfies ImageResourceOperation;
    this.commit(operation); this.operations.push(operation);
    return image;
  }

  /** Allocate identity before an execution-owned upload; no GPU resource exists yet. */
  allocate(width: number, height: number, source: RendererImage["source"]): RendererImage {
    if (this.closed) throw new Error("Scene image registry is closed");
    return { owner: this.owner, ordinal: this.ordinal++, source, width, height };
  }

  /** Track ordered resource ownership; execution-owned uploads call after backend success. */
  commit(operation: ImageResourceOperation): void {
    if (operation.kind === "create-image") {
      if (this.closed) throw new Error("Scene image registry is closed");
      const image = operation.image;
      if (image.owner !== this.owner || this.images.has(image.ordinal)) throw new Error("Image allocation is already resident or belongs to another owner");
      this.images.set(image.ordinal, image);
    } else if (operation.kind === "release-image") {
      this.require(operation.image); this.images.delete(operation.image.ordinal); this.animations.get(operation.image)?.stop();
    } else if (operation.kind === "update-image") this.require(operation.image);
  }

  update(image: RendererImage, level: number, content: ImageLevel): void {
    this.require(image);
    this.operations.push({ kind: "update-image", image, level, content });
  }

  release(image: RendererImage): void {
    this.require(image);
    this.images.delete(image.ordinal);
    this.animations.get(image)?.stop();
    this.operations.push({ kind: "release-image", image });
  }

  textureMode(filter: TextureSampling["filter"]): void { this.operations.push({ kind: "texture-mode", filter }); }

  require(image: RendererImage): void {
    if (image.owner !== this.owner || this.images.get(image.ordinal) !== image)
      throw new Error("Scene image belongs to another resource owner or has been released");
  }

  trackAnimation(image: RendererImage, update: (milliseconds: number) => void, onStop: () => void): () => void {
    this.require(image);
    if (this.animations.has(image)) throw new Error("Scene image already has an animation");
    const stop = (): void => {
      if (this.animations.delete(image)) onStop();
    };
    this.animations.set(image, { update, stop });
    return stop;
  }

  drainOperations(): readonly ImageResourceOperation[] {
    if (this.animations.size !== 0) {
      const milliseconds = this.clock.sample();
      if (!Number.isFinite(milliseconds)) throw new Error("Scene image animation clock must be finite");
      for (const animation of this.animations.values()) animation.update(milliseconds);
    }
    const result = this.operations;
    this.operations = [];
    return result;
  }

  close(): void { this.closed = true; for (const image of this.images.values()) this.release(image); }
}

export function rgbaImage(level: ImageLevel): RenderImage {
  return { kind: "rgba8", levels: [level], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
}
