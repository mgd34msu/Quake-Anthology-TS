import { clipVelocity, slideMove } from "../../../src/movement/q3/slide-move.ts";
import type { SlideMoveContext } from "../../../src/movement/q3/slide-move.ts";
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { TraceResult } from "../../../src/contracts/scene.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../../src/content/archive/index.ts";
import { q3SpawnAnimation, q3SpawnArsenalRuntime, q3SpawnLoadout } from "../../../src/content/q3/foundation/arsenal.ts";
import { createQ3SourceMovementHooks } from "../../../src/content/q3/foundation/movement-hooks.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { MovementServices, Q3MovementInput } from "../../../src/contracts/movement.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../../src/core/numeric.ts";
import { adaptQ3Bsp, parseQ3Bsp } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { CommandButtons, EntityEvent, MoveFlags, Q3CommandHistory, Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS,
  Weapon, WeaponState, createQ3MovementProvider, runQ3WeaponStep } from "../../../src/movement/q3/index.ts";
import type { Q3SourceWeaponState } from "../../../src/movement/q3/index.ts";

test("source weapon stage keeps ammo and event order through firing and exhaustion", () => {
  const ammo = new Map([[Weapon.WP_MACHINEGUN, 2]]);
  const order: string[] = [];
  const state: Q3SourceWeaponState = {
    product: "baseq3", pmFlags: 0, weapon: Weapon.WP_MACHINEGUN, weaponState: WeaponState.WEAPON_READY, weaponTime: 0,
    ownedWeapons: 1 << Weapon.WP_MACHINEGUN, health: 100, maxHealth: 100, spectator: false, haste: false,
    persistentPowerupTag: 0, holdableItem: 0, holdableTag: 0,
    ammo: { get(weapon) { return ammo.get(weapon) ?? 0; }, set(weapon, count) { ammo.set(weapon, count); order.push(`ammo:${count}`); } },
  };
  for (let i = 0; i < 5; i++) runQ3WeaponStep(state, { buttons: CommandButtons.ATTACK, weapon: Weapon.WP_MACHINEGUN }, {
    msec: 50, gauntletHit: false, event(event) { order.push(`event:${event}`); }, startTorso(animation) { order.push(`torso:${animation}`); },
  });
  expect(order).toEqual(["torso:7", "ammo:1", "event:23", "torso:7", "ammo:0", "event:23", "torso:7", "event:21"]);
  expect(state.weaponTime).toBe(500);
  expect(state.weaponState).toBe(WeaponState.WEAPON_FIRING);
});

test("command history preserves the source 64-slot replay window", () => {
  const history = new Q3CommandHistory();
  expect(history.read(-63)?.serverTimeMilliseconds).toBe(0);
  expect(history.read(-64)).toBeNull();
  for (let number = 1; number <= 65; number++) history.append({ kind: "q3", serverTimeMilliseconds: number * 8,
    angleWords: [0, 0, 0], buttons: 0, weapon: 2, forwardMove: 0, rightMove: 0, upMove: 0 });
  expect(history.read(1)).toBeNull();
  expect(history.read(2)?.serverTimeMilliseconds).toBe(16);
  expect(history.read(65)?.serverTimeMilliseconds).toBe(520);
});

