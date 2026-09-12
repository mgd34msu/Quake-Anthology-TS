import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { ActorAnimationState, ArsenalState, MovementServices, Q1MovementInput, Q1MovementParameters, Q1MovementState, QwMovementInput } from "../../../src/contracts/movement.ts";
import type { DecodedWorld, TraceShape } from "../../../src/contracts/scene.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { parseEntities } from "../../../src/core/common-parse.ts";
import { createNumericOperations, Q1_DONOR_PROFILE, Q3Random } from "../../../src/core/numeric.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createQ1MovementProvider, createQwMovementProvider, createQ1MonsterMovement, moveQ1Pusher, Q1_FLAG_JUMPRELEASED, Q1_FLAG_ONGROUND, Q1_MOVE_PUSH, Q1_MOVE_WALK, q1PlayerJump,
  type Q1MonsterMoveState, type Q1PhysicsEntity, type Q1PusherServices } from "../../../src/movement/q1/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const owner = createIdentityOwner("q1-movement-smoke");
const actor = owner.ownedActor(owner.actor(1, 0), "q3:character");
const shape: TraceShape = { kind: "box", bounds: { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } } };
const arsenal: ArsenalState = { provider: "q3:weapons", activeWeapon: null,
  state: { kind: "q3", sourceWeapon: 5, state: 0, timeMilliseconds: 0 }, ammo: [] };
const animation: ActorAnimationState = { provider: "q3:character", state: { kind: "q3", legs: 22, torso: 11, legsTimerMilliseconds: 0, torsoTimerMilliseconds: 0 } };
const parameters: Q1MovementParameters = { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500,
  accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 };
const root = process.env["QUAKE_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../qfiles");
const fixtures: readonly { readonly path: string; readonly map: string; read(bytes: Uint8Array): DecodedWorld }[] = [
  { path: "q1/rerelease/id1/pak0.pak", map: "maps/start.bsp", read: readQ1Bsp },
  { path: "q2/baseq2/pak0.pak", map: "maps/base1.bsp", read: decodeQ2Map },
  { path: "q3a/baseq3/pak0.pk3", map: "maps/q3dm1.bsp", read: decodeQ3World },
];
async function fixtureScene(fixture: typeof fixtures[number]) {
  const archive = await openArchive(resolve(root, fixture.path));
  try {
    const entry = archive.findEntries(fixture.map)[0];
    if (entry === undefined) throw new Error(`Missing ${fixture.map}`);
    const world = fixture.read(await archive.readEntry(entry));
    const spawn = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start" || entity.get("classname") === "info_player_deathmatch");
    const coordinates = spawn?.get("origin")?.split(/\s+/).map(Number);
    const x = coordinates?.[0], y = coordinates?.[1], z = coordinates?.[2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Map has no player origin");
    return { scene: createSceneQueries(world), origin: { x, y, z: z + 16 } };
  } finally { archive.close(); }
}
function services(scene: ReturnType<typeof createSceneQueries>): MovementServices {
  return { scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), touch: (_contact, state) => ({ kind: "continue", state }),
    weaponStep: input => ({ arsenal: input.arsenal, animation: input.animation, effects: [] }),
    animationStep: input => ({ animation: input.animation, effects: [] }) };
}
function input(origin: Vec3): Q1MovementInput {
  const state: Q1MovementState = { kind: "q1-netquake", origin, oldOrigin: origin, velocity: zero, angularVelocity: zero,
    angles: zero, viewAngles: zero, punchAngles: zero, moveType: Q1_MOVE_WALK, flags: Q1_FLAG_JUMPRELEASED,
    ground: { kind: "none" }, waterLevel: 0, waterType: -1, teleportTimeSeconds: 0, waterJumpDirection: zero,
    idealPitch: 0, fixAngle: false, health: 100 };
  return { kind: "q1-netquake", actor, commandSequence: 0, frame: { frame: 0, time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.02 }, phase: "client-command" },
    shape, environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, arsenal, animation,
    execution: "authoritative", state,
    command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1, viewAngles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    profile: { kind: "q1-netquake", id: "q1:classic", edition: "classic", numeric: Q1_DONOR_PROFILE,
      clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null },
      parameters, edgeFriction: 2, noClipAngleHack: false } };
}
function qwInput(base: Q1MovementInput): QwMovementInput {
  return { ...base, kind: "q1-quakeworld", state: { kind: "q1-quakeworld", origin: base.state.origin, velocity: base.state.velocity,
    angles: zero, oldButtons: 0, waterJumpTimeSeconds: 0, dead: false, spectator: 0, ground: base.state.ground },
    command: { kind: "q1-quakeworld", milliseconds: 20, angles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    profile: { kind: "q1-quakeworld", id: "q1:qw", numeric: Q1_DONOR_PROFILE,
      clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 }, parameters } };
}

