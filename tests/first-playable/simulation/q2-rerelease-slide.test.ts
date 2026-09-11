import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import type { Q1WorldGeometry, TraceResult } from "../../../src/contracts/scene.ts";
import type { Q2Motion } from "../../../src/content/q2/foundation/host.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../../src/core/numeric.ts";
import { SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { createQ2RereleaseFlyMove } from "../../../src/app/bootstrap/simulation/q2-rerelease-slide.ts";
import type { Q2RereleaseFlyMoveServices } from "../../../src/app/bootstrap/simulation/q2-rerelease-slide.ts";
import { stepQ2NewToss } from "../../../src/app/bootstrap/simulation/new-toss.ts";
import { Q2RereleaseMovementContext } from "../../../src/movement/q2/rerelease.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const unit: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
function fixture() {
  const bounds: Bounds = { min: { x: -256, y: -256, z: -256 }, max: { x: 256, y: 256, z: 256 } };
  const worldGeometry: Q1WorldGeometry = { kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [-2, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
  const scene = createSceneQueries(worldGeometry), actors = new SessionActorRegistry(createIdentityOwner("rerelease-slide"));
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
    onLink: linked => { scene.link(linked, { family: "q2", shape: { kind: "box" }, contents: 0x2000000, owner: null, role: "solid", monster: false, deadMonster: false }); return undefined; },
    onUnlink: actor => { scene.unlink(actor); return undefined; } });
  scene.bindActorState(actor => bodies.read(actor));
  const world = actors.allocate("world:scene", "world:world");
  const makeActor = (origin: Vec3, bounds = unit, velocity = zero): OwnedActor => {
    const actor = actors.allocate("test:body", "test:solid");
    bodies.create(actor, { origin, angles: zero, velocity, bounds, ground: null }); bodies.link(actor); return actor;
  };
  const mover = makeActor(zero, unit, { x: 100, y: 100, z: 0 });
  const wallX = makeActor({ x: 5, y: 0, z: 0 }, { min: { x: -1, y: -64, z: -64 }, max: { x: 1, y: 64, z: 64 } });
  const wallY = makeActor({ x: 0, y: 10, z: 0 }, { min: { x: -64, y: -1, z: -64 }, max: { x: 64, y: 1, z: 64 } });
  const trace = (start: Vec3, end: Vec3, bounds: Bounds): TraceResult => scene.trace({ start, end, shape: { kind: "box", bounds },
    target: { kind: "world" }, policy: { kind: "q2", contentsMask: 0x2000003, leafContents: "merged" }, numeric: Q3_BINARY32_PROFILE, passActor: mover.id });
  const hitActor = (result: TraceResult): ActorId | null => result.hit.kind === "actor" ? result.hit.actor : result.hit.kind === "world" ? world.id : null;
  const numeric = createNumericOperations(Q3_BINARY32_PROFILE), context = new Q2RereleaseMovementContext();
  const fly = createQ2RereleaseFlyMove(numeric, context);
  return { scene, actors, bodies, mover, wallX, wallY, trace, hitActor, numeric, fly, context };
}

test("rerelease NewToss buffers wall impacts and consumes velocity kill after each callback", () => {
  const s = fixture(), contacts: { actor: ActorId | null; origin: Vec3; velocity: Vec3 }[] = [];
  let killVelocity = false;
  const triggerOrigins: (Vec3 | null)[] = [];
  const services: Q2RereleaseFlyMoveServices = {
    actors: s.actors, bodies: s.bodies, trace: s.trace, hitActor: s.hitActor,
    impact: trace => {
      const body = s.bodies.read(s.mover.id); if (body === null) throw new Error("Missing mover");
      contacts.push({ actor: s.hitActor(trace), origin: body.origin, velocity: body.velocity });
      if (contacts.length === 1) {
        s.bodies.write(s.mover, { ...body, velocity: { x: 123, y: 0, z: 0 } }); killVelocity = true;
      } else s.bodies.write(s.mover, { ...body, velocity: { x: 7, y: 0, z: 0 } });
      return undefined;
    },
    takeKillVelocity: () => { const value = killVelocity; killVelocity = false; return value; },
  };
  const motion: Q2Motion = { actor: s.mover, kind: "new-toss", velocity: { x: 100, y: 100, z: 0 }, angularVelocity: zero,
    gravity: 0, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 0x2000003, owner: null };
  const result = stepQ2NewToss(s.mover, 0.2, motion, { actors: s.actors, bodies: s.bodies, numeric: s.numeric,
    edition: "rerelease", worldGravity: 800, maxVelocity: 2000, stopSpeed: 100, teamSlave: false,
    water: () => ({ waterLevel: 0, waterType: 0 }), trace: (start, end) => s.trace(start, end, unit), hitActor: s.hitActor,
    flyMove: elapsed => s.fly(s.mover, elapsed, services), writeAngularVelocity: () => undefined,
    touchTriggers: () => { triggerOrigins.push(s.bodies.linked(s.mover.id)?.state.origin ?? null); return undefined; },
    pointContents: () => 0, writeWater: () => undefined, waterSound: () => undefined });
  const final = s.bodies.read(s.mover.id); if (final === null) throw new Error("Missing final body");
  expect(result).toBe("moved");
  expect(contacts.map(contact => contact.actor)).toEqual([s.wallX.id, s.wallY.id]);
  expect(contacts.map(contact => contact.origin)).toEqual([final.origin, final.origin]);
  expect(contacts[1]?.velocity).toEqual(zero);
  expect(final.velocity).toEqual({ x: 7, y: 0, z: 0 });
  expect(killVelocity).toBe(false);
  expect(triggerOrigins).toEqual([final.origin]);
  expect(final.origin.x).toBeLessThan(3);
  expect(final.origin.y).toBeGreaterThan(7);
});

test("rerelease buffered impacts stop when the source actor is removed", () => {
  const s = fixture(), touched: (ActorId | null)[] = [];
  let consumed = false;
  s.fly(s.mover, 0.2, { actors: s.actors, bodies: s.bodies, trace: s.trace, hitActor: s.hitActor,
    impact: trace => { touched.push(s.hitActor(trace)); s.actors.release(s.mover); return undefined; },
    takeKillVelocity: () => { consumed = true; return false; } });
  expect(touched).toEqual([s.wallX.id]);
  expect(s.actors.isLive(s.mover.id)).toBe(false);
  expect(consumed).toBe(false);
});

test("server duplicate-plane recovery changes shared pml scratch without nudging the actor", () => {
  const s = fixture(), probes: Vec3[] = [];
  s.context.restore({ x: 50, y: 60, z: 70 });
  const saved = s.context.capture();
  const services: Q2RereleaseFlyMoveServices = { actors: s.actors, bodies: s.bodies, hitActor: s.hitActor,
    trace: (start, end, bounds) => {
      const trace = s.trace(start, end, bounds);
      if (start.x === end.x && start.y === end.y && start.z === end.z) { probes.push(start); return trace; }
      if (trace.kind !== "q2") throw new Error("Expected Q2 trace");
      const plane = { normal: { x: -1, y: 0, z: 0 }, distance: -4, type: 0, signbits: 1 };
      return { ...trace, fraction: 0, end: start, allSolid: false, startSolid: false,
        sourcePlane: plane, contact: { kind: "plane", plane }, hit: { kind: "actor", actor: s.wallX.id } };
    }, impact: () => undefined, takeKillVelocity: () => false };
  s.fly(s.mover, 0.2, services);
  expect(s.bodies.read(s.mover.id)?.origin).toEqual(zero);
  expect(probes).toHaveLength(3);
  expect(probes[0]).toEqual({ x: Math.fround(50 - Math.fround(0.01)), y: 60, z: 70 });
  expect(s.context.capture().x).toBeLessThan(saved.x);
  const continued = s.context.capture();
  s.context.restore(saved);
  const body = s.bodies.read(s.mover.id); if (body === null) throw new Error("Missing mover");
  s.bodies.write(s.mover, { ...body, velocity: { x: 100, y: 100, z: 0 } });
  s.fly(s.mover, 0.2, services);
  expect(s.context.capture()).toEqual(continued);
});
