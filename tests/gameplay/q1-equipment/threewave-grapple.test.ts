import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Q1Map } from "../../../src/formats/q1-map/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { Q1EntityServices } from "../../../src/content/q1/foundation/entity-services.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/types.ts";
import { ZERO, PLAYER_BOUNDS } from "../../../src/content/q1/foundation/types.ts";
import { ThreewaveGrapple } from "../../../src/content/q1/equipment/threewave-grapple.ts";
import type { ThreewaveGrappleHost, ThreewaveGrappleInput } from "../../../src/content/q1/equipment/threewave-grapple.ts";
import { captureSharedBodies } from "../../../src/persistence/world-state.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../src/persistence/q1-foundation.ts";
import type { Q1FoundationCheckpoint } from "../../../src/content/q1/foundation/checkpoint.ts";
import type { BodyCheckpoint, CombatCheckpoint } from "../../../src/contracts/session.ts";

interface Saved {
  readonly source: Q1FoundationCheckpoint;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly BodyCheckpoint[];
  readonly combat: readonly CombatCheckpoint[];
}
async function geometry(): Promise<Q1Map> {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/id1/pak0.pak");
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1 geometry");
    return readQ1Bsp(await archive.readEntry(entry), { source: "maps/e1m1.bsp" });
  } finally { archive.close(); }
}
function equipment(map: Q1Map, saved?: Saved, edition: "classic" | "rerelease" = "rerelease") {
  const identities = createIdentityOwner("threewave-equipment");
  const actors = saved === undefined ? new SessionActorRegistry(identities) : SessionActorRegistry.restore(identities, saved.slots, saved.sources);
  const callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [];
  let contents: ReturnType<Q1FoundationHost["contents"]> = "empty";
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => {
      const result = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: request.missile === true ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (result.kind !== "q1") throw new Error("Expected Q1 geometry trace");
      return { fraction: result.fraction, end: result.end, normal: result.sourcePlane.normal, actor: result.hit.kind === "actor" ? result.hit.actor : null,
        startSolid: result.startSolid, allSolid: result.allSolid, sky: false, inOpen: result.inOpen, inWater: result.inWater };
    },
    contents: () => contents, walkMove: () => false, moveToGoal: () => undefined, checkBottom: () => false,
    changeYaw: () => { throw new Error("Equipment does not run monster yaw"); }, pusherServices: () => { throw new Error("Equipment does not run map pushers"); },
    scheduleThink: (actor, time) => { pending.set(actor, time); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined, players: () => [], checkClient: () => null, classname: () => "", powerup: () => undefined,
  };
  const game = new Q1EntityServices(host, { edition, skill: 1, deathmatch: 0, coop: false, gravity: 800, maxClients: 4,
    campaign: "q1:id1", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" });
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  let input: ThreewaveGrappleInput = { held: true, release: false, jump: false, viewAngles: ZERO, teleportUntil: 0 };
  let anchor: ReturnType<ThreewaveGrappleHost["anchor"]> = { solid: true, centered: false, player: false };
  const grapple = new ThreewaveGrapple(game, { input: () => input, aim: (_actor, direction) => direction, anchor: () => anchor,
    canAttach: () => true, canPulse: () => true, canDamage: (target, owner) => game.canDamage(target, owner) });
  if (saved !== undefined) {
    for (const entry of saved.bodies) {
      const actor = actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Missing body owner");
      bodies.create(actor, { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    }
    for (const entry of saved.combat) {
      const actor = actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Missing combat owner"); combat.create(actor, entry.state);
    }
    game.restore(saved.source);
  }
  const sharedActor = (slot: number, origin = ZERO, damageable = false) => {
    const actor = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(actor, { origin, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: damageable, invulnerable: false, team: null }); return actor;
  };
  const advance = (time: number) => {
    for (;;) {
      const next = [...pending].filter(([, due]) => due <= time).sort((a, b) => a[1] - b[1])[0]; if (next === undefined) break;
      pending.delete(next[0]); callbacks.think(next[0], { frame: 0, time: { kind: "seconds", value: next[1] }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
    game.time = time;
  };
  const capture = (): Saved => ({ source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(game.capture())), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies), combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id);
      return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }) });
  return { actors, bodies, combat, callbacks, game, grapple, events, inventory, pending, sharedActor, advance, capture,
    contents: (value: ReturnType<Q1FoundationHost["contents"]>) => { contents = value; },
    input: (patch: Partial<ThreewaveGrappleInput>) => { input = { ...input, ...patch }; }, anchor: (value: typeof anchor) => { anchor = value; } };
}
function hookFor(state: ReturnType<typeof equipment>, owner: ActorId) {
  const hook = state.grapple.hook(owner); if (hook === null) throw new Error("Missing equipment hook"); return hook;
}

test("classic Threewave saves its three authored chain links and releases every source continuation", async () => {
  const map = await geometry(), state = equipment(map, undefined, "classic"), owner = state.sharedActor(1);
  expect(state.grapple.fire(owner.id)).toBe(true);
  const hook = hookFor(state, owner.id), links = [...state.game.entities.values()].filter(entity => entity.classname === "ctf_hook_link");
  expect(links).toHaveLength(3);
  expect(links.map(link => link.number("weapon"))).toEqual([0.75, 0.5, 0.25]);
  expect(links.map(link => state.game.body(link).angles)).toEqual([{ x: 93, y: 123, z: 153 }, { x: 62, y: 82, z: 102 }, { x: 31, y: 41, z: 51 }]);
  for (const link of links) {
    expect(link.model).toBe("progs/bit.mdl"); expect(link.movement).toBe("noclip");
    expect(link.angularVelocity).toEqual({ x: 310, y: 410, z: 510 });
  }
  state.game.setOrigin(hook, { x: 300, y: 0, z: 16 }); state.input({ jump: true }); state.advance(0.11);
  expect(links.map(link => state.game.body(link).origin)).toEqual([{ x: 87, y: 0, z: 4 }, { x: 158, y: 0, z: 8 }, { x: 229, y: 0, z: 12 }]);
  state.grapple.trail(owner.id); expect(state.events.some(event => event.kind === "beam")).toBe(false);
  const saved = state.capture(), restored = equipment(map, saved, "classic");
  const restoredOwner = restored.actors.resolveSaved({ slot: owner.id.slot, generation: owner.id.generation });
  if (restoredOwner === null) throw new Error("Missing restored owner");
  restored.input({ jump: true }); state.advance(0.21); restored.advance(0.21);
  expect(restored.game.capture()).toEqual(state.game.capture());
  restored.grapple.release(restoredOwner.id);
  expect([...restored.game.entities.values()].filter(entity => entity.classname === "ctf_hook_link")).toHaveLength(0);
  expect(restored.pending.size).toBe(0);
  expect(restored.events.some(event => event.kind === "sound" && event.path === "weapons/bounce2.wav")).toBe(true);
  state.actors.close(); restored.actors.close();
});

test("offhand Threewave fire, moving anchor, pull and release require only the foreign owner's shared body and combat", async () => {
  const state = equipment(await geometry()), owner = state.sharedActor(1), anchor = state.sharedActor(2, { x: 300, y: 0, z: 16 });
  expect(state.game.player(owner.id)).toBeNull(); expect(state.game.entity(owner.id)).toBeNull(); expect(state.inventory.has(owner.id)).toBe(false);
  expect(state.game.registeredWeapons.size).toBe(0); expect(state.grapple.fire(owner.id)).toBe(true);
  const hook = hookFor(state, owner.id); expect(state.game.body(hook).velocity).toEqual({ x: 800, y: 0, z: -0 });
  expect(state.grapple.fire(owner.id)).toBe(false);
  state.game.setOrigin(hook, { x: 300, y: 0, z: 16 });
  const anchorBody = state.bodies.read(anchor.id); if (anchorBody === null) throw new Error("Missing anchor body");
  state.bodies.write(anchor, { ...anchorBody, velocity: { x: 25, y: 0, z: 0 } });
  state.callbacks.touch({ self: hook.actor, other: anchor.id, plane: null, surface: null });
  expect(state.game.body(hook).velocity.x).toBe(25); expect(hook.touch).toBeNull();
  state.advance(0.11); expect(state.grapple.pulling(owner.id)).toBe(true); expect(state.bodies.read(owner.id)?.velocity.x).toBe(1000);
  state.grapple.trail(owner.id); expect(state.events.some(event => event.kind === "beam" && event.style === "grapple")).toBe(true);
  state.input({ held: false, release: true }); state.advance(0.21);
  expect(state.grapple.hook(owner.id)).toBeNull(); expect(state.grapple.pulling(owner.id)).toBe(false); expect(state.pending.size).toBe(0);
  expect(state.game.player(owner.id)).toBeNull(); expect(state.game.entity(owner.id)).toBeNull(); expect(state.inventory.has(owner.id)).toBe(false);
  state.actors.close();
});

test("Threewave centered target damage pulses and named pull survive shared-table checkpoint restore", async () => {
  const map = await geometry(), state = equipment(map), owner = state.sharedActor(1, { x: 480, y: 352, z: 24 });
  const anchor = state.sharedActor(2, { x: 500, y: 352, z: 24 }, true);
  state.anchor({ solid: true, centered: true, player: true });
  expect(state.grapple.fire(owner.id)).toBe(true); const hook = hookFor(state, owner.id);
  state.callbacks.touch({ self: hook.actor, other: anchor.id, plane: null, surface: null });
  expect(state.combat.read(anchor.id)?.health).toBe(90);
  state.advance(0.11); expect(state.combat.read(anchor.id)?.health).toBe(89);
  const snapshot = state.capture(), restored = equipment(map, snapshot);
  restored.anchor({ solid: true, centered: true, player: true });
  const restoredOwner = restored.actors.resolveSaved({ slot: owner.id.slot, generation: owner.id.generation });
  if (restoredOwner === null) throw new Error("Missing restored equipment owner");
  expect(restored.game.player(restoredOwner.id)).toBeNull(); expect(restored.game.entity(restoredOwner.id)).toBeNull();
  expect(restored.game.capture()).toEqual(snapshot.source);
  state.advance(0.21); restored.advance(0.21); expect(restored.game.capture()).toEqual(state.game.capture());
  expect(restored.grapple.pulling(restoredOwner.id)).toBe(true);
  state.grapple.release(owner.id); restored.grapple.release(restoredOwner.id);
  expect(restored.game.capture()).toEqual(state.game.capture());
  state.actors.close(); restored.actors.close();
});

test("Threewave flight times out at five seconds and owner release removes its hook and pending callbacks", async () => {
  const state = equipment(await geometry()), owner = state.sharedActor(1);
  state.grapple.fire(owner.id); state.advance(4.99); expect(state.grapple.hook(owner.id)).not.toBeNull();
  state.advance(5.11); expect(state.grapple.hook(owner.id)).toBeNull();
  state.grapple.fire(owner.id); const hook = hookFor(state, owner.id); state.actors.release(owner);
  expect(state.actors.isLive(hook.actor.id)).toBe(false); expect(state.pending.size).toBe(0); state.actors.close();
});

test("Threewave named touches reject foreign sky surfaces and retain native point-contents sky", async () => {
  const state = equipment(await geometry()), owner = state.sharedActor(1), anchor = state.sharedActor(2);
  state.grapple.fire(owner.id); const foreignSkyHook = hookFor(state, owner.id);
  expect(state.game.host.contents(state.game.body(foreignSkyHook).origin)).toBe("empty");
  state.callbacks.touch({ self: foreignSkyHook.actor, other: anchor.id, plane: null, surface: { name: "foreign-sky", nativeFlags: 4, nativeValue: 0 } });
  expect(state.grapple.hook(owner.id)).toBeNull(); expect(state.pending.size).toBe(0);
  state.grapple.fire(owner.id); const ordinaryHook = hookFor(state, owner.id);
  state.callbacks.touch({ self: ordinaryHook.actor, other: anchor.id, plane: null, surface: { name: "foreign-wall", nativeFlags: 2, nativeValue: 0 } });
  expect(state.grapple.hook(owner.id)).toBe(ordinaryHook); expect(ordinaryHook.references.get("ctf.enemy")).toBe(anchor.id);
  state.grapple.release(owner.id); state.contents("sky");
  state.grapple.fire(owner.id); const nativeSkyHook = hookFor(state, owner.id);
  state.callbacks.touch({ self: nativeSkyHook.actor, other: anchor.id, plane: null, surface: null });
  expect(state.grapple.hook(owner.id)).toBeNull(); expect(state.pending.size).toBe(0);
  state.actors.close();
});
