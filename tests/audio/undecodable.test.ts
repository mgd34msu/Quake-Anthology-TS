import { expect, test } from "bun:test";
import { SoundBank } from "../../src/audio/index.ts";
import { MountedContent } from "../../src/content/mounts/index.ts";
import type { OpenedResource } from "../../src/content/mounts/index.ts";
import { createContentId, createContentDigest, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ContentId, ResolvedResourceReference } from "../../src/contracts/content.ts";

class MemoryMounts extends MountedContent {
  constructor(readonly content: ContentId, private readonly files: ReadonlyMap<string, Uint8Array>) {
    super({ id: createMountPlanId("sound-memory", content.replaceAll(":", "-")), mounts: [], defaultOrder: [], prefixOrders: [] }, []);
  }
  override async listFiles(path: string, extension: string): Promise<readonly string[]> {
    return [...this.files.keys()].filter(name => name.startsWith(path + "/") && name.endsWith(extension)).map(name => name.slice(path.length + 1));
  }
  override async open(path: string): Promise<OpenedResource | null> {
    this.assertOpen();
    const bytes = this.files.get(path); if (bytes === undefined) return null;
    const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, byteLength: bytes.length,
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/sound-memory",
        identity: createMountIdentity(createMountId("sound-memory", this.content.replaceAll(":", "-")), this.content, 0) } },
      resolution: { kind: "default-order", plan: this.plan.id, rank: 0 } };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
}

// A present-but-undecodable sound or music file must behave like the
// already-handled missing one (warn + silence), never abort the load.
test("undecodable sound and music register as unavailable", async () => {
  const content = createContentId({ family: "q1", edition: "test", package: "sound", revision: "1" });
  const garbage = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);
  const mounts = new MemoryMounts(content, new Map([
    ["sound/misc/bad.wav", garbage], ["music/track02.ogg", garbage]]));
  const bank = new SoundBank(mounts);
  expect(await bank.register("misc/bad.wav", "q1")).toBeNull();
  expect(await bank.openMusic("music/track02.ogg")).toBeNull();
});