const archivePath = resolve(process.env["Q3_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../qfiles/q3a"), "baseq3/pak0.pk3");
test.skipIf(!existsSync(archivePath))("retail q3dm1 movement uses shared collision, source weapons and character stages", async () => {
  const archive = await openArchive(archivePath, "pk3");
  try {
    const entry = archive.findEntries("maps/q3dm1.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail q3dm1");
    const world = adaptQ3Bsp(parseQ3Bsp(await archive.readEntry(entry)));
    const scene = createSceneQueries(world);
    const owner = createIdentityOwner("q3-movement-smoke");
    const actor = owner.ownedActor(owner.actor(1, 1), "q3:test");
    let runtime = { ...q3SpawnArsenalRuntime("baseq3", 100), respawned: false };
    const provider = createQ3MovementProvider({ id: "q3:movement", postures: () => Q3_SOURCE_POSTURES,
      hooks: createQ3SourceMovementHooks({ read() { return runtime; }, write(_actor, _execution, value) { runtime = value; },
        gauntletHit() { return false; } }) });
    const services: MovementServices = { scene, numeric: createNumericOperations(Q3_BINARY32_PROFILE),
      touch() { throw new Error("Q3 contacts must dispatch after PMove"); },
      weaponStep() { throw new Error("Source arsenal hook owns this stage"); },
      animationStep() { throw new Error("Source character hook owns this stage"); } };
    let input: Q3MovementInput = { kind: "q3", actor, commandSequence: 1,
      frame: { frame: 1, time: { kind: "milliseconds", value: 66 }, elapsed: { kind: "milliseconds", value: 66 }, phase: "client-command" },
      shape: { kind: "box", bounds: Q3_SOURCE_STANDING_BOUNDS },
      environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 },
      arsenal: q3SpawnLoadout("q3:arsenal", "baseq3", false), animation: { provider: "q3:character", state: q3SpawnAnimation() },
      execution: "authoritative", profile: { kind: "q3", id: "q3:movement", product: "baseq3", fixedMilliseconds: null, noFootsteps: false,
        numeric: Q3_BINARY32_PROFILE, clock: { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 } },
      command: { kind: "q3", serverTimeMilliseconds: 66, angleWords: [0, 0, 0], buttons: CommandButtons.ATTACK,
        weapon: Weapon.WP_MACHINEGUN, forwardMove: 127, rightMove: 0, upMove: 0 },
      state: { kind: "q3", commandTimeMilliseconds: 0, movementType: 0, bobCycle: 0, movementFlags: 0, movementTimeMilliseconds: 0,
        origin: { x: 216, y: 1328, z: 24 }, velocity: { x: 0, y: 0, z: 0 }, gravity: 800, speed: 320,
        deltaAngleWords: [0, 0, 0], movementDirection: 0, grapplePoint: { x: 0, y: 0, z: 0 }, flags: 0,
        viewAngles: { x: 0, y: 0, z: 0 }, viewHeight: 26, ground: { kind: "world", model: 0 }, jumpPad: null,
        movementFrame: 0, jumpPadFrame: 0, predictableEventSequence: 0 } };
    const walk = provider.move(input, services);
    if (walk.status !== "active") throw new Error("Actor was removed during movement");
    expect(walk.state.origin.x).toBeGreaterThan(216);
    expect(walk.ground.kind).toBe("world");
    expect(walk.arsenal.ammo.find(value => value.item === "q3:ammo/machinegun")?.count).toBe(99);
    expect(walk.effects.some(effect => effect.effect.kind === "event" && effect.effect.value.event === EntityEvent.EV_FIRE_WEAPON)).toBe(true);
    input = { ...input, state: walk.state, arsenal: walk.arsenal, animation: walk.animation, commandSequence: 2,
      command: { ...input.command, serverTimeMilliseconds: 132, buttons: 0, upMove: 127 } };
    const jump = provider.move(input, services);
    if (jump.status !== "active") throw new Error("Actor was removed during jump");
    expect(jump.state.origin.z).toBeGreaterThan(walk.state.origin.z);
    expect(jump.state.velocity.z).toBeGreaterThan(0);
    expect(jump.state.movementFlags & MoveFlags.JUMP_HELD).not.toBe(0);
    expect(jump.effects.some(effect => effect.effect.kind === "event" && effect.effect.value.event === EntityEvent.EV_JUMP)).toBe(true);
    input = { ...input, state: jump.state, arsenal: jump.arsenal, animation: jump.animation, commandSequence: 3,
      command: { ...input.command, serverTimeMilliseconds: 198, buttons: 0, upMove: -127 } };
    const crouch = provider.move(input, services);
    if (crouch.status !== "active") throw new Error("Actor was removed during crouch");
    expect(crouch.bounds).toEqual(Q3_SOURCE_POSTURES.crouched.bounds);
    expect(crouch.viewHeight).toBe(12);
    expect(crouch.state.commandTimeMilliseconds).toBe(198);
    expect(crouch.state.predictableEventSequence).toBeGreaterThan(0);
    const authored = provider.move({ ...input, command: { ...input.command, upMove: 0 }, environment: { ...input.environment, clientOutputs: { stance: true } } }, services);
    if (authored.status !== "active") throw new Error("Player removed");
    expect(authored.bounds).toEqual(crouch.bounds); expect(authored.viewHeight).toBe(crouch.viewHeight);
    const bodyBounds = { min: { x: -7, y: -9, z: -20 }, max: { x: 8, y: 10, z: 12 } };
    const body = provider.move({ ...input, shape: { kind: "capsule", bounds: input.shape.kind === "point" ? Q3_SOURCE_STANDING_BOUNDS : input.shape.bounds },
      environment: { ...input.environment, clientOutputs: { bodyBounds } } }, services);
    if (body.status !== "active") throw new Error("Player removed");
    expect(body.bounds).toEqual(bodyBounds);
    const blockedBody = provider.move({ ...input, state: body.state, currentBounds: body.bounds,
      command: { ...input.command, serverTimeMilliseconds: 264 },
      environment: { ...input.environment, clientOutputs: { bodyBounds: { min: { x: -10000, y: -10000, z: -10000 }, max: { x: 10000, y: 10000, z: 10000 } } } } }, services);
    if (blockedBody.status !== "active") throw new Error("Player removed");
    expect(blockedBody.bounds).toEqual(bodyBounds);
    let output: import("../../../src/contracts/mod-client-outputs.ts").ModClientMovementOutputs = { mode: "freeze" };
    const frozen = provider.move({ ...input, environment: { ...input.environment, get clientOutputs() { return output; } } }, { ...services,
      inputApplication: { begin: (command, _frame, state) => ({ kind: "continue", command, state }), end: state => { output = {}; return { kind: "continue", state }; } } });
    if (frozen.status !== "active") throw new Error("Player removed");
    expect(frozen.state.movementType).toBe(input.state.movementType);

  } finally { archive.close(); }
});


