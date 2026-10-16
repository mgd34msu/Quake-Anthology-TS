import { expect, test } from "bun:test";
import { corpusHasFile, testCorpusRoot } from "../support/corpus.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { openMountPlan, type MountedContent } from "../../src/content/mounts/index.ts";
import { createMountPlanId, type ContentId } from "../../src/contracts/content.ts";
import { loadCharacterTurntableScene, renderCharacterTurntable, type CharacterTurntableRequest } from "../../src/app/bootstrap/character-turntable.ts";
import type { ImageLevel } from "../../src/contracts/render.ts";

const corpusAvailable = corpusHasFile("q1/id1/pak0.pak") && corpusHasFile("q2/baseq2/pak0.pak") && corpusHasFile("q3a/baseq3/pak0.pk3");

function visiblePixels(image: ImageLevel): number {
  let count = 0;
  for (let offset = 3; offset < image.pixels.length; offset += 4) if ((image.pixels[offset] ?? 0) > 20) count++;
  return count;
}

function differingBytes(left: ImageLevel, right: ImageLevel): number {
  expect(right.pixels.length).toBe(left.pixels.length);
  let count = 0;
  for (let offset = 0; offset < left.pixels.length; offset++) if (left.pixels[offset] !== right.pixels[offset]) count++;
  return count;
}

test.skipIf(!corpusAvailable)("turntable renders installed Q1 colors and Q2/Q3 skins as rotating models", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), discoverMods: false });
  const openedMounts: MountedContent[] = [];
  const mountedFor = async (id: string): Promise<{ readonly product: ContentId; readonly mounts: MountedContent }> => {
    const product = catalog.require(id).id;
    const mounts = await catalog.mountsFor(product);
    const mounted = await openMountPlan({ id: createMountPlanId("test", id), mounts,
      defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    openedMounts.push(mounted);
    return { product, mounts: mounted };
  };
  const render = async (id: string, request: Omit<CharacterTurntableRequest, "product">, yaw = 0): Promise<ImageLevel> => {
    const { product, mounts } = await mountedFor(id);
    const scene = await loadCharacterTurntableScene(mounts, { product, ...request });
    const image = renderCharacterTurntable(scene, scene.initialYaw + yaw, 192, 256);
    expect(visiblePixels(image)).toBeGreaterThan(2500);
    return image;
  };
  try {
    const q1Colored = await render("q1-classic-id1", { family: "q1", model: "player", skin: "", topColor: 4, bottomColor: 12 });
    const q1White = await render("q1-classic-id1", { family: "q1", model: "player", skin: "", topColor: 0, bottomColor: 0 });
    expect(differingBytes(q1Colored, q1White)).toBeGreaterThan(1000);

    const q2Grunt = await render("q2-classic-baseq2", { family: "q2", model: "male", skin: "grunt", topColor: 0, bottomColor: 0 });
    const q2Cipher = await render("q2-classic-baseq2", { family: "q2", model: "male", skin: "cipher", topColor: 0, bottomColor: 0 });
    expect(differingBytes(q2Grunt, q2Cipher)).toBeGreaterThan(500);

    const q3Blue = await render("q3-baseq3", { family: "q3", model: "sarge", skin: "blue", topColor: 0, bottomColor: 0 });
    const q3Red = await render("q3-baseq3", { family: "q3", model: "sarge", skin: "red", topColor: 0, bottomColor: 0 });
    const q3Rotated = await render("q3-baseq3", { family: "q3", model: "sarge", skin: "blue", topColor: 0, bottomColor: 0 }, 2.1);
    expect(differingBytes(q3Blue, q3Red)).toBeGreaterThan(500);
    expect(differingBytes(q3Blue, q3Rotated)).toBeGreaterThan(1000);

    // Q3 diffuse TGA alpha is ancillary data, not cutout transparency. Skins
    // such as Ranger/Wrack and models such as Tank Jr. and Xaero encode most
    // of that channel near zero while their RGB geometry is fully opaque.
    const q3RangerDefault = await render("q3-baseq3", { family: "q3", model: "ranger", skin: "", topColor: 0, bottomColor: 0 });
    const q3RangerWrack = await render("q3-baseq3", { family: "q3", model: "ranger", skin: "wrack", topColor: 0, bottomColor: 0 });
    expect(visiblePixels(q3RangerWrack)).toBe(visiblePixels(q3RangerDefault));
    expect(differingBytes(q3RangerDefault, q3RangerWrack)).toBeGreaterThan(500);
    for (const request of [
      { family: "q3", model: "ranger", skin: "wrack", topColor: 0, bottomColor: 0 },
      { family: "q3", model: "tankjr", skin: "", topColor: 0, bottomColor: 0 },
      { family: "q3", model: "xaero", skin: "", topColor: 0, bottomColor: 0 },
    ] satisfies readonly Omit<CharacterTurntableRequest, "product">[]) {
      const { product, mounts } = await mountedFor("q3-baseq3");
      const scene = await loadCharacterTurntableScene(mounts, { product, ...request });
      let nonOpaque = 0;
      for (const texture of scene.textures)
        for (let offset = 3; offset < texture.pixels.length; offset += 4)
          if (texture.pixels[offset] !== 255) nonOpaque++;
      expect(nonOpaque).toBe(0);
    }

    // Several retail skins name Quake 3 script shaders rather than image
    // files. Those surfaces must resolve through scripts/*.shader instead
    // of falling back to the missing-texture checker.
    const isMissingChecker = (texture: { readonly width: number; readonly height: number; readonly pixels: Uint8Array }): boolean =>
      texture.width === 16 && texture.height === 16
      && texture.pixels[0] === 72 && texture.pixels[1] === 72 && texture.pixels[2] === 78
      && texture.pixels[4] === 38 && texture.pixels[5] === 38 && texture.pixels[6] === 44;
    for (const request of [
      { family: "q3", model: "crash", skin: "", topColor: 0, bottomColor: 0 },
      { family: "q3", model: "hunter", skin: "harpy", topColor: 0, bottomColor: 0 },
      { family: "q3", model: "razor", skin: "patriot", topColor: 0, bottomColor: 0 },
      { family: "q3", model: "tim", skin: "red", topColor: 0, bottomColor: 0 },
    ] satisfies readonly Omit<CharacterTurntableRequest, "product">[]) {
      const { product, mounts } = await mountedFor("q3-baseq3");
      const scene = await loadCharacterTurntableScene(mounts, { product, ...request });
      expect(scene.textures.some(isMissingChecker)).toBe(false);
    }
  } finally {
    for (const mounts of openedMounts.reverse()) mounts.close();
  }
});
