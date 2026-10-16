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
  } finally {
    for (const mounts of openedMounts.reverse()) mounts.close();
  }
});
