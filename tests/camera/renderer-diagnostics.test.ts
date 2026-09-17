import { expect, test } from "bun:test";
import { registerRendererDiagnostics } from "../../src/app/bootstrap/renderer-diagnostics.ts";
import type { RendererDiagnostics } from "../../src/app/bootstrap/renderer.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneShaderRegistry } from "../../src/render/scene/shaders.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";

test("shader diagnostics preserve registration order and resolve sorted order at dispatch", async () => {
  const owner = createIdentityOwner("renderer-diagnostics");
  const registrations = new SceneMaterialRegistrations(), images = new SceneImageRegistry({ session: owner.session, generation: 0, identity: Symbol("diagnostics") });
  const textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:base:diagnostics"));
  shaders.addScript("late { sort 9 { map $whiteimage } } early { sort 2 { map $whiteimage } }");
  const late = await shaders.register("late"), early = await shaders.register("early");
  expect(registrations.snapshot(false)).toEqual([late, early]); expect(registrations.snapshot()).toEqual([early, late]);
  const commands = new CommandBuffer({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
  const output: string[] = [];
  let current: RendererDiagnostics = { backend: "cpu", width: 640, height: 480, driver: null, images: [], displayModes: [] };
  const unregister = registerRendererDiagnostics({ commands, renderer: () => current, shaders: sorted => registrations.snapshot(sorted),
    resources: () => ({ models: [], skins: [{ path: "skins/test.skin", handle: 3, skin: { path: "skins/test.skin", surfaces: [{ name: "head", shader: "early" }] } }] }), print: text => { output.push(text); } });
  commands.executeNow("shaderlist"); const unsorted = output.pop() ?? "";
  expect(unsorted.indexOf("late")).toBeLessThan(unsorted.indexOf("early"));
  commands.executeNow("shaderlist sorted"); const sorted = output.pop() ?? "";
  expect(sorted.indexOf("early")).toBeLessThan(sorted.indexOf("late"));
  commands.executeNow("imagelist"); expect(output.pop()).toContain("0 resident images");
  current = { ...current, images: [{ ordinal: 19, name: "resident", width: 16, height: 8, encoding: "rgba8", mipLevels: 1 }], displayModes: [{ width: 800, height: 600, colorBits: 24, refreshRate: 75 }] };
  commands.executeNow("imagelist"); expect(output.pop()).toContain("19 16 8 rgba8 1 resident");
  commands.executeNow("skinlist"); expect(output.pop()).toContain("3 skins/test.skin\n  head = early");
  commands.executeNow("modellist"); expect(output.pop()).toContain("0 registered models");
  commands.executeNow("modelist"); expect(output.pop()).toContain("800x600 24 bit 75 Hz");
  commands.executeNow("gfxinfo"); expect(output.pop()).toContain("driver: software renderer");
  current = { ...current, backend: "gl", driver: { vendor: "fixture vendor", renderer: "fixture driver", version: "4.5", shadingLanguage: "4.50" } };
  commands.executeNow("gfxinfo"); expect(output.pop()).toContain("renderer: fixture driver");
  unregister(); expect(commands.exists("gfxinfo")).toBe(false); images.close();
});
