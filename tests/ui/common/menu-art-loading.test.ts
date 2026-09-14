import { expect, test } from "bun:test";
import { loadMenuArtImage } from "../../../src/app/bootstrap/menu-art.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { decodePng } from "../../../src/formats/images/png.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import { menuArtFiles } from "../../../src/ui/common/art-manifest.ts";
import { loadNativeUiArt } from "../../../src/ui/common/assets.ts";

test("embedded menu artwork retains exact pixels with isolated concurrent copies", async () => {
  for (const file of menuArtFiles) {
    const expected = decodePng(await Bun.file(new URL(`../../../${file.file}`, import.meta.url)).bytes(), file.file);
    const [first, second] = await Promise.all([loadMenuArtImage(file.file), loadMenuArtImage(file.file)]);
    expect([first.width, first.height]).toEqual([expected.width, expected.height]);
    expect(Buffer.compare(first.pixels, expected.pixels)).toBe(0);
    expect(Buffer.compare(second.pixels, expected.pixels)).toBe(0);
    expect(first.pixels.buffer).not.toBe(second.pixels.buffer);
    first.pixels.fill(0);
    expect(Buffer.compare(second.pixels, expected.pixels)).toBe(0);
    expect(Buffer.compare((await loadMenuArtImage(file.file)).pixels, expected.pixels)).toBe(0);
  }
  await expect(loadMenuArtImage("unknown.png")).rejects.toThrow("Unknown menu artwork");
});

test("menu artwork belongs to each renderer and closing one preserves the other", async () => {
  const identity = createIdentityOwner("menu-art-loading");
  const first = new SceneImageRegistry({ identity: Symbol("first"), session: identity.session, generation: 0 });
  const second = new SceneImageRegistry({ identity: Symbol("second"), session: identity.session, generation: 0 });
  const [a, b] = await Promise.all([loadNativeUiArt("resource:test:font", first, loadMenuArtImage), loadNativeUiArt("resource:test:font", second, loadMenuArtImage)]);
  try {
    const left = a.picture("resource:engine-menu:background").image;
    const right = b.picture("resource:engine-menu:background").image;
    expect(left.owner).not.toBe(right.owner);
    expect(first.drainOperations().filter(operation => operation.kind === "create-image")).toHaveLength(5);
    expect(second.drainOperations().filter(operation => operation.kind === "create-image")).toHaveLength(5);
    a.close();
    expect(first.isResident(left)).toBe(false);
    expect(second.isResident(right)).toBe(true);
    expect(first.drainOperations().filter(operation => operation.kind === "release-image")).toHaveLength(5);
    expect(second.drainOperations()).toHaveLength(0);
  } finally { a.close(); b.close(); first.close(); second.close(); }
});