for (const fixture of fixtures) {
  test.skipIf(!existsSync(resolve(root, fixture.path)))(`Q1 movement settles and walks in ${fixture.map} with foreign character bounds`, async () => {
    const loaded = await fixtureScene(fixture), host = services(loaded.scene);
    const provider = createQ1MovementProvider("q1:classic");
    let current = input(loaded.origin);
    for (let frame = 0; frame < 40; frame++) {
      const result = provider.move(current, host);
      if (result.status !== "active") throw new Error("Actor removed in static map");
      current = { ...current, state: result.state };
    }
    expect(current.state.flags & Q1_FLAG_ONGROUND).toBe(Q1_FLAG_ONGROUND);
    expect(current.state.ground.kind).toBe("world");
    const start = current.state.origin;
    current = { ...current, command: { ...current.command, forwardMove: 320 } };
    for (let frame = 0; frame < 10; frame++) {
      const result = provider.move(current, host);
      if (result.status !== "active") throw new Error("Actor removed in static map");
      expect(result.arsenal).toBe(arsenal);
      expect(result.animation).toBe(animation);
      expect(result.bounds).toEqual(shape.bounds);
      current = { ...current, state: result.state };
    }
    expect(Math.hypot(current.state.origin.x - start.x, current.state.origin.y - start.y)).toBeGreaterThan(1);
    const jumped = q1PlayerJump({ ...current.state, flags: current.state.flags | Q1_FLAG_JUMPRELEASED }, host);
    expect(jumped.action).toBe("jump");
    expect(jumped.state.velocity.z).toBe(270);
    const providerJump = provider.move({ ...current, command: { ...current.command, buttons: 2 } }, host);
    if (providerJump.status !== "active") throw new Error("Unexpected jump removal");
    expect(providerJump.state.velocity.z).toBe(254);
    expect(providerJump.state.origin.z).toBeGreaterThan(current.state.origin.z);
  }, 20000);
}

const q1 = fixtures[0];
if (q1 === undefined) throw new Error("Missing Quake fixture definition");
test.skipIf(!existsSync(resolve(root, q1.path)))("QW long commands retain source split timing and jumping", async () => {
  const loaded = await fixtureScene(q1), host = services(loaded.scene);
  const provider = createQwMovementProvider("q1:qw");
  let current = qwInput(input(loaded.origin));
  for (let frame = 0; frame < 40; frame++) {
    const result = provider.move(current, host);
    if (result.status !== "active") throw new Error("Actor removed in static map");
    current = { ...current, state: result.state };
  }
  expect(current.state.ground.kind).toBe("world");
  const long = provider.move({ ...current, command: { ...current.command, milliseconds: 53, forwardMove: 320 } }, host);
  const first = provider.move({ ...current, command: { ...current.command, milliseconds: 26, forwardMove: 320 } }, host);
  if (first.status !== "active" || long.status !== "active") throw new Error("Unexpected removal");
  const second = provider.move({ ...current, state: first.state, command: { ...current.command, milliseconds: 26, forwardMove: 320 } }, host);
  if (second.status !== "active") throw new Error("Unexpected removal");
  expect(long.state).toEqual(second.state);
  const jump = provider.move({ ...current, command: { ...current.command, buttons: 2 } }, host);
  if (jump.status !== "active") throw new Error("Unexpected removal");
  expect(jump.state.ground.kind).toBe("none");
  expect(jump.state.velocity.z).toBe(254);
  expect(jump.state.origin.z).toBeGreaterThan(current.state.origin.z);
}, 20000);

test.skipIf(!existsSync(resolve(root, q1.path)))("NetQuake stops synchronously when a floor touch deletes the actor", async () => {
  const loaded = await fixtureScene(q1), host = services(loaded.scene);
  let weaponCalls = 0;
  const deleting: MovementServices = { ...host, touch: () => ({ kind: "actor-removed" }),
    weaponStep: step => { weaponCalls++; return { arsenal: step.arsenal, animation: step.animation, effects: [] }; } };
  const provider = createQ1MovementProvider("q1:classic");
  let current = input(loaded.origin), removed = false;
  for (let frame = 0; frame < 50; frame++) {
    const before = weaponCalls;
    const result = provider.move(current, deleting);
    if (result.status === "actor-removed") {
      expect("state" in result).toBe(false);
      expect(weaponCalls).toBe(before);
      expect(result.effects.some(effect => effect.effect.kind === "touch")).toBe(true);
      removed = true; break;
    }
    current = { ...current, state: result.state };
  }
  expect(removed).toBe(true);
}, 20000);