function slideFixture(velocity: Vec3, normal: Vec3, fraction = 0.5) {
  const owner = createIdentityOwner("q3-slide-policy");
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  let traces = 0, touches = 0;
  const context: SlideMoveContext = {
    state: { commandTime: 0, pmType: 0, bobCycle: 0, pmFlags: 0, pmTime: 0, origin: zero, velocity, gravity: 800, speed: 320,
      deltaAngles: zero, ground: { kind: "none" }, movementDir: 0, grapplePoint: zero, eFlags: 0, viewangles: zero, viewheight: 26,
      pmoveFramecount: 0, eventSequence: 0, actor: owner.actor(1, 1), health: 100, flight: false, invulnerable: false, product: "baseq3" },
    frameTime: 0.1, bounds: Q3_SOURCE_STANDING_BOUNDS, mask: 1, groundNormal: null, impactSpeed: 0,
    trace: (start, end): TraceResult => {
      traces++;
      const step = traces === 1 ? fraction : 1;
      const plane = { normal, distance: 0, type: 3, signbits: 0 };
      return { kind: "q3", fraction: step, end: { x: Math.fround(start.x + Math.fround((end.x - start.x) * step)),
        y: Math.fround(start.y + Math.fround((end.y - start.y) * step)), z: Math.fround(start.z + Math.fround((end.z - start.z) * step)) },
        allSolid: false, startSolid: false, contact: { kind: "plane", plane }, sourcePlane: plane,
        hit: step === 1 ? { kind: "none" } : { kind: "world", model: 0 }, contents: 1, surfaceFlags: 0 };
    }, touch: () => { touches++; }, event: () => undefined,
  };
  return { context, touches: () => touches, traces: () => traces };
}

test("Q3 shared sweep clips gravity end velocity separately and restores timed primal velocity", () => {
  const wall = { x: -1, y: 0, z: 0 };
  for (const timer of [0, 10]) {
    const fixture = slideFixture({ x: 100, y: 0, z: 100 }, wall), context = fixture.context;
    context.state.pmTime = timer;
    expect(slideMove(context, true)).toBe(true);
    expect(context.state.velocity).toEqual(timer === 0 ? clipVelocity({ x: 100, y: 0, z: 20 }, wall) : { x: 100, y: 0, z: 20 });
    expect(context.state.origin.z).toBe(6);
    expect(context.impactSpeed).toBe(100);
    expect(fixture.touches()).toBe(1);
  }
});

test("Q3 retains seeded planes after progress and nudges velocity on a duplicate ground plane", () => {
  const normal = { x: 0, y: 0, z: 1 }, fixture = slideFixture({ x: 5, y: 0, z: 0 }, normal);
  const context = { ...fixture.context, groundNormal: normal };
  expect(slideMove(context, false)).toBe(true);
  expect(context.state.velocity).toEqual({ x: 5, y: 0, z: 1 });
  expect(fixture.traces()).toBe(2);
});

test("Q3 triple-plane stop bypasses timed velocity restoration", () => {
  const fixture = slideFixture({ x: 0, y: -1, z: 0 }, { x: -0.5, y: Math.fround(Math.sqrt(0.75)), z: 0 });
  const context = { ...fixture.context, groundNormal: { x: 1, y: 0, z: 0 } };
  context.state.pmTime = 10;
  expect(slideMove(context, false)).toBe(true);
  expect(context.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  expect(fixture.traces()).toBe(1);
});

test("Q3 records a touch before rejecting a missing collision plane", () => {
  const fixture = slideFixture({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
  const context: SlideMoveContext = { ...fixture.context, trace: (...args) => ({ ...fixture.context.trace(...args), contact: { kind: "none" } }) };
  expect(() => slideMove(context, false)).toThrow("Movement impact trace requires a collision plane");
  expect(fixture.touches()).toBe(1);
});
