import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { MovementServices, Q2MovementInput, Q2MovementState, Q2RereleaseMovementInput, Q2RereleaseMovementState } from "../../../src/contracts/movement.ts";
import type { NumericProfile } from "../../../src/contracts/numeric.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createNumericOperations } from "../../../src/core/numeric.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { applyQ2MovementContacts, ButtonT, createQ2ClassicMovementProvider, createQ2RereleaseMovementProvider, moveQ2Rerelease, Q2RereleaseMovementContext, PmflagsT, q2PlayerShape } from "../../../src/movement/q2/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const numericProfile: NumericProfile = { id: "q2:binary32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" };
const numeric = createNumericOperations(numericProfile);
const identities = createIdentityOwner("q2-movement-smoke");
const actor = identities.ownedActor(identities.actor(1, 1), "q2:game");
const base = {
  actor, commandSequence: 0, shape: q2PlayerShape(),
  frame: { frame: 1, time: { kind: "milliseconds", value: 100 }, elapsed: { kind: "milliseconds", value: 16 }, phase: "client-command" },
  environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 },
  arsenal: { provider: "q3:weapons", activeWeapon: null, state: { kind: "q3", sourceWeapon: 2, state: 0, timeMilliseconds: 0 }, ammo: [] },
  animation: { provider: "q3:animation", state: { kind: "q3", legs: 0, torso: 0, legsTimerMilliseconds: 0, torsoTimerMilliseconds: 0 } },
  execution: "authoritative",
} satisfies Omit<Q2MovementInput, "kind" | "command" | "state" | "profile">;

