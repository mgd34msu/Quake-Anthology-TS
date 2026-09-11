// SPDX-License-Identifier: GPL-2.0-or-later
import type { MountedContent, OpenedResource } from "../content/mounts/index.ts";
import type { SceneImageRegistry } from "../render/scene/resources.ts";
import { TextFontRegistry } from "./atlas.ts";
import type { FontFileReader, RetainedFontFile } from "./draw2d.ts";

/** Reads obey the mount plan; generated glyph uploads share the scene image queue. */
export function createMountedTextFonts(content: MountedContent, images: SceneImageRegistry): TextFontRegistry {
  return new TextFontRegistry({
    async read(path) { return (await content.open(path))?.bytes ?? null; },
    async registerImage(name, image) { return images.register(name, image, { wrap: "clamp", filter: "linear" }); },
    releaseImage(image) { images.release(image); },
  });
}

/** Retained source reads preserve Q3's DAT publication and FreeType byte lifetimes. */
export class MountedFontReader implements FontFileReader {
  private readonly files = new Map<string, Promise<OpenedResource | null>>();
  private readonly retained = new Set<RetainedFontFile>();
  constructor(private readonly content: MountedContent) {}
  async readFileLength(path: string): Promise<number> { return (await this.open(path))?.reference.byteLength ?? -1; }
  async readFileRetained(path: string): Promise<RetainedFontFile | undefined> {
    const resource = await this.open(path);
    if (resource === null) return undefined;
    const file = { bytes: resource.bytes.slice(), length: resource.bytes.length, reference: resource.reference };
    this.retained.add(file); return file;
  }
  freeFile(file: RetainedFontFile): void { this.retained.delete(file); }
  close(): void { this.retained.clear(); this.files.clear(); }
  private open(path: string): Promise<OpenedResource | null> {
    const cached = this.files.get(path);
    if (cached !== undefined) return cached;
    const pending = this.content.open(path);
    this.files.set(path, pending); return pending;
  }
}
