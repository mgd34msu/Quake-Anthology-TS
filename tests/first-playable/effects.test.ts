import { q2MonsterMuzzle } from "../../src/app/bootstrap/effects/q2-muzzle.ts";
import { SourceParticles } from "../../src/app/bootstrap/effects/particles.ts";
import { SourceRandom } from "../../src/app/bootstrap/simulation/random.ts";
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
import type { SimulationPresentation, SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import type { Q1BeamStyle } from "../../src/content/q1/foundation/types.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";

for (const [map, path, count] of [["e1m2", "progs/flame.mdl", 24], ["e2m1", "*4", 1]] satisfies readonly (readonly [string, string, number])[]) test(`authored Q1 static ${map} model uses genuine content and the shared renderer after its gameplay actor is freed`, async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", map, "--movement", "q1", "--character", "q1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected native static map");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("static-model-render");
  const owner: RendererResourceOwner = { identity: Symbol("static-model-render"), session: identity.session, generation: 0 };
  const assets = new ApplicationAssets(content, owner), simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    await assets.loadWorld();
    const events = simulation.drainPresentationEvents(), statics = events.filter(event => event.kind === "q1" && event.event.kind === "static-model");
    expect(statics).toHaveLength(count);
    const first = statics[0]; if (first?.kind !== "q1" || first.event.kind !== "static-model") throw new Error("Missing authored flame");
    const asset = await assets.model(first.content, first.event.path);
    expect(asset.resource.provenance.mount.identity.content).toBe(content.recipe.map.entities.content);
    expect(first.event.path).toBe(path);
    expect(asset.resource.requestedPath).toBe(path.startsWith("*") ? `maps/${map}.bsp` : path);
    const effects = new ApplicationEffects(assets, simulation.scene, () => false);
    const renderer = new SoftwareRenderer(160, 120, owner), target = new CpuRenderTarget(renderer), frames = new SceneFrameBuilder(assets.images);
    try {
      effects.receive([first]);
      const output = simulation.step({ elapsedMilliseconds: 100, commands: [] });
      await effects.prepare(output.snapshot, []);
      const bounds = asset.model.kind === "brush-model" ? asset.model.world.models[asset.model.model]?.bounds : null;
      const camera: SceneCamera = { origin: bounds == null ? { x: first.event.origin.x - 48, y: first.event.origin.y, z: first.event.origin.z }
        : { x: bounds.min.x - 48, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
        viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 73.739795, 4096), clip: { kind: "none" } };
      const frame = effects.frame(camera);
      expect(frame.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length > 0))).toBe(true);
      frames.begin(); frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: output.snapshot.frame.time, viewport: camera.viewport,
        clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: frame.operations });
      target.execute(frames.finish(false));
      expect(new Set(renderer.pixels).size).toBeGreaterThan(8);
      effects.receive([first]);
      effects.receive([{ ...first, sequence: first.sequence + 1, event: { ...first.event, path: "" } }]);
      await effects.prepare({ ...output.snapshot, frame: { ...output.snapshot.frame, time: { kind: "seconds", value: 10 } } }, []);
      expect(effects.frame(camera).operations.filter(operation => operation.kind === "draw").flatMap(operation => operation.batches).length)
        .toBe(frame.operations.filter(operation => operation.kind === "draw").flatMap(operation => operation.batches).length);
      expect(effects.drainSounds()).toEqual([]);
      if (path.startsWith("*")) {
        const external = await assets.model(first.content, "maps/b_bh10.bsp");
        expect(external.brushScene).not.toBe(assets.world);
        if (external.model.kind !== "brush-model" || external.brushScene === null) throw new Error("Missing genuine external brush model");
        const externalEffects = new ApplicationEffects(assets, simulation.scene, () => false);
        try {
          externalEffects.receive([{ ...first, event: { ...first.event, path: "maps/b_bh10.bsp" } }]);
          await externalEffects.prepare(output.snapshot, []);
          const externalCamera = { ...camera, origin: { x: -48, y: 0, z: 8 } };
          const expected = external.brushScene.prepareModel(external.model.model, { origin: first.event.origin, axis: anglesToAxis(first.event.angles) },
            { camera: externalCamera, time: output.snapshot.frame.time, target: { kind: "preview", id: "effects" }, animationFrame: first.event.frame });
          const actual = externalEffects.frame(externalCamera).operations;
          const batches = (operations: readonly import("../../src/contracts/render.ts").RenderOperation[]) => operations.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
          expect(batches(actual).length).toBeGreaterThan(0);
          expect(batches(actual)).toEqual(batches(expected));
        } finally { externalEffects.close(); }
      }
    } finally { effects.close(); target.close(); }
  } finally { assets.close(); simulation.close(); await content.close(); }
}, 30000);

