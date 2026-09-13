import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { SceneModelRenderer } from "../../src/render/scene/models/renderer.ts";
import { ModelLightSampler } from "../../src/render/scene/models/light-sampler.ts";
import type { WorldViewInput } from "../../src/render/scene/world.ts";
import type { Vec3 } from "../../src/contracts/math.ts";
import { encodePng } from "../../src/formats/images/png.ts";

interface Probe { readonly renderer: SceneModelRenderer; readonly args: Parameters<SceneModelRenderer["prepare"]>; }
for (const backend of ["cpu", "gl"]) test.skipIf(process.env["QUAKE_BARREL_SHADOW"] !== "1")(`base1 barrel ${backend} shadows preserve lighting and count effect lights once`, async () => {
  const root = await mkdtemp("/tmp/q2-barrel-shadow-");
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--renderer", backend, "--hidden",
    "--width", "640", "--height", "480", "--seats", "2", "--gamma", "1", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Expected application launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  const prepare = SceneModelRenderer.prototype.prepare, sample = ModelLightSampler.prototype.sample;
  const probes: Probe[] = [], received: (readonly Vec3[])[] = [];
  let ordinary: WorldViewInput["lights"], barrel = false, omitShadowLights = false;
  const sampleHook = spyOn(ModelLightSampler.prototype, "sample").mockImplementation(function(this: ModelLightSampler, point, input, dynamic) {
    if (barrel && dynamic) received.push((input.lights ?? []).map(light => light.origin));
    return sample.call(this, point, barrel && omitShadowLights ? { ...input, lights: ordinary ?? [] } : input, dynamic);
  });
  const prepareHook = spyOn(SceneModelRenderer.prototype, "prepare").mockImplementation(function(this: SceneModelRenderer, ...args) {
    ordinary = args[1].lights;
    barrel = args[0].some(entity => entity.resource.requestedPath === "models/objects/barrels/tris.md2" && entity.transform.origin.x === 184);
    if (barrel) probes.push({ renderer: this, args });
    const batches = prepare.apply(this, args);
    if (barrel && !omitShadowLights) for (const batch of batches) if (batch.lighting.kind === "q2-model-shadow") {
      for (const component of ["x", "y", "z"] satisfies readonly (keyof Vec3)[])
        expect(batch.lighting.lights.reduce((sum, light) => sum + light.fraction[component], 0)).toBeLessThan(1);
    }
    barrel = false; return batches;
  });
  try {
    await app.step(25); await app.step(25); await app.step(25);
    const capture = async (name: string): Promise<Uint8Array> => {
      const pending = app.captureNextFrame(); await app.step(0.001); const pixels = await pending;
      await Bun.write(`/tmp/q2-barrel-shadow-${backend}-${name}.png`, encodePng(640, 480, pixels)); return pixels;
    };
    const after = await capture("after");
    const probe = probes.at(-1);
    if (probe === undefined || probe.args[1].q2FragmentLighting === undefined) throw new Error("Visible retail barrel has no shadow-light draw");
    const authored = probe.args[1].q2FragmentLighting.lights.filter(light => light.shadow.kind !== "none");
    expect(authored.length).toBeGreaterThan(0);
    const sampled = received.at(-1);
    if (sampled === undefined) throw new Error("Barrel lighting was not sampled");
    for (const light of authored) expect(sampled.filter(origin => origin === light.origin)).toHaveLength(1);
    expect(ordinary).toHaveLength(0);
    omitShadowLights = true;
    const before = await capture("before");
    let restoredSkin = 0;
    for (let y = 370; y < 451; y++) for (let x = 530; x < 599; x++) {
      const offset = (y * 640 + x) * 4;
      const oldLight = (before[offset] ?? 0) + (before[offset + 1] ?? 0) + (before[offset + 2] ?? 0);
      const newLight = (after[offset] ?? 0) + (after[offset + 1] ?? 0) + (after[offset + 2] ?? 0);
      if (oldLight < 6 && newLight > 60) restoredSkin++;
    }
    expect(restoredSkin).toBeGreaterThan(1500);
    omitShadowLights = false;
    const [entities, input, options] = probe.args;
    const effect = { origin: { x: 184, y: -24, z: 48 }, radius: 32, minimum: 0, color: { x: 0, y: 0.25, z: 0 } };
    const fragment = input.q2FragmentLighting;
    if (fragment === undefined) throw new Error("Missing fragment lighting");
    prepareHook.call(probe.renderer, entities, { ...input, lights: [...input.lights ?? [], effect], q2FragmentLighting: {
      ...fragment, lights: [...fragment.lights, { origin: effect.origin, radius: effect.radius, color: effect.color, scale: 1, cone: null, shadow: { kind: "none" } }] } }, options);
    const merged = received.at(-1);
    if (merged === undefined) throw new Error("Missing combined alias lighting");
    expect(merged.filter(origin => origin === effect.origin)).toHaveLength(1);
    expect(merged).toHaveLength((input.lights?.length ?? 0) + authored.length + 1);
    await Bun.write(`/tmp/q2-barrel-shadow-${backend}-evidence.json`, JSON.stringify({ restoredSkin, authoredLights: authored.length, combinedLights: merged.length }));
  } finally { prepareHook.mockRestore(); sampleHook.mockRestore(); await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
