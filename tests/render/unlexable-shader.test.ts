// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneShaderRegistry } from "../../src/render/scene/shaders.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";

// A shader script whose lexing throws contributes no shaders instead of aborting
// the load. Binary bytes lex as tokens, which the second test pins.
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

test("binary script bytes lex as tokens and register an entry named by the first token without aborting the load", async () => {
  const owner = createIdentityOwner("binary-shader");
  const registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ session: owner.session, generation: 0, identity: Symbol("binary") });
  const textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:base:binary"));
  shaders.addScript("\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\u0000\u0000\u0001\u0000", "scripts/binary.shader");
  expect(shaders.hasAuthored("\u0089PNG")).toBeTrue();
  shaders.addScript("good { { map $whiteimage } }", "scripts/good.shader");
  expect(shaders.hasAuthored("good")).toBeTrue();
  await textures.close();
});

test("shader files follow id's override order: the head shader of each non-last file, then the last-listed file first", async () => {
  const owner = createIdentityOwner("shader-order");
  const registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ session: owner.session, generation: 0, identity: Symbol("shader-order") });
  const textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:base:order"));
  shaders.addScriptFiles([
    { source: "scripts/a.shader", text: "head { { map $whiteimage } }\nlate { { map $whiteimage } }" },
    { source: "scripts/b.shader", text: "head { { videoMap b.roq } }\nlate { { videoMap b.roq } }\nonly { { videoMap b.roq } }" },
    { source: "scripts/c.shader", text: "tail { { videoMap c.roq } }\nlate { { map $whiteimage } }" },
  ]);
  expect(shaders.hasCinematic("head")).toBeFalse();
  expect(shaders.hasCinematic("late")).toBeFalse();
  expect(shaders.hasCinematic("only")).toBeTrue();
  expect(shaders.hasCinematic("tail")).toBeTrue();
  await textures.close();
});