test.skipIf(!existsSync(resolve(root, q1.path)))("Q1 moving platform carries a foreign-bounds rider through real scene queries", async () => {
  const loaded = await fixtureScene(q1), host = services(loaded.scene), riderInput = input(loaded.origin);
  const pusherActor = owner.ownedActor(owner.actor(2, 0), "q1:platform");
  const platformBounds = { min: { x: -32, y: -32, z: -8 }, max: { x: 32, y: 32, z: 8 } };
  const platformOrigin = { ...loaded.origin, z: loaded.origin.z - 32 };
  const bounds = (origin: Vec3, relative: typeof platformBounds) => ({
    min: { x: origin.x + relative.min.x, y: origin.y + relative.min.y, z: origin.z + relative.min.z },
    max: { x: origin.x + relative.max.x, y: origin.y + relative.max.y, z: origin.z + relative.max.z } });
  const platform: Q1PhysicsEntity = { actor: pusherActor,
    state: { ...riderInput.state, origin: platformOrigin, oldOrigin: platformOrigin, moveType: Q1_MOVE_PUSH, velocity: { x: 40, y: 0, z: 0 } },
    bounds: platformBounds, absoluteBounds: bounds(platformOrigin, platformBounds), solid: "bsp", localTimeSeconds: 1, nextThinkSeconds: 0 };
  const rider: Q1PhysicsEntity = { actor, state: { ...riderInput.state, flags: Q1_FLAG_ONGROUND, ground: { kind: "actor", actor: pusherActor.id } },
    bounds: shape.bounds, absoluteBounds: bounds(loaded.origin, shape.bounds), solid: "slidebox", localTimeSeconds: 0, nextThinkSeconds: 0 };
  const entities = new Map([[pusherActor.id, platform], [actor.id, rider]]);
  const link = (id: typeof actor.id) => {
    const entity = entities.get(id);
    if (entity === undefined) return;
    const absoluteBounds = bounds(entity.state.origin, entity.bounds);
    entities.set(id, { ...entity, absoluteBounds });
    loaded.scene.link({ actor: id, state: { origin: entity.state.origin, angles: entity.state.angles, velocity: entity.state.velocity,
      bounds: entity.bounds, ground: entity.state.ground.kind === "actor" ? entity.state.ground.actor : null }, absoluteBounds, linkCount: 1 },
    { family: "q1", shape: { kind: "box" }, contents: -2, owner: null, role: "solid", monster: false, deadMonster: false });
  };
  link(pusherActor.id); link(actor.id);
  const pusherServices: Q1PusherServices = {
    movement: host, read: id => entities.get(id) ?? null, candidates: () => [actor.id],
    write: entity => { entities.set(entity.actor.id, entity); }, link: entity => { link(entity.id); },
    collisionEnabled: (entity, enabled) => { if (enabled) link(entity.id); else loaded.scene.unlink(entity.id); },
    testPosition: entity => {
      const trace = loaded.scene.trace({ start: entity.state.origin, end: entity.state.origin,
        shape: { kind: "box", bounds: entity.bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: entity.actor.id });
      return trace.startSolid ? trace.hit : { kind: "none" };
    },
    push: (entity, displacement) => {
      const trace = loaded.scene.trace({ start: entity.state.origin,
        end: { x: entity.state.origin.x + displacement.x, y: entity.state.origin.y + displacement.y, z: entity.state.origin.z + displacement.z },
        shape: { kind: "box", bounds: entity.bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: entity.actor.id });
      const result = { ...entity, state: { ...entity.state, origin: trace.end } };
      entities.set(entity.actor.id, result); link(entity.actor.id);
      return { entity: result, trace };
    },
    blocked: () => { throw new Error("Unobstructed platform blocked"); }, think: () => undefined,
  };
  const result = moveQ1Pusher({ actor: pusherActor.id, elapsedSeconds: 0.1, movement: "translate" }, pusherServices);
  expect(result.status).toBe("moved");
  expect(result.moved).toEqual([actor.id]);
  expect(entities.get(actor.id)?.state.origin.x).toBe(loaded.origin.x + 4);
  expect(entities.get(pusherActor.id)?.state.origin.x).toBe(platformOrigin.x + 4);
  expect(entities.get(actor.id)?.state.ground).toEqual({ kind: "actor", actor: pusherActor.id });
}, 20000);

test.skipIf(!existsSync(resolve(root, q1.path)))("Quake monster bottom checks and move-to-goal use the real BSP", async () => {
  const loaded = await fixtureScene(q1), goal = owner.actor(3, 0), random = new Q3Random(2);
  const floor = loaded.scene.trace({ start: loaded.origin, end: { ...loaded.origin, z: loaded.origin.z - 128 },
    shape, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor.id });
  const absoluteBounds = (origin: Vec3) => ({ min: { x: origin.x - 15, y: origin.y - 15, z: origin.z - 24 }, max: { x: origin.x + 15, y: origin.y + 15, z: origin.z + 32 } });
  let monster: Q1MonsterMoveState = { origin: floor.end, angles: zero, bounds: shape.bounds,
    absoluteBounds: absoluteBounds(floor.end), flags: Q1_FLAG_ONGROUND, ground: floor.hit, idealYaw: 0, yawSpeed: 20, enemy: goal };
  const goalOrigin = { ...floor.end, x: floor.end.x + 128 };
  const target: Q1MonsterMoveState = { ...monster, origin: goalOrigin, absoluteBounds: absoluteBounds(goalOrigin), enemy: null };
  let linked = 0;
  const movement = createQ1MonsterMovement({ scene: loaded.scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random,
    read: id => id.equals(actor.id) ? monster : null,
    readTarget: id => id.equals(goal) ? target : null,
    write: (_actor, state) => { monster = state; },
    link: () => { linked++; monster = { ...monster, absoluteBounds: absoluteBounds(monster.origin) }; } });
  expect(movement.checkBottom(actor.id)).toBe(true);
  expect(movement.walkMove(actor, 0, 4)).toBe(true);
  expect(monster.origin.x).toBe(floor.end.x + 4);
  movement.moveToGoal(actor, goal, 4);
  expect(monster.origin.x).toBe(floor.end.x + 8);
  expect(monster.ground.kind).toBe("world");
  expect(linked).toBe(2);
  expect(random.checkpoint().draws).toBe(1);
}, 20000);

test.skipIf(!existsSync(resolve(root, q1.path)))("NetQuake client think follows clamp and preserves the selected branch", async () => {
  const { physicsNetQuake } = await import("../../../src/movement/q1/netquake.ts");
  const loaded = await fixtureScene(q1), host = services(loaded.scene), base = input(loaded.origin), order: string[] = [];
  const result = physicsNetQuake(base, host, { hooks: {
    beforePhysics: (_input, state) => {
      if (state.kind !== "q1-netquake") throw new Error("Unexpected movement family");
      order.push("pre"); return { kind: "continue", state: { ...state, moveType: 8, velocity: { x: 4000, y: 0, z: 0 } } };
    },
    think: (_input, state) => {
      if (state.kind !== "q1-netquake") throw new Error("Unexpected movement family");
      order.push("think"); expect(state.velocity.x).toBe(2000);
      return { kind: "continue", state: { ...state, moveType: 0, velocity: { x: 3000, y: 0, z: 0 } } };
    },
    link: (_actor, state) => { order.push("link"); return { kind: "continue", state }; },
    afterPhysics: (_input, state) => { order.push("post"); return { kind: "continue", state }; },
    isBsp: () => false,
  } });
  if (result.status !== "active") throw new Error("Unexpected client removal");
  expect(order).toEqual(["pre", "think", "link", "post"]);
  expect(result.state.moveType).toBe(0);
  expect(result.state.velocity.x).toBe(3000);
  expect(result.state.origin.x).toBeCloseTo(base.state.origin.x + 60, 8);
  const removed = physicsNetQuake({ ...base, state: { ...base.state, moveType: 8 } }, host, { hooks: {
    beforePhysics: (_input, state) => ({ kind: "continue", state }), think: () => ({ kind: "actor-removed" }),
    link: () => { throw new Error("Removed client was linked"); }, afterPhysics: () => { throw new Error("Removed client reached PostThink"); }, isBsp: () => false,
  } });
  expect(removed.status).toBe("actor-removed");
});