test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak"))("retail effects from all three games draw through the shared CPU renderer and expire once for both seats", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu"]);
  if (command.kind !== "run") throw new Error("Expected executable fixture");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("effect-smoke");
  const owner: RendererResourceOwner = { identity: Symbol("effect-smoke"), session: identity.session, generation: 0 };
  const assets = new ApplicationAssets(content, owner);
  try {
    await assets.loadWorld();
    const effects = new ApplicationEffects(assets, createSceneQueries(content.world), id => id.equals(actor.id));
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
      actors: actors.observations(), bodies: [], inventories: [], configurations: [], scene: { session: identity.session, time: { kind: "seconds", value: seconds },
        world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } });
    effects.receive([
      { kind: "q1", content: q1, seconds: 1, sequence: 1, event: { kind: "effect", effect: "explosion", actor: null, origin: { x: 80, y: -20, z: 0 }, amount: 0 } },
      { kind: "q2", content: q2, seconds: 1, sequence: 2, event: { kind: "effect", effect: "rocket-explosion", origin: { x: 80, y: 20, z: 0 }, direction: { x: -1, y: 0, z: 0 }, count: 0, color: 0 } },
      { kind: "q2-weapon", content: q2, seconds: 1, sequence: 3, event: { kind: "muzzleflash", actor: actor.id, flash: 1, silenced: false } },
      { kind: "q2-weapon", content: q2, seconds: 1, sequence: 4, event: { kind: "muzzleflash", actor: actor.id, flash: 1, silenced: false } },
      { kind: "q3-character", content: q3, seconds: 1, sequence: 5, event: { actor, sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_JUMP_PAD, parameter: 0 } },
    ]);
    await effects.prepare(snapshot(1), [rocket], [character]);
    expect(effects.drainSounds().map(sound => sound.path)).toContain("weapons/r_exp3.wav");
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
    await effects.prepare(snapshot(8), [], [{ ...character, origin: { x: 80, y: 20, z: 0 } }]);
    const remoteBeamFrame = effects.frame(camera, rocketActor.id), ownerBeamFrame = effects.frame(camera, actor.id);
    const indexCount = (frame: typeof beamFrame): number => frame.operations.reduce((sum, operation) => sum +
      (operation.kind === "draw" ? operation.batches.reduce((count, batch) => count + batch.indices.length, 0) : 0), 0);
    expect(indexCount(ownerBeamFrame)).toBeLessThan(indexCount(remoteBeamFrame));
    expect(ownerBeamFrame.operations).not.toEqual(remoteBeamFrame.operations);
    expect(effects.frame(camera, rocketActor.id)).toEqual(remoteBeamFrame);
    expect(effects.frame(camera, actor.id)).toEqual(ownerBeamFrame);
    expect(effects.frame(camera)).toEqual(remoteBeamFrame);
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
    const q2Rogue = content.catalog.require("q2-classic-rogue").id;
    effects.receive([
      { kind: "q2-composition", content: q2Rogue, seconds: 9, sequence: 11, event: { kind: "missionpack-entity", event: { kind: "steam", id: 1,
        origin: { x: 80, y: -15, z: 0 }, direction: { x: 0, y: 0, z: 1 }, count: 8, color: 0xe0, speed: 60, milliseconds: 300 } } },
      { kind: "q2-composition", content: q2Rogue, seconds: 9, sequence: 12, event: { kind: "missionpack-entity", event: { kind: "force-wall",
        start: { x: 80, y: -30, z: 10 }, end: { x: 80, y: 30, z: 10 }, color: 0xd0 } } },
      { kind: "q2", content: q2Rogue, seconds: 9, sequence: 13, event: { kind: "effect", effect: "q2:tracker_explosion",
        origin: { x: 90, y: 20, z: 0 }, direction: { x: 0, y: 0, z: 0 }, count: 0, color: 0 } },
      { kind: "q2-composition", content: q2Rogue, seconds: 9, sequence: 14, event: { kind: "missionpack-player", event: { kind: "ir", actor: actor.id, until: 14 } } },
      { kind: "q2-composition", content: q2Rogue, seconds: 9, sequence: 15, event: { kind: "missionpack-player", event: { kind: "sphere-camera",
        actor: actor.id, sphere: rocketActor.id, origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 90, z: 0 } } } },
      { kind: "q2-rerelease", content: q2Rogue, seconds: 9, sequence: 16, event: { kind: "dynamic-light", actor: rocketActor.id,
        origin: rocket.origin, radius: 180, color: { x: 0.2, y: 0.7, z: 1 }, visible: true } },
    ]);
    await effects.prepare(snapshot(9), [{ ...rocket, effects: 0 }], [character]);
    const expansion = effects.frame(camera), playerView = effects.playerView(actor.id, camera);
    expect(playerView.camera.origin).toEqual(rocket.origin);
    expect(playerView.camera.axis).toEqual(anglesToAxis({ x: 0, y: 90, z: 0 }));
    expect(playerView.infrared).toBe(true); expect(playerView.blend).toEqual({ x: 1, y: 0, z: 0, w: 0.2 });
    expect(effects.playerView(rocketActor.id, camera)).toEqual({ camera, infrared: false, blend: null });
    expect(expansion.lights.some(light => light.radius === 150 && light.color.x === -1)).toBe(true);
    expect(expansion.lights.some(light => light.radius === 180)).toBe(true);
    expect(effects.drainSounds().map(sound => sound.path)).toEqual(["weapons/disrupthit.wav"]);
    expect(await (await assets.provider(q2Rogue)).mounts.resolve("sound/weapons/disrupthit.wav")).not.toBeNull();
    frames.begin(); frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(9).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0.2, y: 0.2, z: 0.2, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: expansion.operations });
    target.execute(frames.finish(false));
    expect(new Set(renderer.pixels).size).toBeGreaterThan(16);
    effects.receive([
      { kind: "q2-composition", content: q2Rogue, seconds: 9.1, sequence: 17, event: { kind: "missionpack-player", event: { kind: "sphere-camera",
        actor: actor.id, sphere: null, origin: character.origin, angles: character.angles } } },
      { kind: "q2-rerelease", content: q2Rogue, seconds: 9.1, sequence: 18, event: { kind: "dynamic-light", actor: rocketActor.id,
        origin: rocket.origin, radius: 180, color: { x: 0.2, y: 0.7, z: 1 }, visible: false } },
    ]);
    await effects.prepare(snapshot(9.1), []);
    expect(effects.playerView(actor.id, camera).camera).toBe(camera);
    expect(effects.frame(camera).lights.some(light => light.radius === 180)).toBe(false);
    await effects.prepare(snapshot(14), []);
    expect(effects.playerView(actor.id, camera).infrared).toBe(false);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.length === 0)).toBe(true);
    expect(effects.drainUnhandled()).toEqual([]);
    const rerelease = content.catalog.require("q2-rerelease-baseq2").id;
    effects.receive([
      { kind: "q2", content: rerelease, seconds: 15, sequence: 19, event: { kind: "effect", effect: "q2:berserk-slam", origin: { x: 80, y: -20, z: 0 }, direction: { x: 0, y: 0, z: 1 }, count: 1, color: 0 } },
      { kind: "q2", content: rerelease, seconds: 15, sequence: 20, event: { kind: "effect", effect: "q2:plain-explosion", origin: { x: 80, y: 20, z: 0 }, direction: { x: 0, y: 0, z: 0 }, count: 1, color: 0 } },
    ]);
    await effects.prepare(snapshot(15), []);
    expect(effects.drainUnhandled()).toEqual([]);
    expect(effects.drainSounds().map(sound => [sound.path, sound.channel, sound.volume])).toEqual([["weapons/rocklx1a.wav", 0, 1]]);
    const slam = effects.frame(camera);
    expect(slam.operations.some(operation => operation.kind === "draw" && operation.batches.length > 0)).toBe(true);
    expect(slam.lights.some(light => light.radius > 0 && light.color.x === 1 && light.color.y === 0.5 && light.color.z === 0.5)).toBe(true);
    frames.begin(); frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(15).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0.2, y: 0.2, z: 0.2, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: slam.operations });
    target.execute(frames.finish(false));
    expect(new Set(renderer.pixels).size).toBeGreaterThan(16);
    await effects.prepare(snapshot(17), []);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.length === 0)).toBe(true);
    effects.receive([232, 233, 234, 235, 236, 237, 238, 239, 260, 251, 252, 253, 256, 257, 258, 259, 263, 74, 134].map((flash, index) => ({
      kind: "q2", content: rerelease, seconds: 18, sequence: 21 + index,
      event: { kind: "monster-muzzleflash", actor: actor.id, flash, origin: { x: 80, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
    })));
    await effects.prepare(snapshot(18), []);
    expect(effects.drainUnhandled()).toEqual([]);
    expect(effects.frame(camera).operations.some(operation => operation.kind === "draw" && operation.batches.length > 0)).toBe(true);
    await effects.prepare(snapshot(20), []);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.length === 0)).toBe(true);
    effects.drainSounds();
    effects.receive([
      { kind: "q1", content: q1, seconds: 21, sequence: 100, event: { kind: "effect", effect: "wizard-spike", actor: null, origin: { x: 80, y: -24, z: 0 }, amount: 0 } },
      { kind: "q1", content: q1, seconds: 21, sequence: 101, event: { kind: "effect", effect: "knight-spike", actor: null, origin: { x: 80, y: 24, z: 0 }, amount: 0 } },
      { kind: "q1", content: q1, seconds: 21, sequence: 102, event: { kind: "colored-explosion", origin: { x: 80, y: 0, z: 0 }, colorStart: 228, colorLength: 5 } },
    ]);
    await effects.prepare(snapshot(21), []);
    const points = effects.frame(camera);
    expect(points.lights).toHaveLength(1);
    expect(points.lights[0]).toEqual({ origin: { x: 80, y: 0, z: 0 }, radius: 350, color: { x: 1, y: 1, z: 1 }, minimum: 0 });
    expect(points.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length === 562 * 3))).toBe(true);
    expect(effects.drainSounds().map(sound => [sound.content, sound.path, sound.channel, sound.volume, sound.seconds])).toEqual([
      [q1, "wizard/hit.wav", 0, 1, 21], [q1, "hknight/hit.wav", 0, 1, 21], [q1, "weapons/r_exp3.wav", 0, 1, 21],
    ]);
    frames.begin(); frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: snapshot(21).frame.time, viewport: camera.viewport,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: points.operations });
    target.execute(frames.finish(false));
    expect(new Set(renderer.pixels).size).toBeGreaterThan(16);
    await effects.prepare(snapshot(21.1), []);
    expect(effects.frame(camera).lights[0]?.radius).toBeCloseTo(320, 5);
    expect(effects.drainSounds()).toEqual([]);
    await effects.prepare(snapshot(21.51), []);
    expect(effects.frame(camera).lights).toEqual([]);
    expect(effects.frame(camera).operations.every(operation => operation.kind !== "draw" || operation.batches.every(batch => batch.indices.length === 0))).toBe(true);
    const spikes = new ApplicationEffects(assets, createSceneQueries(content.world), () => false, 1);
    const expectedRandom = new SourceRandom(1), expectedParticles = new SourceParticles(expectedRandom), expectedSounds: string[] = [];
    const spikeEvents: SimulationPresentationEvent[] = [];
    for (let index = 0; index < 24; index++) {
      const effect = index % 2 === 0 ? "spike" : "superspike", origin = { x: 80, y: 0, z: 0 };
      expectedParticles.q1Impact(origin, { x: 0, y: 0, z: 0 }, 0, effect === "spike" ? 10 : 20, 22);
      if (expectedRandom.nextInteger() % 5 !== 0) expectedSounds.push("weapons/tink1.wav");
      else { const choice = expectedRandom.nextInteger() & 3; expectedSounds.push(choice === 1 ? "weapons/ric1.wav" : choice === 2 ? "weapons/ric2.wav" : "weapons/ric3.wav"); }
      spikeEvents.push({ kind: "q1", content: q1, seconds: 22, sequence: index, event: { kind: "effect", effect, actor: null, origin, amount: 0 } });
    }
    spikes.receive(spikeEvents);
    await spikes.prepare(snapshot(22), []);
    expect(spikes.drainSounds().map(sound => sound.path)).toEqual(expectedSounds);
    expect(new Set(expectedSounds).size).toBeGreaterThan(1);
    expect(spikes.drainSounds()).toEqual([]);
    spikes.receive([{ kind: "q1", content: q1, seconds: 23, sequence: 24, event: { kind: "effect", effect: "tar-explosion", actor: null, origin: { x: 80, y: 0, z: 0 }, amount: 0 } }]);
    await spikes.prepare(snapshot(23), []);
    expect(spikes.drainSounds().map(sound => sound.path)).toEqual(["weapons/r_exp3.wav"]);
    expect(spikes.frame(camera).lights).toEqual([]);
    spikes.close();
    effects.close(); target.close();
  } finally { assets.close(); await content.close(); }
}, 60000);

