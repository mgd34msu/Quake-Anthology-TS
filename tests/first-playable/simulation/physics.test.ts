import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import type { Q1WorldGeometry } from "../../../src/contracts/scene.ts";
import type { Q2Motion } from "../../../src/content/q2/foundation/host.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { SharedPhysics } from "../../../src/app/bootstrap/simulation/physics.ts";
import type { PhysicsFamily } from "../../../src/app/bootstrap/simulation/physics.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../src/formats/q1-map/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const unitBounds: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
function emptyWorld(): Q1WorldGeometry {
  const bounds: Bounds = { min: { x: -256, y: -256, z: -256 }, max: { x: 256, y: 256, z: 256 } };
  return { kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [-2, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
}
function setup(family: PhysicsFamily = "q2", map = emptyWorld(), blocked: (pusher: OwnedActor, other: ActorId) => undefined = () => undefined) {
  const actors = new SessionActorRegistry(createIdentityOwner("physics-test"));
  const callbacks = new ActorCallbackTable(actors), world = actors.allocate("world:scene", "world:world");
  const scene = createSceneQueries(map);
  const physics = new SharedPhysics({ actors, callbacks, scene, numeric: family === "q1" ? Q1_DONOR_PROFILE : Q2_DONOR_PROFILE,
    sourceOrder: (a, b) => a.slot - b.slot, worldActor: () => world.id, onBlocked: blocked });
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
