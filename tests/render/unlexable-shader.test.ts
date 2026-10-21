import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneShaderRegistry } from "../../src/render/scene/shaders.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";

// A shader script that cannot be lexed at all (binary garbage, foreign
// encoding) contributes no shaders instead of aborting the load.
test("unlexable shader script registers nothing and does not throw", async () => {
  const owner = createIdentityOwner("unlexable-shader");
  const registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ session: owner.session, generation: 0, identity: Symbol("unlexable") });
  const textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:base:unlexable"));
  shaders.addScript("x " + "{".repeat(100000), "scripts/bad.shader");
  expect(shaders.hasAuthored("x")).toBeFalse();
  shaders.addScript("good { { map $whiteimage } }", "scripts/good.shader");
  expect(shaders.hasAuthored("good")).toBeTrue();
  await textures.close();
});
