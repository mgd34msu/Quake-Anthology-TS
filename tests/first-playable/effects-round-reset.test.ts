import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { Q3ApplicationEffects } from "../../src/app/bootstrap/effects/q3.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import type { Q3CharacterView } from "../../src/content/q3/foundation/presentation.ts";
import { q3SpawnAnimation } from "../../src/content/q3/foundation/arsenal.ts";
import { EntityEvent } from "../../src/content/q3/base/shared/definitions.ts";
import { SessionActorRegistry } from "../../src/world/actors/registry.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import { anglesToAxis, identityMat4 } from "../../src/core/math.ts";
import { createSourceSceneOrder } from "../../src/render/scene/submissions.ts";

test("shared round reset removes actor effects, retains Q3 media and accepts only new source sequences", async () => {
  const temporary = await mkdtemp("/tmp/quake-effects-round-");
  try {
    const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--dedicated", "--user-content-root", temporary]);
    if (parsed.kind !== "run") throw Error("Expected Q3 fixture");
    const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner("effects-round");
    const assets = new ApplicationAssets(content, { identity: Symbol("effects-round"), session: identity.session, generation: 0 });
    const actors = new SessionActorRegistry(identity), effects = new ApplicationEffects(assets, createSceneQueries(content.world), () => false);
    const original = Q3ApplicationEffects.create, instances: Q3ApplicationEffects[] = [];
    const create = spyOn(Q3ApplicationEffects, "create").mockImplementation(async (...args) => {
      const result = await original(...args); instances.push(result); return result;
    });
    try {
      await assets.loadWorld();
      const source = content.recipe.map.entities.content, old = actors.allocate("q3:character", "q3:character/sarge");
      const origin = { x: 80, y: 0, z: 0 };
      const view = (actor: Q3CharacterView["actor"]): Q3CharacterView => ({ actor, origin, angles: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 }, movementDirection: 0, animation: q3SpawnAnimation(), sourceFlags: 0, powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } });
      const snapshot = (seconds: number): WorldSnapshot => ({ session: identity.session, frame: { frame: Math.trunc(seconds * 10),
        time: { kind: "seconds", value: seconds }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" }, actors: actors.observations(), bodies: [], inventories: [], configurations: [],
        scene: { session: identity.session, time: { kind: "seconds", value: seconds }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } });
      const smoke: SimulationPresentationEvent = { kind: "q3-character", content: source, sequence: 1, seconds: 1,
        event: { actor: old.id, sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_JUMP_PAD, parameter: 0 } };
      const light = { kind: "q2-rerelease", content: source, sequence: 2, seconds: 1,
        event: { kind: "dynamic-light", actor: old.id, origin, radius: 200, color: { x: 1, y: 0, z: 0 }, visible: true } } satisfies SimulationPresentationEvent;
      effects.receive([smoke, light]); await effects.prepare(snapshot(1), [], [view(old.id)]);
      const instance = instances[0]; if (instance === undefined) throw Error("Missing actual Q3 effect owner");
      const renderer = instance.renderer, shaders = instance.shaders, world = assets.world;
      expect(instance.effects.pool.activeCount).toBeGreaterThan(0); expect(effects.drainUnhandled()).toEqual([]);
      const camera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }), projection: identityMat4(), viewport: { x: 0, y: 0, width: 64, height: 64 }, clip: { kind: "none" } } satisfies Parameters<ApplicationEffects["frame"]>[0];
      expect(effects.frame(camera, createSourceSceneOrder(assets.materialRegistrations)).lights).toHaveLength(1);
      const register = spyOn(assets.images, "register"), model = spyOn(assets, "model");
      try {
        effects.receive([{ ...smoke, sequence: 3 }]); // Pending old-round effects must also disappear.
        effects.resetRound(); actors.release(old);
        const next = actors.allocate("q3:character", "q3:character/sarge");
        expect(next.id.equals(old.id)).toBe(false); expect(instance.effects.pool.activeCount).toBe(0);
        expect(effects.frame(camera, createSourceSceneOrder(assets.materialRegistrations)).lights).toEqual([]);
        expect(effects.drainSounds()).toEqual([]); expect(instance.renderer).toBe(renderer); expect(instance.shaders).toBe(shaders); expect(assets.world).toBe(world);
        expect(register).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
        effects.receive([smoke, light, { ...smoke, sequence: 3 }]); await effects.prepare(snapshot(1.4), [], [view(next.id)]);
        expect(instance.effects.pool.activeCount).toBe(0); expect(effects.drainUnhandled()).toEqual([]);
        effects.receive([{ ...smoke, sequence: 4, seconds: 1.4, event: { ...smoke.event, actor: next.id, timeMilliseconds: 1400 } }]);
        await effects.prepare(snapshot(1.4), [], [view(next.id)]);
        expect(instance.effects.pool.activeCount).toBeGreaterThan(0); expect(create).toHaveBeenCalledTimes(1);
        expect(instance.renderer).toBe(renderer); expect(instance.shaders).toBe(shaders);
        effects.resetRound(); effects.resetRound(); expect(instance.effects.pool.activeCount).toBe(0);
      } finally { register.mockRestore(); model.mockRestore(); }
      const recipient = actors.allocate("q3:character", "q3:character/sarge"), other = actors.allocate("q3:character", "q3:character/sarge");
      const targeted = new ApplicationEffects(assets, createSceneQueries(content.world), () => false);
      try {
        targeted.receive([{ ...smoke, sequence: 20, recipient: recipient.id, seconds: 2,
          event: { ...smoke.event, actor: recipient.id, timeMilliseconds: 2000 } },
          { ...light, sequence: 21, recipient: recipient.id, seconds: 2, event: { ...light.event, actor: recipient.id } },
          { kind: "q3-ballistics", content: source, sequence: 22, seconds: 2, recipient: recipient.id,
            event: { kind: "bounce", actor: recipient.id, weapon: 4, origin, end: origin, normal: { x: 0, y: 0, z: 1 }, target: null, surfaceFlags: 0, timeMilliseconds: 2000 } },
          { ...light, sequence: 10, seconds: 2, event: { ...light.event, actor: other.id, radius: 50 } }]);
        await targeted.prepare(snapshot(2), [], [view(recipient.id), view(other.id)], { content: source, timeMilliseconds: 2000 });
        const order = createSourceSceneOrder(assets.materialRegistrations);
        expect(targeted.frame(camera, order, recipient.id).lights.map(light => light.radius)).toEqual([50, 200]);
        expect(targeted.frame(camera, order, other.id).lights.map(light => light.radius)).toEqual([50]);
        expect(targeted.frame(camera, order).lights.map(light => light.radius)).toEqual([50]);
        expect(targeted.drainSounds()).toEqual([]);
        const sounds = targeted.drainRecipientSounds();
        expect(sounds).toHaveLength(1); expect(sounds[0]?.recipient).toBe(recipient.id);
        expect(sounds[0]?.sounds.length).toBeGreaterThan(0); expect(targeted.drainRecipientSounds()).toEqual([]);
        targeted.resetRound();
        targeted.receive([{ ...light, sequence: 21, recipient: recipient.id, event: { ...light.event, actor: recipient.id } }]);
        await targeted.prepare(snapshot(2.1), [], [view(recipient.id)], { content: source, timeMilliseconds: 2100 });
        expect(targeted.frame(camera, order, recipient.id).lights).toEqual([]);
        targeted.receive([{ ...light, sequence: 23, recipient: recipient.id, event: { ...light.event, actor: recipient.id } }]);
        await targeted.prepare(snapshot(2.2), [], [view(recipient.id)], { content: source, timeMilliseconds: 2200 });
        expect(targeted.frame(camera, order, recipient.id).lights).toHaveLength(1);
        actors.release(recipient); await targeted.prepare(snapshot(2.3), [], []);
        expect(targeted.frame(camera, order, recipient.id).lights).toEqual([]);
        expect(targeted.drainUnhandled()).toEqual([]);
      } finally { targeted.close(); }
      effects.close(); expect(() => effects.resetRound()).toThrow("closed");
    } finally { create.mockRestore(); effects.close(); assets.close(); await content.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 60000);
