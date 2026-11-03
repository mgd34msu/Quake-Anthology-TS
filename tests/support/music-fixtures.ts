// SPDX-License-Identifier: GPL-2.0-or-later
import { LoadedApplicationContent } from "../../src/app/bootstrap/content.ts";
import { MountedContent } from "../../src/content/mounts/index.ts";
import type { OpenedResource } from "../../src/content/mounts/index.ts";
import type { ResolvedResourceReference, ContentId } from "../../src/contracts/content.ts";
import { createContentDigest, createResourceId, createMountPlanId, createMountIdentity, createMountId } from "../../src/contracts/content.ts";

export function musicWave(sample: number): Uint8Array {
  const bytes = new Uint8Array(44 + 64),
    view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): void => {
    bytes.set(new TextEncoder().encode(value), offset);
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, 64, true);
  for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, sample, true);
  return bytes;
}

export class MusicMemoryMounts extends MountedContent {
  constructor(
    readonly content: ContentId,
    private readonly files: ReadonlyMap<string, Uint8Array>,
  ) {
    super({ id: createMountPlanId("music-memory", content.replaceAll(":", "-")), mounts: [], defaultOrder: [], prefixOrders: [] }, []);
  }
  override async open(path: string): Promise<OpenedResource | null> {
    this.assertOpen();
    const bytes = this.files.get(path);
    if (bytes === undefined) return null;
    const record: Omit<ResolvedResourceReference, "id"> = {
      requestedPath: path,
      byteLength: bytes.length,
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      provenance: {
        kind: "loose",
        memberPath: path,
        mount: {
          kind: "loose",
          rootPath: "/music-memory",
          identity: createMountIdentity(createMountId("music-memory", this.content.replaceAll(":", "-")), this.content, 0),
        },
      },
      resolution: { kind: "default-order", plan: this.plan.id, rank: 0 },
    };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
}

export class MusicContent extends LoadedApplicationContent {
  override async forContent(content: ContentId): Promise<MountedContent> {
    if (content !== this.recipe.map.entities.content) throw new Error("Wrong music content owner");
    return this.mounts;
  }
}
