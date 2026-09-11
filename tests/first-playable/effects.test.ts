import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererResourceOwner, SceneCamera } from "../../src/contracts/render.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { CpuRenderTarget, SoftwareRenderer } from "../../src/render/cpu/index.ts";
import { SessionActorRegistry } from "../../src/world/actors/registry.ts";
import { q3SpawnAnimation } from "../../src/content/q3/foundation/arsenal.ts";
import type { Q3CharacterView } from "../../src/content/q3/foundation/presentation.ts";
import { EntityEvent } from "../../src/movement/q3/constants.ts";
import type { SimulationPresentation } from "../../src/app/bootstrap/simulation/types.ts";
import type { Q1BeamStyle } from "../../src/content/q1/foundation/types.ts";

test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak"))("retail effects from all three games draw through the shared CPU renderer and expire once for both seats", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu"]);
  if (command.kind !== "run") throw new Error("Expected executable fixture");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("effect-smoke");
  const owner: RendererResourceOwner = { identity: Symbol("effect-smoke"), session: identity.session, generation: 0 };
  const assets = new ApplicationAssets(content, owner);
  try {
    await assets.loadWorld();
    const effects = new ApplicationEffects(assets, createSceneQueries(content.world));
    const q1 = content.catalog.require("q1-classic-id1").id, q2 = content.catalog.require("q2-classic-baseq2").id, q3 = content.catalog.require("q3-baseq3").id;
    const actors = new SessionActorRegistry(identity), actor = actors.allocate("q3:character", "q3:character/sarge");
    const rocketActor = actors.allocate("q2:weapons", "q2:projectile/rocket");
    const rocket: SimulationPresentation = { actor: rocketActor.id, content: q2, family: "q2", path: "models/objects/rocket/tris.md2",
      frame: 0, oldFrame: 0, skin: 0, effects: 0x10, renderFlags: 0, origin: { x: 40, y: 0, z: -10 }, angles: { x: 0, y: 0, z: 0 },
      scale: 1, visible: true, viewWeapon: false };
    const character: Q3CharacterView = { actor: actor.id, origin: { x: 80, y: 0, z: 0 }, angles: { x: 0, y: 90, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, movementDirection: 0, animation: q3SpawnAnimation(), sourceFlags: 0, powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } };
    const snapshot = (seconds: number): WorldSnapshot => ({ session: identity.session, frame: { frame: Math.trunc(seconds * 10),
      time: { kind: "seconds", value: seconds }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
      actors: [], bodies: [], inventories: [], configurations: [], scene: { session: identity.session, time: { kind: "seconds", value: seconds },
        world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } });
    effects.receive([
      { kind: "q1", content: q1, seconds: 1, sequence: 1, event: { kind: "effect", effect: "explosion", actor: null, origin: { x: 80, y: -20, z: 0 }, amount: 0 } },
      { kind: "q2", content: q2, seconds: 1, sequence: 2, event: { kind: "effect", effect: "rocket-explosion", origin: { x: 80, y: 20, z: 0 }, direction: { x: -1, y: 0, z: 0 }, count: 0, color: 0 } },
      { kind: "q2-weapon", content: q2, seconds: 1, sequence: 3, event: { kind: "muzzleflash", actor: actor.id, flash: 1, silenced: false } },
      { kind: "q2-weapon", content: q2, seconds: 1, sequence: 4, event: { kind: "muzzleflash", actor: actor.id, flash: 1, silenced: false } },
      { kind: "q3-character", content: q3, seconds: 1, sequence: 5, event: { actor, sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_JUMP_PAD, parameter: 0 } },
    ]);
    await effects.prepare(snapshot(1), [rocket], [character]);
    const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
      viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 73.739795, 4096), clip: { kind: "none" } };
    const first = effects.frame(camera), second = effects.frame({ ...camera, viewport: { ...camera.viewport, x: 160 } });
    expect(first.lights.filter(light => light.origin.x === 80).map(light => light.radius)).toEqual([350, 328.125]);
    expect(first.lights[1]?.origin.x).toBeCloseTo(96, 4); expect(first.lights[1]?.origin.y).toBeCloseTo(18, 4);
    expect(first.lights.length).toBe(4);
    expect(second.lights).toEqual(first.lights);
    expect(first.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length === 1024 * 3))).toBe(true);
    expect(first.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length === 256 * 3))).toBe(true);
    expect(first.operations.length).toBe(2);
    expect(first.operations[1]?.kind === "draw" && first.operations[1].batches.length > 0).toBe(true);
    const renderer = new SoftwareRenderer(320, 120, owner), target = new CpuRenderTarget(renderer), frames = new SceneFrameBuilder(assets.images);
    frames.begin();
    frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(1).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: first.operations });
    target.execute(frames.finish(false));
    let colored = 0, otherSeat = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 320; x++) {
      const offset = (y * 320 + x) * 4;
      const color = (renderer.pixels[offset] ?? 0) + (renderer.pixels[offset + 1] ?? 0) + (renderer.pixels[offset + 2] ?? 0);
      if (color > 0) { if (x < 160) colored++; else otherSeat++; }
    }
    expect(colored).toBeGreaterThan(100); expect(otherSeat).toBe(0);
    effects.receive([{ kind: "q2", content: q2, seconds: 1.1, sequence: 6, event: { kind: "effect", effect: "blaster",
      origin: { x: 80, y: 40, z: 0 }, direction: { x: -1, y: 0, z: 0 }, count: 0, color: 0 } }]);
    await effects.prepare(snapshot(1.1), [{ ...rocket, origin: { x: 55, y: 0, z: -10 } }], [character]);
    const moving = effects.frame(camera);
    expect(moving.lights.find(light => light.origin.x === 55)?.radius).toBe(200);
    expect(moving.lights.find(light => light.origin.y === 40)?.radius).toBeCloseTo(100, 5);
    frames.begin();
    frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(1.1).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: moving.operations });
    target.execute(frames.finish(false));
    await effects.prepare(snapshot(7), []);
    expect(effects.frame(camera).lights).toEqual([]);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.every(batch => batch.indices.length === 0))).toBe(true);
    const rogue = content.catalog.require("q1-classic-rogue").id;
    const beams: readonly { readonly style: Q1BeamStyle; readonly path: string }[] = [
      { style: "lightning1", path: "progs/bolt.mdl" }, { style: "lightning2", path: "progs/bolt2.mdl" },
      { style: "lightning3", path: "progs/bolt3.mdl" }, { style: "grapple", path: "progs/beam.mdl" },
    ];
    for (const [index, beam] of beams.entries()) effects.receive([{ kind: "q1", content: rogue, seconds: 8, sequence: 7 + index,
      event: { kind: "beam", style: beam.style, actor: actor.id, start: { x: 80, y: -30, z: index * 10 - 15 }, end: { x: 80, y: 30, z: index * 10 - 15 } } }]);
    await effects.prepare(snapshot(8), []);
    const beamFrame = effects.frame(camera);
    const beamImages = beamFrame.operations.flatMap(operation => operation.kind === "draw" ? operation.batches.flatMap(batch =>
      batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated" ? [batch.texture.image.source.name] : []) : []);
    for (const beam of beams) {
      const asset = await assets.model(rogue, beam.path);
      expect(asset.model.kind).toBe("q1-mdl");
      expect(beamImages.some(name => name.startsWith(`${asset.resource.id}:skin:`))).toBe(true);
    }
    frames.begin();
    frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(8).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: beamFrame.operations });
    target.execute(frames.finish(false));
    let beamPixels = 0;
    for (let offset = 0; offset < renderer.pixels.length; offset += 4)
      if ((renderer.pixels[offset] ?? 0) + (renderer.pixels[offset + 1] ?? 0) + (renderer.pixels[offset + 2] ?? 0) > 0) beamPixels++;
    expect(beamPixels).toBeGreaterThan(0);
    await effects.prepare(snapshot(8.21), []);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.length === 0)).toBe(true);
    expect(effects.drainUnhandled()).toEqual([]);
    effects.close(); target.close();
  } finally { assets.close(); await content.close(); }
}, 60000);