test("Quake colored explosions retain source palette cycle, count, bounds and lifetime", () => {
  const particles = new SourceParticles(new SourceRandom(1)), origin = { x: 10, y: 20, z: 30 };
  particles.q1ColorExplosion(origin, 1, 228, 5);
  const first = particles.sample(1, 0).q1;
  expect(first).toHaveLength(512);
  expect(first.map(particle => particle.kind === "indexed" ? particle.paletteIndex : -1)).toEqual(Array.from({ length: 512 }, (_, index) => 228 + (511 - index) % 5));
  expect(first.every(particle => particle.origin.x >= -6 && particle.origin.x <= 25 && particle.origin.y >= 4 && particle.origin.y <= 35 && particle.origin.z >= 14 && particle.origin.z <= 45)).toBe(true);
  expect(particles.sample(1.3, 0).q1).toHaveLength(512);
  expect(particles.sample(1.301, 0).q1).toHaveLength(0);
  const bounded = new SourceParticles(new SourceRandom(1), 5);
  bounded.q1ColorExplosion(origin, 1, 0, 4);
  expect(bounded.sample(1, 0).q1).toHaveLength(5);
  expect(() => bounded.q1ColorExplosion(origin, 1, 0, 0)).toThrow("palette range");
  for (const [color, count, minimum] of [[20, 30, 16], [226, 20, 224]] satisfies readonly (readonly [number, number, number])[]) {
    const impact = new SourceParticles(new SourceRandom(1));
    impact.q1Impact(origin, { x: 0, y: 0, z: 0 }, color, count, 1);
    const points = impact.sample(1, 0).q1;
    expect(points).toHaveLength(count);
    expect(points.every(point => point.kind === "indexed" && point.paletteIndex >= minimum && point.paletteIndex < minimum + 8)).toBe(true);
  }
});

