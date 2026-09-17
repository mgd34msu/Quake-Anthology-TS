import type { ImageResourceOperation, RendererBackend, RenderImage } from "../contracts/render.ts";

interface ResidentImage {
  beforeTextureMode: boolean;
  readonly creation: Extract<ImageResourceOperation, { readonly kind: "create-image" }>;
  readonly updates: Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>;
}

function snapshotImage(content: RenderImage): RenderImage {
  if (content.kind === "depth32f") {
    const [first, ...rest] = content.levels;
    return { ...content, levels: [{ ...first, pixels: first.pixels.slice() }, ...rest.map(level => ({ ...level, pixels: level.pixels.slice() }))] };
  }
  const [first, ...rest] = content.levels;
  const levels: typeof content.levels = [{ ...first, pixels: first.pixels.slice() }, ...rest.map(level => ({ ...level, pixels: level.pixels.slice() }))];
  return content.kind === "rgba8" ? { ...content, levels, borderColor: { ...content.borderColor } }
    : { ...content, levels, palette: { ...content.palette, colors: content.palette.colors.slice() }, translation: content.translation?.slice() ?? null,
      transparency: { ...content.transparency }, fullbright: content.fullbright === null ? null : { ...content.fullbright } };
}

/** Successful image mutations retained for resize and renderer replacement. */
export class RenderImageJournal {
  private readonly resident = new Map<number, ResidentImage>();
  private textureMode: Extract<ImageResourceOperation, { readonly kind: "texture-mode" }> | null = null;

  replay(backend: Pick<RendererBackend, "applyImageResource">): void {
    const upload = (record: ResidentImage): void => {
      backend.applyImageResource(record.creation);
      for (const update of record.updates.values()) backend.applyImageResource(update);
    };
    for (const record of this.resident.values()) if (record.beforeTextureMode) upload(record);
    if (this.textureMode !== null) backend.applyImageResource(this.textureMode);
    for (const record of this.resident.values()) if (!record.beforeTextureMode) upload(record);
  }

  record(operation: ImageResourceOperation): void {
    switch (operation.kind) {
      case "create-image": {
        const updates: ResidentImage["updates"] = new Map<number, Extract<ImageResourceOperation, { readonly kind: "update-image" }>>();
        this.resident.set(operation.image.ordinal, { creation: { ...operation, content: snapshotImage(operation.content), sampling: { ...operation.sampling } }, updates, beforeTextureMode: false }); break;
      }
      case "update-image": {
        const record = this.resident.get(operation.image.ordinal);
        if (record === undefined) throw new Error("Renderer update has no resident image");
        const content = operation.content;
        record.updates.set(operation.level, content.pixels instanceof Float32Array
          ? { ...operation, content: { ...content, pixels: content.pixels.slice() } }
          : { ...operation, content: { ...content, pixels: content.pixels.slice() } }); break;
      }
      case "release-image": this.resident.delete(operation.image.ordinal); break;
      case "texture-mode": this.textureMode = operation; for (const record of this.resident.values()) record.beforeTextureMode = true; break;
    }
  }

  describe(): readonly { readonly ordinal: number; readonly name: string; readonly width: number; readonly height: number; readonly encoding: RenderImage["kind"]; readonly mipLevels: number }[] {
    return [...this.resident.values()].map(({ creation, updates }) => {
      const level = updates.get(0)?.content ?? creation.content.levels[0];
      return { ordinal: creation.image.ordinal, name: creation.image.source.kind === "generated" ? creation.image.source.name : creation.image.source.resource.requestedPath,
        width: level.width, height: level.height, encoding: creation.content.kind, mipLevels: creation.content.levels.length };
    });
  }

  clear(): void { this.resident.clear(); this.textureMode = null; }
}
