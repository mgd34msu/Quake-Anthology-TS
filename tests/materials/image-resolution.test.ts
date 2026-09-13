import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { encodePcx } from "../../src/formats/images/indexed.ts";
import { encodeJpeg } from "../../src/formats/images/jpeg-encoder.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import type { SceneAsset } from "../../src/render/scene/textures.ts";

function bmp(width: number, height: number): Uint8Array {
  const stride = Math.ceil(width * 3 / 4) * 4, bytes = new Uint8Array(54 + stride * height), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  bytes.fill(96, 54); return bytes;
}
function asset(bytes: Uint8Array, name: string): SceneAsset { return { bytes, source: { kind: "generated", name } }; }
function loader(files: ReadonlyMap<string, SceneAsset>, originals: ReadonlyMap<string, SceneAsset> = new Map<string, SceneAsset>()): SceneTextureLoader {
  return new SceneTextureLoader(new SceneImageRegistry({ identity: Symbol("image-resolution"), session: createIdentityOwner("image-resolution").session, generation: 0 }), {
    read: async path => files.get(path) ?? null, readOriginal: async path => originals.get(path) ?? null,
  });
}

test("Q2 explicit, extensionless and absent native requests discover JPEG and BMP", async () => {
  const pixels = new Uint8Array(8 * 8 * 4).fill(192);
  for (const [extension, bytes] of new Map([["jpeg", encodeJpeg({ width: 8, height: 8, pixels }, 90)], ["bmp", bmp(8, 8)]])) {
    const textures = loader(new Map([[`pics/example.${extension}`, asset(bytes, extension)], [`textures/example.${extension}`, asset(bytes, extension)]]));
    try {
      for (const path of [`pics/example.${extension}`, "pics/example", "pics/example.pcx", "textures/example.wal", "textures/example"]) {
        const result = await textures.load(path, { family: "q2", mipmap: false });
        expect(result?.image.source).toEqual({ kind: "generated", name: extension });
        expect(result?.image.width).toBe(8);
      }
    } finally { textures.close(); textures.images.close(); }
  }
});

test("Q2 retains original requested PCX dimensions and same-format BMP dimensions without shrinking uploaded pixels", async () => {
  const originalPcx = encodePcx({ width: 2, height: 3, indices: new Uint8Array(6) }, new Uint8Array(768));
  const textures = loader(new Map([["pics/icon.bmp", asset(bmp(8, 8), "replacement")]]), new Map([
    ["pics/icon.pcx", asset(originalPcx, "native")], ["pics/icon.bmp", asset(bmp(4, 5), "original-bmp")],
  ]));
  try {
    const pcx = await textures.load("pics/icon.pcx", { family: "q2", mipmap: false });
    expect([pcx?.width, pcx?.height, pcx?.image.width, pcx?.image.height]).toEqual([2, 3, 8, 8]);
    const bitmap = await textures.load("pics/icon.bmp", { family: "q2", mipmap: false });
    expect([bitmap?.width, bitmap?.height, bitmap?.image.width, bitmap?.image.height]).toEqual([4, 5, 8, 8]);
  } finally { textures.close(); textures.images.close(); }
});

test("Q2 picture dimensions ignore an unrelated same-basename WAL or PCX", async () => {
  const textures = loader(new Map([
    ["pics/icon.bmp", asset(bmp(8, 8), "bitmap")], ["pics/icon.wal", asset(new Uint8Array(), "unrelated-invalid-wal")],
    ["pics/icon.pcx", asset(new Uint8Array(), "unrelated-invalid-pcx")],
  ]));
  try {
    const result = await textures.load("pics/icon.bmp", { family: "q2", mipmap: false });
    expect([result?.width, result?.height]).toEqual([8, 8]);
  } finally { textures.close(); textures.images.close(); }
});
