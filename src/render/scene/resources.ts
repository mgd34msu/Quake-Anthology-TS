import type { ImageLevel, ImageResourceOperation, RenderImage, RendererImage, RendererResourceOwner, TextureSampling } from "../../contracts/render.ts";

/** Session-owned images. Uploads and releases enter the same queue as their draws. */
export class SceneImageRegistry {
  private ordinal = 0;
  private readonly images = new Map<number, RendererImage>();
  private operations: ImageResourceOperation[] = [];

  constructor(readonly owner: RendererResourceOwner) {}

  register(name: string, content: RenderImage, sampling: TextureSampling,
    source: RendererImage["source"] = { kind: "generated", name }): RendererImage {
    const level = content.levels[0];
    const image: RendererImage = { owner: this.owner, ordinal: this.ordinal++, source, width: level.width, height: level.height };
    this.images.set(image.ordinal, image);
    this.operations.push({ kind: "create-image", image, content, sampling });
    return image;
  }

  update(image: RendererImage, level: number, content: ImageLevel): void {
    this.require(image);
    this.operations.push({ kind: "update-image", image, level, content });
  }

  release(image: RendererImage): void {
    this.require(image);
    this.images.delete(image.ordinal);
    this.operations.push({ kind: "release-image", image });
  }

  textureMode(filter: TextureSampling["filter"]): void { this.operations.push({ kind: "texture-mode", filter }); }

  require(image: RendererImage): void {
    if (image.owner !== this.owner || this.images.get(image.ordinal) !== image)
      throw new Error("Scene image belongs to another resource owner or has been released");
  }

  drainOperations(): readonly ImageResourceOperation[] {
    const result = this.operations;
    this.operations = [];
    return result;
  }

  close(): void { for (const image of this.images.values()) this.release(image); }
}

export function rgbaImage(level: ImageLevel): RenderImage {
  return { kind: "rgba8", levels: [level], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
}
