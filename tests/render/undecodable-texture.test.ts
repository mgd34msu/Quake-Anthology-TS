import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";

function bmp1x1(): Uint8Array {
  const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77; // BM
  view.setUint32(2, 58, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, 1, true); view.setInt32(22, 1, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 4, true);
  bytes[54] = 10; bytes[55] = 20; bytes[56] = 30;
  return bytes;
}

function loader(files: ReadonlyMap<string, Uint8Array>, strict = false): SceneTextureLoader {
  const owner = createIdentityOwner("undecodable-texture");
  const images = new SceneImageRegistry({ session: owner.session, generation: 0, identity: Symbol("undecodable") });
  return new SceneTextureLoader(images, {
    read: async path => {
      const bytes = files.get(path);
      return bytes === undefined ? null : { bytes, source: { kind: "generated", name: path } };
    },
  }, null, { strict });
}

// Source engines try each image extension in turn and fall back to a
// default texture; one corrupt loose replacement must not abort the load.
test("undecodable texture candidate falls through to the next extension", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const textures = loader(new Map([["textures/e1/wall.tga", garbage], ["textures/e1/wall.bmp", bmp1x1()]]));
  const loaded = await textures.load("textures/e1/wall");
  expect(loaded).not.toBeNull();
  expect(loaded?.width).toBe(1);
});

test("all-undecodable texture candidates resolve as missing", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const textures = loader(new Map([["textures/e1/wall.tga", garbage], ["textures/e1/wall.bmp", garbage]]));
  expect(await textures.load("textures/e1/wall")).toBeNull();
});

// Staged replacement loaders (explicit settings changes) stay strict so a
// malformed replacement rejects the whole change atomically.
test("strict staging loader still rejects undecodable candidates", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const textures = loader(new Map([["textures/e1/wall.tga", garbage], ["textures/e1/wall.bmp", bmp1x1()]]), true);
  await expect(textures.load("textures/e1/wall")).rejects.toThrow();
});
