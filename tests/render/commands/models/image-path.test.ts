import { expect, test } from "bun:test";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { normalizeResourcePath } from "../../../../src/content/mounts/paths.ts";
import { parseMd2 } from "../../../../src/formats/q12-model/index.ts";
import { decodePcx } from "../../../../src/formats/images/index.ts";
import { modelImagePath } from "../../../../src/render/scene/models/image-path.ts";

test("model images resolve contained parent references without weakening mount paths", () => {
  expect(modelImagePath("models/monsters/tank/../ctank/skin.png")).toBe("models/monsters/ctank/skin.png");
  expect(modelImagePath("models\\monsters\\tank\\..\\ctank\\skin.pcx")).toBe("models/monsters/ctank/skin.pcx");
  expect(modelImagePath("./models/monsters/tank/skin.pcx")).toBe("models/monsters/tank/skin.pcx");
  for (const name of ["../skin.pcx", "models/../../skin.pcx", "/models/skin.pcx", "C:\\skin.pcx", "models/skin\0.pcx", "models//skin.pcx", "models/..", "./C:/skin.pcx"]) {
    expect(() => modelImagePath(name)).toThrow();
  }
  expect(() => normalizeResourcePath("models/monsters/tank/../ctank/skin.pcx")).toThrow();
});

test("retail Q2 tank embedded sibling skins resolve to actual archive images", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
  try {
    const entry = archive.findEntries("models/monsters/tank/tris.md2")[0];
    if (entry === undefined) throw new Error("Missing retail tank model");
    const model = parseMd2(await archive.readEntry(entry));
    const siblings = model.skins.filter(name => name.includes("../"));
    expect(siblings.length).toBeGreaterThan(0);
    for (const name of siblings) {
      const path = modelImagePath(name);
      expect(normalizeResourcePath(path)).toBe(path);
      const skin = archive.findEntries(path)[0];
      if (skin === undefined) throw new Error(`Missing actual tank sibling skin: ${path}`);
      const image = decodePcx(await archive.readEntry(skin), path);
      expect(image.width).toBe(model.skinWidth);
      expect(image.height).toBe(model.skinHeight);
    }
  } finally { archive.close(); }
});
