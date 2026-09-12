import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { OwnedActor } from "../../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { Q2EntityServices } from "../../../../src/content/q2/foundation/entity-services.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2GameOptions } from "../../../../src/content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { encodeQ2FoundationCheckpoint, decodeQ2FoundationCheckpoint } from "../../../../src/persistence/q2-foundation.ts";

const zero = { x: 0, y: 0, z: 0 };
const options: Q2GameOptions = { edition: "classic", mapName: "foreign-map", skill: 1, mode: "singleplayer", deathmatchFlags: 0,
  maxClients: 1, provider: "q2:official", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" };

function sharedHost(actors = new SessionActorRegistry(createIdentityOwner("q2-entity-services"))) {
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const callbacks = new ActorCallbackTable(actors), inventory = new SharedInventoryTable(actors);
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const scheduled = new Map<OwnedActor, number>();
  let now = 0;
  const host: Q2FoundationHost = { actors, bodies, callbacks, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    touchTriggers: () => undefined, trace: () => { throw new Error("Entity service check does not trace geometry"); },
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [],
    players: () => [], isPlayer: () => false, isMonster: () => false,
    worldActor: () => { throw new Error("No map was loaded"); },
    inlineModelBounds: () => { throw new Error("No map was loaded"); },
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: () => undefined,
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }),
    keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined, diagnostic: () => undefined };
  return { host, advance(time: number) {
    now = time;
    for (const [actor, due] of [...scheduled]) if (due <= now) {
      scheduled.delete(actor);
      if (actors.isLive(actor.id)) callbacks.think(actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
  } };
}

describe("Q2 reusable entity services", () => {
  test("attachment preserves shared identity, body and combat without running spawn", () => {
    const { host } = sharedHost(), module = createQ2TargetModule();
    const services = new Q2EntityServices(host, options, [module]);
    const actor = host.actors.allocateAtSource("q1:map", 17, "q1:authored");
    host.bodies.create(actor, { origin: { x: 7, y: 8, z: 9 }, angles: zero, velocity: { x: 3, y: 0, z: 0 }, bounds: { min: zero, max: { x: 2, y: 3, z: 4 } }, ground: null });
    host.combat.create(actor, { health: 73, armor: { kind: "none" }, mass: 90, canTakeDamage: true, invulnerable: false, team: null });
    const body = host.bodies.read(actor.id), combat = host.combat.read(actor.id), source = host.actors.sourceOf(actor.id);
    const fields = { classname: "target_secret", ordinal: -1, values: new Map([["health", "900"], ["origin", "100 200 300"], ["delay", "0.4"]]) };
    const entity = services.attach(actor, fields);
    expect(entity.actor).toBe(actor); expect(entity.maxHealth).toBe(900); expect(entity.delay).toBe(0.4);
    expect(entity.use).toBeNull(); expect(services.counters.totalSecrets).toBe(0);
    expect(host.actors.observations()).toHaveLength(1); expect(host.bodies.read(actor.id)).toEqual(body);
    expect(host.combat.read(actor.id)).toEqual(combat); expect(host.actors.sourceOf(actor.id)).toEqual(source);
    expect(() => services.attach(actor, fields)).toThrow("already has an entity continuation");
    expect(services.entity(actor.id)).toBe(entity);
  });

  test("foreign-owned continuation restores named callbacks and allocates delayed-use actors without a Foundation", () => {
    const first = sharedHost(), module = createQ2TargetModule();
    const services = new Q2EntityServices(first.host, options, [module]);
    const actor = first.host.actors.allocateAtSource("q1:map", 17, "q1:authored");
    first.host.bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    const relay = services.attach(actor, { classname: "trigger_relay", ordinal: -1, values: new Map([["target", "secret"], ["delay", "0.5"]]) });
    expect(module.spawn(relay, services)).toBe(true);
    const secret = services.spawn({ classname: "target_secret", ordinal: -1, values: new Map([["targetname", "secret"]]) });
    const saved = decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(services.capture()));
    expect(saved.entities.find(entity => entity.actor.slot === actor.id.slot)?.sourceSlot).toBeNull();
    const restoredActors = SessionActorRegistry.restore(createIdentityOwner("q2-services-restored"), first.host.actors.checkpoint(), first.host.actors.sourceCheckpoint());
    const restored = sharedHost(restoredActors);
    for (const original of first.host.actors.observations()) {
      const owner = restoredActors.resolveSaved(original.id), body = first.host.bodies.read(original.id);
      if (owner === null || body === null) throw new Error("Missing saved shared body");
      restored.host.bodies.create(owner, body);
    }
    const resumed = new Q2EntityServices(restored.host, options, [createQ2TargetModule()]);
    resumed.restore(saved);
    expect(resumed.capture()).toEqual(saved);
    const restoredRelay = resumed.entity(restoredActors.referenceSaved(actor.id));
    if (restoredRelay === null) throw new Error("Missing restored relay");
    restored.host.callbacks.use(restoredRelay.actor, null, null);
    const delayed = [...resumed.entities.values()].find(entity => entity.classname === "DelayedUse");
    if (delayed === undefined) throw new Error("No delayed-use continuation allocated");
    expect(delayed.nextThink).toBe(0.5); expect(delayed.actor.owner).toBe(options.provider);
    restored.advance(0.5);
    expect(resumed.counters.foundSecrets).toBe(1);
    expect(restoredActors.isLive(restoredActors.referenceSaved(secret.actor.id))).toBe(false);
    expect(restoredActors.isLive(delayed.actor.id)).toBe(false);
    expect(resumed.entity(restoredRelay.actor.id)).toBe(restoredRelay);
  });

  test("native Foundation uses the same implementation and retains map team admission", () => {
    const { host } = sharedHost();
    const foundation = new Q2Foundation(host, options, [createQ2TargetModule()]);
    const report = foundation.load('{ "classname" "trigger_relay" "team" "linked" } { "classname" "trigger_relay" "team" "linked" }');
    const master = report.spawned[0], member = report.spawned[1];
    if (master === undefined || member === undefined) throw new Error("Missing native map team");
    expect(foundation instanceof Q2EntityServices).toBe(true);
    expect(foundation.pushTeam(master.actor.id)).toEqual([master.actor, member.actor]);
    expect(member.teamMaster).toBe(master.actor.id);
  });
});
