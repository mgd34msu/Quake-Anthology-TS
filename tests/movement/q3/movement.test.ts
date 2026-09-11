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
  } finally { archive.close(); }
});
