import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import type { Q1WorldGeometry } from "../../../src/contracts/scene.ts";
import type { TouchContact } from "../../../src/contracts/world.ts";
import type { Q2Motion } from "../../../src/content/q2/foundation/host.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { SharedPhysics } from "../../../src/app/bootstrap/simulation/physics.ts";
import type { PhysicsFamily } from "../../../src/app/bootstrap/simulation/physics.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../src/formats/q1-map/index.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../src/persistence/world-state.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const unitBounds: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

test("original source reconstruction retains native physics while restoring foreign collisions", () => {
  const source = setup();
  const native = source.actor("q2:native", zero, "stationary");
  const unlinked = source.actor("q2:unlinked", { ...zero, x: 80 }, "stationary");
  const foreign = source.actor("q3:foreign", { ...zero, x: 40 }, "stationary");
  const nativeCollision = { family: "q2", shape: { kind: "box" }, contents: 33554432,
    owner: null, role: "solid", monster: true, deadMonster: false } satisfies Parameters<SharedPhysics["setCollision"]>[1];
  source.physics.setCollision(native, nativeCollision);
  source.physics.setCollision(foreign, { ...nativeCollision, family: "q3", shape: { kind: "capsule" } });
  const bodies = captureSharedBodies(source.actors, source.physics.bodies);
  const reader = new SaveReader(decodeCheckpointValue(encodeCheckpointValue(source.physics.capture())));
  const actors = SessionActorRegistry.restore(createIdentityOwner("original-physics"), source.actors.checkpoint(), source.actors.sourceCheckpoint());
  const restoredNative = actors.resolveSaved(native.id), restoredUnlinked = actors.resolveSaved(unlinked.id);
  const restoredForeign = actors.resolveSaved(foreign.id), world = actors.resolveSaved(source.world.id);
  if (restoredNative === null || restoredUnlinked === null || restoredForeign === null || world === null) throw new Error("Missing restored actors");
  source.actors.close();
  const scene = createSceneQueries(emptyWorld()), physics = new SharedPhysics({ actors, callbacks: new ActorCallbackTable(actors), scene,
    numeric: Q2_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot, worldActor: () => world.id, onBlocked: () => undefined });
  try {
    for (const entry of bodies) {
      const owner = actors.resolveSaved(entry.actor);
      if (owner === null) throw new Error("Missing body owner");
      physics.bodies.create(owner, { ...entry.body, ground: null });
    }
    const nativeBody = physics.bodies.read(restoredNative.id);
    if (nativeBody === null) throw new Error("Missing native body");
    physics.bodies.write(restoredNative, { ...nativeBody, origin: { ...zero, x: 200 } });
    physics.setCollision(restoredNative, { ...nativeCollision, deadMonster: true });
    physics.setMotion({ actor: restoredNative, kind: "bounce", velocity: { ...zero, x: 7 }, angularVelocity: zero,
      gravity: 0.5, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 33554432, owner: null });
    physics.setFlags(restoredNative, { dead: true });
    physics.bodies.link(restoredNative);
    physics.setCollision(restoredUnlinked, nativeCollision);
    physics.setCollision(restoredForeign, { ...nativeCollision, role: "trigger" });
    const added = actors.allocate("test:actors", "q2:added-by-original-callback");
    physics.bodies.create(added, { ...nativeBody, origin: { ...zero, x: 230 } });
    physics.setCollision(added, nativeCollision);
    physics.bodies.link(added);
    const reconstructed = (id: ActorId): boolean => [restoredNative, restoredUnlinked, added].some(actor => actor.id.equals(id));
    physics.restoreCheckpoint(reader, true, reconstructed);
    restoreSharedBodyLinks({ bodies }, { actors, bodies: physics.bodies,
      storage: actor => reconstructed(actor.id) ? "source-reconstructed" : "copied" });
    physics.restoreSpatial(reader, reconstructed);
    expect(scene.spatial.get(restoredNative.id)?.body.state.origin.x).toBe(200);
    expect(scene.spatial.get(restoredNative.id)?.collision.deadMonster).toBe(true);
    expect(physics.motionOf(restoredNative.id)?.kind).toBe("bounce");
    expect(physics.motionOf(restoredNative.id)?.velocity.x).toBe(7);
    expect(physics.capture().flags.find(entry => entry.actor.slot === restoredNative.id.slot)?.dead).toBe(true);
    expect(scene.spatial.get(restoredUnlinked.id)).toBeNull();
    expect(scene.spatial.get(added.id)?.body.state.origin.x).toBe(230);
    expect(scene.spatial.get(restoredForeign.id)?.body.state.origin.x).toBe(40);
    expect(scene.spatial.get(restoredForeign.id)?.collision.shape.kind).toBe("capsule");
    expect(scene.spatial.get(restoredForeign.id)?.collision.role).toBe("solid");
    expect(physics.motionOf(restoredForeign.id)?.kind).toBe("stationary");
    physics.bodies.link(restoredNative);
    expect(scene.spatial.get(restoredNative.id)?.collision.deadMonster).toBe(true);
  } finally { actors.close(); }
});