function classic(origin: Vec3): Q2MovementInput {
  return { ...base, kind: "q2-classic", command: { kind: "q2-classic", milliseconds: 16, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 0 },
    state: { kind: "q2-classic", type: 0, originEighths: [origin.x * 8, origin.y * 8, origin.z * 8], velocityEighths: [0, 0, 0], flags: 0, timeEightMilliseconds: 0, gravity: 800, deltaAngleShorts: [0, 0, 0] },
    profile: { kind: "q2-classic", id: "q2:classic", airAccelerate: 0, snapInitial: false, clock: { kind: "q2-classic", frameMilliseconds: 100 }, numeric: numericProfile } };
}
function rerelease(origin: Vec3, n64Physics = false): Q2RereleaseMovementInput {
  return { ...base, kind: "q2-rerelease", viewOffset: zero, snapInitial: false, command: { kind: "q2-rerelease", milliseconds: 16, angles: zero, forwardMove: 0, sideMove: 0, buttons: 0, serverFrame: 1 },
    state: { kind: "q2-rerelease", type: 0, origin, velocity: zero, flags: 0, timeMilliseconds: 0, gravity: 800, deltaAngles: zero, viewHeight: 22 },
    profile: { kind: "q2-rerelease", id: "q2:rerelease", airAccelerate: 0, n64Physics, clock: { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" }, numeric: numericProfile } };
}

async function level() {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
  try {
    const entry = archive.findEntries("maps/base1.bsp")[0];
    if (entry === undefined) throw new Error("Retail base1 missing");
    const world = decodeQ2Map(await archive.readEntry(entry));
    const spawn = [...world.entities.matchAll(/\{[^}]*"classname"\s+"info_player_start"[^}]*\}/g)].find(match => !match[0].includes("\"targetname\""));
    if (spawn === undefined) throw new Error("Retail base1 spawn missing");
    const originMatch = spawn[0].match(/"origin"\s+"([^\"]+)"/);
    if (originMatch?.[1] === undefined) throw new Error("Retail base1 spawn has no origin");
    const [x, y, z] = originMatch[1].split(/\s+/).map(Number);
    if (x === undefined || y === undefined || z === undefined) throw new Error("Invalid retail spawn origin");
    return { world, origin: { x, y, z } };
  } finally { archive.close(); }
}
const installed = await Bun.file("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak").exists();

describe.skipIf(!installed)("Q2 movement against retail base1 geometry", () => {
  test("classic fixed-point movement, jump release, and crouch retain independent arsenal and animation", async () => {
    const map = await level();
    const scene = createSceneQueries(map.world);
    const services: MovementServices = { scene, numeric, touch: (_contact, state) => ({ kind: "continue", state }),
      weaponStep: () => { throw new Error("Q2 pmove must not own Q3 weapon frames"); }, animationStep: () => { throw new Error("Q2 pmove must not own Q3 animation"); } };
    const provider = createQ2ClassicMovementProvider("q2:classic");
    let input = classic(map.origin);
    let state: Q2MovementState = input.state;
    for (let i = 0; i < 30; i++) {
      const result = provider.move({ ...input, state, commandSequence: i }, services);
      if (result.status !== "active") throw new Error("Unexpected removal");
      state = result.state;
    }
    expect(state.flags & PmflagsT.PMF_ON_GROUND).not.toBe(0);
    const settled = state;
    input = { ...input, command: { ...input.command, upMove: -200 } };
    const duck = provider.move({ ...input, state }, services);
    if (duck.status !== "active") throw new Error("Unexpected removal");
    expect(duck.bounds.max.z).toBe(4);
    expect(duck.viewHeight).toBe(-2);
    const run = provider.move({ ...input, state: settled, command: { ...input.command, forwardMove: 200, upMove: 0 } }, services);
    if (run.status !== "active") throw new Error("Unexpected removal");
    expect(run.state.originEighths).not.toEqual(settled.originEighths);
    expect(run.state.originEighths.every(Number.isInteger)).toBe(true);
    expect(run.arsenal).toBe(input.arsenal);
    expect(run.animation).toBe(input.animation);
    const jump = provider.move({ ...input, state: settled, command: { ...input.command, upMove: 200 } }, services);
    if (jump.status !== "active") throw new Error("Unexpected removal");
    expect(jump.state.velocityEighths[2]).toBeGreaterThan(0);
    expect(jump.state.flags & PmflagsT.PMF_JUMP_HELD).not.toBe(0);
  });

  test("rerelease and Quake 64 use identical authority and prediction configs", async () => {
    const map = await level();
    const services: MovementServices = { scene: createSceneQueries(map.world), numeric, touch: (_contact, state) => ({ kind: "continue", state }),
      weaponStep: () => { throw new Error("Unexpected weapon simulation"); }, animationStep: () => { throw new Error("Unexpected animation simulation"); } };
    const provider = createQ2RereleaseMovementProvider("q2:rerelease", new Q2RereleaseMovementContext());
    for (const n64Physics of [false, true]) {
      const input = rerelease(map.origin, n64Physics);
      let state: Q2RereleaseMovementState = input.state;
      for (let i = 0; i < 30; i++) {
        const result = provider.move({ ...input, state, commandSequence: i }, services);
        if (result.status !== "active") throw new Error("Unexpected removal");
        state = result.state;
      }
      const command = { ...input.command, buttons: ButtonT.BUTTON_CROUCH };
      const authority = provider.move({ ...input, state, command }, services);
      const prediction = provider.move({ ...input, state, command, execution: "prediction" }, services);
      expect(authority).toEqual(prediction);
      if (authority.status !== "active") throw new Error("Unexpected removal");
      expect(authority.bounds.max.z).toBe(n64Physics ? 32 : 4);
      const detailed = moveQ2Rerelease({ ...input, state, snapInitial: true, command: { ...input.command, buttons: ButtonT.BUTTON_JUMP } }, services, new Q2RereleaseMovementContext());
      if (detailed.status !== "active") throw new Error("Unexpected removal");
      expect(detailed.jumpSound).toBe(true);
      expect(detailed.state.velocity.z).toBeGreaterThan(0);
    }
  });

  test("contacts preserve synchronous state changes and removal, including world contacts", async () => {
    const map = await level();
    const scene = createSceneQueries(map.world);
    const input = rerelease(map.origin);
    let count = 0;
    const services: MovementServices = { scene, numeric, touch: (_contact, state) => {
      count++;
      return state.kind === "q2-rerelease" ? { kind: "continue", state: { ...state, velocity: { x: 123, y: 0, z: 0 } } } : { kind: "continue", state };
    }, weaponStep: () => { throw new Error("Unexpected weapon step"); }, animationStep: () => { throw new Error("Unexpected animation step"); } };
    const provider = createQ2RereleaseMovementProvider("q2:rerelease", new Q2RereleaseMovementContext());
    let state = input.state;
    for (let i = 0; i < 30 && count === 0; i++) {
      const step = provider.move({ ...input, state }, services);
      const result = applyQ2MovementContacts(input, services, step);
      if (result.status !== "active") throw new Error("Unexpected removal");
      state = result.state;
    }
    expect(count).toBeGreaterThan(0);
    expect(state.velocity.x).toBe(123);
    const moved = provider.move({ ...input, state }, services);
    const removed = applyQ2MovementContacts(input, { ...services, touch: () => ({ kind: "actor-removed" }) }, moved);
    expect(removed.status).toBe("actor-removed");
    expect("state" in removed).toBe(false);
  });
});

const q3ArchivePath = "/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3";
test.skipIf(!await Bun.file(q3ArchivePath).exists())("Q2 rerelease movement uses Q3 retail geometry and a separately selected character body", async () => {
  const archive = await openArchive(q3ArchivePath);
  try {
    const entry = archive.findEntries("maps/q3dm1.bsp")[0];
    if (entry === undefined) throw new Error("Retail q3dm1 missing");
    const { parseQ3Bsp, adaptQ3Bsp } = await import("../../../src/formats/q3-map/index.ts");
    const map = parseQ3Bsp(await archive.readEntry(entry));
    const spawn = map.entityRecords.find(entity => entity.get("classname") === "info_player_deathmatch");
    const origin = spawn?.get("origin");
    if (origin === undefined) throw new Error("Retail q3dm1 spawn missing");
    const [x, y, z] = origin.split(/\s+/).map(Number);
    if (x === undefined || y === undefined || z === undefined) throw new Error("Invalid Q3 spawn");
    const input: Q2RereleaseMovementInput = { ...rerelease({ x, y, z }),
      shape: { kind: "box", bounds: { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } } } };
    const services: MovementServices = { scene: createSceneQueries(adaptQ3Bsp(map)), numeric,
      touch: () => { throw new Error("Pmove must return contacts before ClientThink's link/trigger phase"); },
      weaponStep: () => { throw new Error("Unexpected weapon step"); }, animationStep: () => { throw new Error("Unexpected animation step"); } };
    const provider = createQ2RereleaseMovementProvider("q2:rerelease", new Q2RereleaseMovementContext());
    let state = input.state;
    for (let frame = 0; frame < 60; frame++) {
      const result = provider.move({ ...input, state, commandSequence: frame }, services);
      if (result.status !== "active") throw new Error("Unexpected removal");
      if (frame === 59) expect(result.bounds.min.x).toBe(-15);
      state = result.state;
    }
    expect(state.flags & PmflagsT.PMF_ON_GROUND).not.toBe(0);
    const jump = provider.move({ ...input, state, command: { ...input.command, buttons: ButtonT.BUTTON_JUMP } }, services);
    if (jump.status !== "active") throw new Error("Unexpected removal");
    expect(jump.state.velocity.z).toBeGreaterThan(0);
    expect(jump.jumpSound).toBe(true);
  } finally { archive.close(); }
});
