import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import type { ProductExpectation } from "../../src/content/catalog/products.ts";
import { openMountPlan, digestFile } from "../../src/content/mounts/index.ts";
import { mountedImageReader } from "../../src/app/bootstrap/image-reader.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";

function bmp(width: number): Uint8Array {
  const stride = Math.ceil(width * 3 / 4) * 4, bytes = new Uint8Array(54 + stride * width), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, width, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); bytes.fill(96, 54); return bytes;
}
function pak(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + bytes.length + 64), view = new DataView(result.buffer), directory = 12 + bytes.length;
  result.set(new TextEncoder().encode("PACK")); view.setUint32(4, directory, true); view.setUint32(8, 64, true); result.set(bytes, 12);
  result.set(new TextEncoder().encode("pics/icon.bmp"), directory); view.setUint32(directory + 56, 12, true); view.setUint32(directory + 60, bytes.length, true); return result;
}
function product(id: string, baseProduct: string | null): ProductExpectation {
  return { id, family: "q2", edition: "classic", campaign: id, title: id, contentDirectory: `q2/${id}`, baseProduct,
    requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null };
}

test("mounted image originals preserve product precedence, pure policy and user-only mod dimensions", async () => {
  const root = await mkdtemp(join(tmpdir(), "image-original-")), corpusRoot = join(root, "corpus"), userContentRoot = join(root, "user");
  try {
    for (const [directory, size] of new Map([[join(corpusRoot, "q2/base"), 2], [join(corpusRoot, "q2/mod"), 4], [join(userContentRoot, "q2/mod"), 8], [join(userContentRoot, "q2/download"), 16]])) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, "pak0.pak"), pak(bmp(size)));
    }
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [product("base", null), product("mod", "base")] });
    for (const id of ["mod", "download"]) {
      const mounts = await catalog.mountsFor(catalog.require(id === "download" ? "q2-classic-download" : id).id), plan = { id: "mount-plan:image:original", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] } satisfies Parameters<typeof openMountPlan>[0];
      using mounted = await openMountPlan(plan);
      const reader = mountedImageReader(catalog, mounted), images = new SceneImageRegistry({ identity: Symbol(id), session: createIdentityOwner(id).session, generation: 0 });
      const textures = new SceneTextureLoader(images, reader);
      try {
        const texture = await textures.load("pics/icon.bmp", { family: "q2", mipmap: false });
        expect([texture?.width, texture?.image.width]).toEqual(id === "mod" ? [4, 8] : [16, 16]);
        const original = await reader.readOriginal?.("pics/icon.bmp");
        if (id === "download") expect(original).toBeNull();
        else {
          expect(original?.source.kind).toBe("resource");
          if (original?.source.kind !== "resource") throw new Error("Expected original provenance");
          expect(original.source.resource.provenance.mount.identity.content).toBe(catalog.require("mod").id);
          expect(original.source.resource.provenance.mount.kind).toBe("archive");
        }
      } finally { textures.close(); images.close(); }
      using pure = await openMountPlan(plan, { pure: { archives: [await digestFile(join(userContentRoot, `q2/${id}/pak0.pak`))] } });
      expect(await mountedImageReader(catalog, pure).readOriginal?.("pics/icon.bmp")).toBeNull();
      if (id === "mod") {
        const baseMounts = mounts.filter(mount => mount.identity.content === catalog.require("base").id);
        const order = [...baseMounts, ...mounts.filter(mount => !baseMounts.includes(mount))].map(mount => mount.identity.id);
        using prefixed = await openMountPlan({ ...plan, prefixOrders: [{ prefix: "pics/", mounts: order }] });
        const originalReader = mountedImageReader(catalog, prefixed), opened = spyOn(prefixed, "open");
        try {
          const original = await originalReader.read("pics/icon.bmp");
          if (original?.source.kind !== "resource") throw new Error("Expected prefix provenance");
          expect(original.source.resource.provenance.mount.identity.content).toBe(catalog.require("base").id);
          expect(original.source.resource.resolution.kind).toBe("prefix-order");
          expect(await originalReader.readOriginal?.("pics/icon.bmp")).toBeNull();
          expect(opened).toHaveBeenCalledTimes(1);
          prefixed.close();
          await expect(originalReader.readOriginal?.("pics/icon.bmp")).rejects.toThrow("closed");
        } finally { opened.mockRestore(); }
        const userRoot = catalog.require("mod").userContent?.root;
        const loose = mounts.find(mount => mount.kind === "loose" && mount.rootPath === userRoot);
        if (userRoot === undefined || loose === undefined) throw new Error("Missing user loose mount");
        await mkdir(join(userRoot, "pics")); await writeFile(join(userRoot, "pics/icon.bmp"), bmp(8));
        using linked = await openMountPlan(plan, { links: [{ sourcePrefix: "pics/", targetPrefix: "pics/", mount: loose.identity.id }] });
        expect(await mountedImageReader(catalog, linked).readOriginal?.("pics/icon.bmp")).toBeNull();
      }
      mounted.close();
      await expect(reader.readOriginal?.("pics/icon.bmp")).rejects.toThrow("closed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
