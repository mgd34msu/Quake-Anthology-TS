import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import { SceneShaderRegistry } from "../../src/render/scene/shaders.ts";
import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import type { MaterialPicture } from "../../src/text/draw2d.ts";

function image(picture: MaterialPicture) {
  const stage = picture.material.compiled.registered.stages[0];
  if (stage?.kind !== "loaded" || stage.binding.kind !== "images" || stage.binding.playback.kind !== "single")
    throw new Error("Font picture lost its atlas");
  return stage.binding.playback.image.image;
}

for (const source of [false, true]) for (const missingFirst of [false, true]) test(`generated font atlas survives named glyph lookup and refresh, source=${source}, missingFirst=${missingFirst}`, async () => {
  const owner = { identity: Symbol("font-images"), session: createIdentityOwner("font-images").session, generation: 0 };
  const images = new SceneImageRegistry(owner);
  const textures = new SceneTextureLoader(images, { read: async () => null });
  const replacementTextures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:font-test"));
  try {
    if (source) await shaders.initializeSourceMaterials(async () => {});
    const missing = missingFirst ? await shaders.registerPicture("fonts/fontImage_0_19.tga") : null;
    if (missing !== null) expect(image(missing)).toBe(textures.missing.image);
    const pixels = new Uint8Array([255, 255, 255, 17, 255, 255, 255, 239]);
    const picture = await shaders.registerGeneratedPicture("fonts/fontImage_0_19.tga", {
      kind: "rgba8", levels: [{ width: 1, height: 2, pixels }], borderColor: { x: 0, y: 0, z: 0, w: 0 },
    });
    const original = image(picture);
    if (missing !== null) expect(picture.material.compiled).toBe(missing.material.compiled);
    expect(original.source).toEqual({ kind: "generated", name: "fonts/fontImage_0_19.tga" });
    const named = source ? await shaders.registerSourcePicture("fonts/fontImage_0_19.tga") : await shaders.registerPicture("fonts/fontImage_0_19.tga");
    expect(named?.material.compiled).toBe(picture.material.compiled);
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    shaders.commitReplacement(replacement);
    const refreshed = await shaders.registerPicture("fonts/fontImage_0_19.tga");
    expect(refreshed.material.compiled).toBe(picture.material.compiled);
    expect(image(refreshed)).not.toBe(original);
    expect(image(refreshed).width).toBe(1);
    expect(image(refreshed).height).toBe(2);
  } finally { textures.close(); replacementTextures.close(); images.close(); }
});