test("exact Q3 collision metadata survives restore and the next source link", () => {
  const source = setup("q3"), actor = source.actor("q3:saved-capsule", zero, "stationary");
  source.physics.setCollision(actor, { family: "q3", shape: { kind: "capsule" }, contents: 33554432, owner: source.world.id,
    q3Owner: { entityNumber: 17, ownerNumber: 8 }, role: "solid", monster: false, deadMonster: true });
  const body = source.physics.bodies.read(actor.id);
  if (body === null) throw new Error("Missing source body");
  source.physics.bodies.write(actor, { ...body, origin: { ...zero, x: 42 } });
  const bodies = captureSharedBodies(source.actors, source.physics.bodies);
  const reader = new SaveReader(decodeCheckpointValue(encodeCheckpointValue(source.physics.capture())));
  const actors = SessionActorRegistry.restore(createIdentityOwner("collision-restore"), source.actors.checkpoint(), source.actors.sourceCheckpoint());
  const restored = actors.resolveSaved(actor.id), world = actors.resolveSaved(source.world.id);
  if (restored === null || world === null) throw new Error("Missing restored collision actors");
  source.actors.close();
  const scene = createSceneQueries(emptyWorld()), physics = new SharedPhysics({ actors, callbacks: new ActorCallbackTable(actors), scene, numeric: Q2_DONOR_PROFILE,
    sourceOrder: (a, b) => a.slot - b.slot, worldActor: () => world.id, onBlocked: () => undefined });
  for (const entry of bodies) {
    const owner = actors.resolveSaved(entry.actor);
    if (owner === null) throw new Error("Missing saved body owner");
    physics.bodies.create(owner, { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
  }
  physics.restoreCheckpoint(reader, true);
  restoreSharedBodyLinks({ bodies }, { actors, bodies: physics.bodies });
  physics.restoreSpatial(reader);
  expect(physics.bodies.read(restored.id)?.origin.x).toBe(42);
  expect(scene.spatial.get(restored.id)?.body.state.origin.x).toBe(0);
  expect(scene.spatial.get(restored.id)?.collision).toEqual({ family: "q3", shape: { kind: "capsule" }, contents: 33554432, owner: world.id,
    q3Owner: { entityNumber: 17, ownerNumber: 8 }, role: "solid", monster: false, deadMonster: true });
  physics.bodies.link(restored);
  expect(scene.spatial.get(restored.id)?.body.state.origin.x).toBe(42);
  expect(scene.spatial.get(restored.id)?.collision.shape.kind).toBe("capsule");
  expect(scene.spatial.get(restored.id)?.collision.q3Owner).toEqual({ entityNumber: 17, ownerNumber: 8 });
  expect(scene.spatial.get(restored.id)?.collision.owner?.equals(world.id)).toBe(true);
  actors.close();
});
function emptyWorld(): Q1WorldGeometry {
  const bounds: Bounds = { min: { x: -256, y: -256, z: -256 }, max: { x: 256, y: 256, z: 256 } };
  return { kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [-2, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
}
function setup(family: PhysicsFamily = "q2", map = emptyWorld(), blocked: (pusher: OwnedActor, other: ActorId) => undefined = () => undefined, q2Edition: "classic" | "rerelease" = "classic") {
  const actors = new SessionActorRegistry(createIdentityOwner("physics-test"));
  const callbacks = new ActorCallbackTable(actors), world = actors.allocate("world:scene", "world:world");
  const scene = createSceneQueries(map);
  const physics = new SharedPhysics({ actors, callbacks, scene, numeric: family === "q1" ? Q1_DONOR_PROFILE : Q2_DONOR_PROFILE,
    sourceOrder: (a, b) => a.slot - b.slot, worldActor: () => world.id, onBlocked: blocked, q2Edition });
  const actor = (name: `${string}:${string}`, origin: Vec3, kind: Q2Motion["kind"], bounds = unitBounds): OwnedActor => {
    const actor = actors.allocate("test:actors", name);
    physics.bodies.create(actor, { origin, angles: zero, velocity: zero, bounds, ground: null });
    physics.setSolid(actor, "box", null, family);
    physics.setMotion({ actor, kind, velocity: zero, angularVelocity: zero, gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
    physics.bodies.link(actor);
    return actor;
  };
  return { actors, callbacks, world, scene, physics, actor };
}

test("Q2 step preserves stationary support but still moves when ground friction consumes velocity", () => {
  for (const speed of [0, 10]) {
    const s = setup(), actor = s.actor("test:walker", zero, "step"), trigger = s.actor("test:trigger", zero, "stationary");
    s.physics.setSolid(trigger, "trigger", null, "q2");
    let touches = 0;
    s.callbacks.bind(trigger, { think: null, use: null, pain: null, die: null, touch: () => { touches++; return undefined; } });
    const body = s.physics.bodies.read(actor.id); if (body === null) throw new Error("Missing walker body");
    const velocity = { x: speed, y: 0, z: 0 };
    s.physics.bodies.write(actor, { ...body, ground: s.world.id, velocity });
    s.physics.setMotion({ actor, kind: "step", velocity, angularVelocity: { x: 0, y: 100, z: 0 },
      gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x2000003, owner: null });
    const links = s.physics.bodies.linked(actor.id)?.linkCount;
    s.physics.step(actor, 0.1);
    expect(s.physics.bodies.read(actor.id)?.velocity).toEqual(zero);
    expect(s.physics.bodies.read(actor.id)?.angles.y).toBe(10);
    expect(s.physics.bodies.read(actor.id)?.ground).toBe(speed === 0 ? s.world.id : null);
    expect(s.physics.bodies.linked(actor.id)?.linkCount).toBe(speed === 0 ? links : (links ?? 0) + 1);
    expect(touches).toBe(speed === 0 ? 0 : 1);
    s.actors.close();
  }
});

test("attached bodies follow committed positions and do not integrate flight velocity", () => {
  const s = setup(), anchor = s.actor("test:anchor", zero, "stationary"), hook = s.actor("test:hook", { x: 20, y: 0, z: 0 }, "fly-missile");
  s.physics.bodies.attach(hook, { anchor: anchor.id, follow: { kind: "translation", offset: { x: 20, y: 0, z: 0 } } });
  const body = s.physics.bodies.read(hook.id), anchorBody = s.physics.bodies.read(anchor.id);
  if (body === null || anchorBody === null) throw new Error("Missing attachment bodies");
  s.physics.bodies.write(hook, { ...body, velocity: { x: 400, y: 0, z: 0 } });
  s.physics.setMotion({ actor: hook, kind: "fly-missile", velocity: { x: 400, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: -500 },
    gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
  s.physics.step(hook, 0.1);
  expect(s.physics.bodies.read(hook.id)?.origin).toEqual({ x: 20, y: 0, z: 0 });
  expect(s.physics.bodies.read(hook.id)?.angles.z).toBe(-50);
  s.physics.bodies.write(anchor, { ...anchorBody, origin: { x: 94, y: 0, z: 0 }, velocity: zero });
  expect(s.physics.bodies.read(hook.id)?.origin.x).toBe(20);
  s.physics.commitAttachments();
  expect(s.physics.bodies.read(hook.id)?.origin.x).toBe(114);
  s.physics.step(hook, 0.1);
  s.physics.commitAttachments();
  expect(s.physics.bodies.read(hook.id)?.origin.x).toBe(114);
  expect(() => s.physics.bodies.attach(anchor, { anchor: hook.id, follow: { kind: "center" } })).toThrow("cycle");
});

test("anchor release cleans every attached child even when a child cleanup throws", () => {
  const s = setup(), anchor = s.actor("test:anchor", zero, "stationary"), first = s.actor("test:first", zero, "fly-missile"), second = s.actor("test:second", zero, "fly-missile");
  for (const child of [first, second]) s.physics.bodies.attach(child, { anchor: anchor.id, follow: { kind: "center" } });
  s.actors.onRelease(actor => {
    expect(s.physics.bodies.read(anchor.id)).toBeNull();
    if (actor === first) throw new Error("source cleanup failure");
    return undefined;
  });
  expect(() => s.actors.release(anchor)).toThrow();
  for (const actor of [anchor, first, second]) {
    expect(s.actors.isLive(actor.id)).toBe(false);
    expect(s.physics.bodies.attachment(actor.id)).toBeNull();
    expect(s.physics.bodies.linked(actor.id)).toBeNull();
  }
});

test("rerelease G_Impact preserves its trace and calls the inverted contact after mover removal", () => {
  const s = setup("q2", emptyWorld(), () => undefined, "rerelease");
  const mover = s.actor("test:missile", zero, "fly-missile");
  const obstacle = s.actor("test:obstacle", { x: 5, y: 0, z: 0 }, "stationary");
  const contacts: TouchContact[] = [];
  s.physics.setSolid(mover, "none", null, "q2");
  s.physics.setFlags(mover, { alwaysTouch: true });
  s.callbacks.bind(mover, { think: null, use: null, pain: null, die: null, touch: contact => {
    contacts.push(contact);
    s.physics.setSolid(obstacle, "none", null, "q2");
    s.physics.setFlags(obstacle, { alwaysTouch: true });
    s.actors.release(mover);
    return undefined;
  } });
  s.callbacks.bind(obstacle, { think: null, use: null, pain: null, die: null, touch: contact => { contacts.push(contact); return undefined; } });
  s.physics.setMotion({ actor: mover, kind: "fly-missile", velocity: { x: 100, y: 0, z: 0 }, angularVelocity: zero,
    gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
  s.physics.step(mover, 0.1);
  expect(contacts.length).toBe(2);
  const first = contacts[0], second = contacts[1];
  if (first?.sourceTrace === undefined || second?.sourceTrace === undefined) throw new Error("Missing rerelease impact metadata");
  expect(first.self).toBe(mover);
  expect(second.self).toBe(obstacle);
  expect(second.other).toBe(mover.id);
  expect(first.sourceTrace.inverted).toBe(false);
  expect(second.sourceTrace.inverted).toBe(true);
  expect(first.sourceTrace.ent).toBe(obstacle.id);
  expect(second.sourceTrace.ent).toBe(obstacle.id);
  expect(second.sourceTrace.trace).toBe(first.sourceTrace.trace);
  expect(second.plane).toBe(first.plane);
  expect(second.surface).toBe(first.surface);
  expect(first.sourceTrace.trace.hit).toEqual({ kind: "actor", actor: obstacle.id });
  expect(first.sourceTrace.trace.contents).toBe(0x2000000);
  expect(first.sourceTrace.trace.sourcePlane.normal).toEqual({ x: -1, y: 0, z: 0 });
  expect(first.sourceTrace.trace.fraction).toBeLessThan(1);
});

test("Q2 push retries after an impact removes the obstacle and triggers observe linked position", () => {
  const s = setup(), mover = s.actor("test:missile", zero, "fly-missile"), obstacle = s.actor("test:obstacle", { x: 5, y: 0, z: 0 }, "stationary");
  const trigger = s.actor("test:trigger", { x: 10, y: 0, z: 0 }, "stationary");
  s.physics.setSolid(trigger, "trigger", null, "q2");
  const seen: number[] = [];
  s.callbacks.bind(mover, { think: null, use: null, pain: null, die: null, touch: contact => { if (contact.other.equals(obstacle.id)) s.actors.release(obstacle); return undefined; } });
  s.callbacks.bind(trigger, { think: null, use: null, pain: null, die: null, touch: contact => { seen.push(s.physics.bodies.linked(contact.other)?.state.origin.x ?? -999); return undefined; } });
  s.physics.setMotion({ actor: mover, kind: "fly-missile", velocity: { x: 100, y: 0, z: 0 }, angularVelocity: zero, gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
  s.physics.step(mover, 0.1);
  expect(s.actors.isLive(obstacle.id)).toBe(false);
  expect(s.physics.bodies.read(mover.id)?.origin.x).toBe(10);
  expect(seen).toEqual([10]);
});

test("Q1 blocked callback sees earlier riders moved and rollback retains callback velocity", () => {
  const observed: number[] = [];
  let pushed: OwnedActor | null = null;
  const s = setup("q1", emptyWorld(), (_pusher, _other) => {
    if (pushed !== null) {
      const body = s.physics.bodies.read(pushed.id);
      if (body !== null) { observed.push(body.origin.x); s.physics.bodies.write(pushed, { ...body, velocity: { x: 77, y: 0, z: 0 } }); }
    }
    return undefined;
  });
  const platform = s.actor("test:pusher", zero, "push", { min: { x: -5, y: -5, z: -1 }, max: { x: 5, y: 5, z: 1 } });
  const first = s.actor("test:rider", { x: -3, y: 0, z: 3 }, "step"); pushed = first;
  const blocked = s.actor("test:blocked", { x: 7, y: 0, z: 0 }, "step");
  const body = s.physics.bodies.read(first.id); if (body !== null) s.physics.bodies.write(first, { ...body, ground: platform.id }); s.physics.bodies.link(first);
  s.actor("test:wall", { x: 11, y: 0, z: 0 }, "stationary");
  const result = s.physics.pushMove(platform, { x: 4, y: 0, z: 0 });
  expect(result?.equals(blocked.id)).toBe(true);
  expect(observed).toEqual([1]);
  expect(s.physics.bodies.read(platform.id)?.origin.x).toBe(0);
  expect(s.physics.bodies.read(first.id)?.origin.x).toBe(-3);
  expect(s.physics.bodies.read(first.id)?.velocity.x).toBe(77);
});

test("Q2 blocked callback runs after pusher and rider rollback", () => {
  const positions: number[] = [];
  const s = setup("q2", emptyWorld(), (pusher, other) => { positions.push(s.physics.bodies.read(pusher.id)?.origin.x ?? -999, s.physics.bodies.read(other)?.origin.x ?? -999); return undefined; });
  const platform = s.actor("test:pusher", zero, "push", { min: { x: -5, y: -5, z: -1 }, max: { x: 5, y: 5, z: 1 } });
  const rider = s.actor("test:rider", { x: 3, y: 0, z: 1.5 }, "step");
  const body = s.physics.bodies.read(rider.id); if (body !== null) s.physics.bodies.write(rider, { ...body, ground: platform.id }); s.physics.bodies.link(rider);
  s.actor("test:wall", { x: 7, y: 0, z: 1.5 }, "stationary");
  expect(s.physics.pushMove(platform, { x: 4, y: 0, z: 0 })?.equals(rider.id)).toBe(true);
  expect(positions).toEqual([0, 3]);
});

test("Q2 pusher teams roll back earlier members before the blocked callback", () => {
  const positions: number[] = [];
  let first: OwnedActor | null = null;
  const s = setup("q2", emptyWorld(), () => { if (first !== null) positions.push(s.physics.bodies.read(first.id)?.origin.x ?? -999); return undefined; });
  first = s.actor("test:first-pusher", { x: -30, y: 0, z: 0 }, "push");
  const second = s.actor("test:second-pusher", zero, "push", { min: { x: -5, y: -5, z: -1 }, max: { x: 5, y: 5, z: 1 } });
  const rider = s.actor("test:rider", { x: 3, y: 0, z: 1.5 }, "step");
  const body = s.physics.bodies.read(rider.id); if (body !== null) s.physics.bodies.write(rider, { ...body, ground: second.id }); s.physics.bodies.link(rider);
  s.actor("test:wall", { x: 7, y: 0, z: 1.5 }, "stationary");
  for (const actor of [first, second]) s.physics.setMotion({ actor, kind: "push", velocity: { x: 40, y: 0, z: 0 }, angularVelocity: zero,
    gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x6000003, owner: null });
  expect(s.physics.pushTeam([first, second], 0.1)?.equals(rider.id)).toBe(true);
  expect(positions).toEqual([-30]);
  expect(s.physics.bodies.read(first.id)?.origin.x).toBe(-30);
});

const pakPath = "/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK";
test.skipIf(!existsSync(pakPath))("shared toss physics settles a Q2 body on the real Quake start map", async () => {
  const archive = await openArchive(pakPath);
  try {
    const entry = archive.findEntries("maps/start.bsp")[0]; if (entry === undefined) throw new Error("No start map");
    const map = readQ1Bsp(await archive.readEntry(entry));
    const player = map.entityList.find(entity => q1EntityValue(entity, "classname") === "info_player_start");
    const coordinates = player === undefined ? [] : (q1EntityValue(player, "origin") ?? "").trim().split(/\s+/).map(Number);
    const x = coordinates[0], y = coordinates[1], z = coordinates[2]; if (x === undefined || y === undefined || z === undefined) throw new Error("No player origin");
    const s = setup("q2", map), body = s.actor("test:toss", { x, y, z: z + 50 }, "toss");
    for (let i = 0; i < 25; i++) s.physics.step(body, 0.05);
    const state = s.physics.bodies.read(body.id);
    expect(state?.ground?.equals(s.world.id)).toBe(true);
    expect(state?.velocity).toEqual(zero);
    expect(state?.origin.z).toBeLessThan(z + 50);
    const ceiling = s.actor("test:ceiling-gravity", { x, y, z: z + 30 }, "toss");
    s.physics.setMotion({ actor: ceiling, kind: "toss", velocity: zero, angularVelocity: zero, gravity: 1,
      gravityVector: { x: 0, y: 0, z: 1 }, clipMask: 0x6000003, owner: null });
    for (let i = 0; i < 25; i++) s.physics.step(ceiling, 0.05);
    const upsideDown = s.physics.bodies.read(ceiling.id);
    expect(upsideDown?.ground?.equals(s.world.id)).toBe(true);
    expect(upsideDown?.velocity).toEqual(zero);
    expect(upsideDown?.origin.z).toBeGreaterThan(z + 30);
  } finally { archive.close(); }
});

test.skipIf(!existsSync(pakPath))("shared Q1 transaction carries a foreign rider on the authored e1m1 platform model", async () => {
  const archive = await openArchive(pakPath);
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0]; if (entry === undefined) throw new Error("Missing e1m1");
    const map = readQ1Bsp(await archive.readEntry(entry));
    const source = map.entityList.find(entity => q1EntityValue(entity, "classname") === "func_plat" && q1EntityValue(entity, "model") === "*22");
    const model = map.models[22]; if (source === undefined || model === undefined) throw new Error("Missing authored platform");
    const s = setup("q1", map), platform = s.actor("test:authored-platform", zero, "push", model.bounds);
    s.physics.setSolid(platform, "brush", 22, "q1"); s.physics.bodies.link(platform);
    // Player-only fixture placement on the unchanged authored brush's upper surface.
    const origin = { x: (model.bounds.min.x + model.bounds.max.x) / 2, y: (model.bounds.min.y + model.bounds.max.y) / 2, z: model.bounds.max.z + 3 };
    const rider = s.actor("test:rider", origin, "step"), body = s.physics.bodies.read(rider.id);
    if (body === null) throw new Error("Missing rider");
    s.physics.setSolid(rider, "box", null, "q2");
    s.physics.setFlags(rider, { player: true });
    s.physics.bodies.write(rider, { ...body, ground: platform.id }); s.physics.bodies.link(rider);
    expect(s.physics.pushMove(platform, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(s.physics.bodies.read(platform.id)?.origin.z).toBe(-1);
    expect(s.physics.bodies.read(rider.id)?.origin.z).toBe(origin.z - 1);
    expect(s.physics.bodies.read(rider.id)?.ground).toEqual(platform.id);
    s.actors.close();
  } finally { archive.close(); }
});