test("rerelease berserk slam particles use source colors, velocity and lifetime", () => {
  const particles = new SourceParticles(new SourceRandom(1)), origin = { x: 10, y: 20, z: 30 };
  particles.q2BerserkSlam(origin, { x: 0, y: 0, z: 1 }, 1);
  const first = particles.sample(1, 0).q2;
  expect(first).toHaveLength(700);
  expect(first.every(particle => particle.kind === "indexed" && [110, 112, 114, 116].includes(particle.paletteIndex) && particle.alpha === 1)).toBe(true);
  expect(first.every(particle => particle.origin.x === 10 && particle.origin.y === 20 && particle.origin.z === 30)).toBe(true);
  const moved = particles.sample(1.1, 0.1).q2;
  expect(moved).toHaveLength(700);
  expect(moved.every(particle => Math.abs(particle.origin.x - 10) <= 19.21 && Math.abs(particle.origin.y - 20) <= 19.21 && particle.origin.z >= 30 && particle.origin.z <= 49.21)).toBe(true);
  expect(particles.sample(1.81, 0).q2).toHaveLength(0);
  const bounded = new SourceParticles(new SourceRandom(1), 5);
  bounded.q2BerserkSlam(origin, { x: 0, y: 0, z: 1 }, 1);
  expect(bounded.sample(1, 0).q2).toHaveLength(5);
});

test("rerelease monster muzzle profiles cover extended ordinary IDs and boss blaster changes", () => {
  for (const [flash, classic] of [[232, 26], [233, 26], [234, 26], [235, 26], [236, 26], [237, 26], [238, 26], [239, 26], [260, 26], [251, 39], [252, 41], [253, 43], [256, 53], [257, 53], [258, 53], [259, 53], [263, 62]] satisfies readonly (readonly [number, number])[]) {
    expect(q2MonsterMuzzle(flash, true)).toEqual(q2MonsterMuzzle(classic, false));
    expect(q2MonsterMuzzle(flash, false)).toBeUndefined();
  }
  for (const flash of [74, 134]) {
    expect(q2MonsterMuzzle(flash, true)?.smoke).toBe(false);
    expect(q2MonsterMuzzle(flash, true)?.particles).toBe(false);
    expect(q2MonsterMuzzle(flash, false)?.smoke).toBe(true);
    expect(q2MonsterMuzzle(flash, false)?.particles).toBe(true);
  }
});
