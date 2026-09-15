import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { QwMovementInput, MovementServices } from "../../../src/contracts/movement.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { createNumericOperations, Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { SeatInput, registerInputCommands } from "../../../src/input/seat.ts";
import { InputCommandBuilder } from "../../../src/input/user-command.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { parseEntities } from "../../../src/core/common-parse.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { createPlayerMovementProvider } from "../../../src/app/bootstrap/simulation/player-movement.ts";
import { Q2RereleaseMovementContext } from "../../../src/movement/q2/index.ts";
import { Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS } from "../../../src/movement/q3/index.ts";

const zero = { x: 0, y: 0, z: 0 };
const identity = createIdentityOwner("mixed-qw-controls"), seat = identity.seat(0);
const actor = identity.ownedActor(identity.actor(1, 0), "q3:character");
function command(code: number, text: string) {
  const context = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
  const commands = new CommandBuffer({ dialect: "q1-quakeworld", context });
  const input = new SeatInput({ seat, dialect: "q1-quakeworld", context, commands, uiEvent: () => false });
  const dispose = registerInputCommands(commands, () => input);
  input.bind({ input: { kind: "key", code }, target: { kind: "command", text } });
  input.input({ seat, kind: "key", code, down: true, repeat: false, timeMilliseconds: 100 }); commands.execute();
  const result = new InputCommandBuilder("q1-quakeworld").build(input.sample(120, 20), { kind: "q1-quakeworld" });
  dispose();
  if (result.kind !== "q1-quakeworld") throw new Error("Wrong command dialect");
  return result;
}
async function fixture() {
  const archive = await openArchive(resolve(import.meta.dir, "../../../../qfiles/q2/baseq2/pak0.pak"));
  try {
    const entry = archive.findEntries("maps/base1.bsp")[0]; if (entry === undefined) throw new Error("Missing base1");
    const world = decodeQ2Map(await archive.readEntry(entry)), scene = createSceneQueries(world);
    const spawn = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
    const [x, y, z] = spawn?.get("origin")?.split(/\s+/u).map(Number) ?? [];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Missing spawn");
    const origin = { x, y, z: z + 16 };
    const input: QwMovementInput = { kind: "q1-quakeworld", actor, commandSequence: 0, execution: "authoritative",
      frame: { frame: 0, time: { kind: "milliseconds", value: 100 }, elapsed: { kind: "milliseconds", value: 20 }, phase: "client-command" },
      shape: { kind: "box", bounds: Q3_SOURCE_STANDING_BOUNDS },
      profile: { kind: "q1-quakeworld", id: "q1:movement", numeric: Q1_DONOR_PROFILE,
        clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 },
        parameters: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10,
          airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } },
      state: { kind: "q1-quakeworld", origin, velocity: zero, angles: zero, oldButtons: 0, waterJumpTimeSeconds: 0, dead: false, spectator: 0, ground: { kind: "none" } },
      command: { kind: "q1-quakeworld", milliseconds: 20, angles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
      environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 },
      arsenal: { provider: "q2:weapons", activeWeapon: null, state: { kind: "q2", gunFrame: 0, state: 0,
        pendingWeapon: null, machinegunShots: 0, grenadeTime: { kind: "seconds", value: 0 }, grenadeBlewUp: false }, ammo: [] },
      animation: { provider: "q3:character", state: { kind: "q3", legs: 22, torso: 11, legsTimerMilliseconds: 0, torsoTimerMilliseconds: 0 } } };
    const services: MovementServices = { scene, numeric: createNumericOperations(Q1_DONOR_PROFILE),
      touch: (_contact, state) => ({ kind: "continue", state }), weaponStep: input => ({ arsenal: input.arsenal, animation: input.animation, effects: [] }),
      animationStep: input => ({ animation: input.animation, effects: [] }) };
    const player = { profile: input.profile, character: "q3", standingBounds: Q3_SOURCE_STANDING_BOUNDS, viewHeight: 26, sourceMovement: null } satisfies Parameters<typeof createPlayerMovementProvider>[0];
    const provider = (nativeQuakeWorld: boolean, publishPosture?: (bounds: Bounds, viewHeight: number) => void) => createPlayerMovementProvider(player, { nativeQuakeWorld,
      ...(publishPosture === undefined ? {} : { publishPosture }), q1: { viewHeight: 26 }, q2: new Q2RereleaseMovementContext(), q3: {
      firing: () => false, animation: (_request, context) => ({ animation: context.animation, effects: [] }),
      torso: context => ({ animation: context.animation, effects: [] }),
      weapon: context => ({ arsenal: context.arsenal, animation: context.animation, effects: [], movementFlags: context.motion.pmFlags }),
    } });
    return { input, services, provider };
  } finally { archive.close(); }
}

test("saved Q2 Space/Ctrl controls jump and crouch Q3 character bounds with QW movement on base1", async () => {
  const { input, services, provider } = await fixture(), shared = provider(false), native = provider(true);
  if (shared.kind !== "q1-quakeworld" || native.kind !== "q1-quakeworld") throw new Error("Wrong movement provider");
  let current = input;
  for (let index = 0; index < 40; index++) {
    const result = shared.move(current, services); if (result.status !== "active") throw new Error("Player removed");
    current = { ...current, state: result.state, shape: { kind: "box", bounds: result.bounds } };
  }
  expect(current.state.ground.kind).toBe("world");
  const space = command(KeyCode.Space, "+moveup"), ctrl = command(KeyCode.Control, "+movedown");
  expect(space.buttons).toBe(0); expect(space.upMove).toBeGreaterThan(0); expect(ctrl.upMove).toBeLessThan(0);
  const jumped = shared.move({ ...current, command: space }, services), nativeUp = native.move({ ...current, command: space }, services);
  if (jumped.status !== "active" || nativeUp.status !== "active") throw new Error("Player removed");
  expect(jumped.state.velocity.z).toBeGreaterThan(0); expect(jumped.state.origin.z).toBeGreaterThan(current.state.origin.z);
  expect(nativeUp.state.origin.z).toBe(current.state.origin.z);
  const published: { bounds: Bounds; viewHeight: number }[] = [];
  const postureProvider = provider(false, (bounds, viewHeight) => { published.push({ bounds, viewHeight }); });
  if (postureProvider.kind !== "q1-quakeworld") throw new Error("Wrong posture provider");
  const locomotion: string[] = [];
  const crouched = postureProvider.move({ ...current, command: ctrl }, { ...services, animationStep: request => {
    locomotion.push(request.locomotion); return services.animationStep(request);
  } });
  if (crouched.status !== "active") throw new Error("Player removed");
  expect(crouched.bounds).toEqual(Q3_SOURCE_POSTURES.crouched.bounds); expect(crouched.viewHeight).toBe(12);
  expect(published).toEqual([{ bounds: Q3_SOURCE_POSTURES.crouched.bounds, viewHeight: 12 }]);
  expect(locomotion).toEqual(["crouch"]);
  const predicted = shared.move({ ...current, command: ctrl, execution: "prediction" }, services);
  expect(predicted).toEqual(crouched);
  const standing = shared.move({ ...current, state: crouched.state, shape: { kind: "box", bounds: crouched.bounds } }, services);
  if (standing.status !== "active") throw new Error("Player removed");
  expect(standing.bounds).toEqual(Q3_SOURCE_STANDING_BOUNDS); expect(standing.viewHeight).toBe(26);
  let lowCeiling: Vec3 | null = null;
  for (let height = 4; height <= 4096; height += 4) {
    const origin = { ...current.state.origin, z: current.state.origin.z + height };
    const trace = (bounds: typeof Q3_SOURCE_STANDING_BOUNDS) => services.scene.trace({ start: origin, end: origin,
      shape: { kind: "box", bounds }, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null },
      numeric: input.profile.numeric, passActor: actor.id });
    const upright = trace(Q3_SOURCE_STANDING_BOUNDS), ducked = trace(Q3_SOURCE_POSTURES.crouched.bounds);
    if ((upright.startSolid || upright.allSolid) && !ducked.startSolid && !ducked.allSolid) { lowCeiling = origin; break; }
  }
  if (lowCeiling === null) throw new Error("base1 has no overhead stance clearance witness");
  const underCeiling = { ...current, state: { ...current.state, origin: lowCeiling },
    shape: { kind: "box", bounds: crouched.bounds }, command: { ...current.command, milliseconds: 0 } } satisfies QwMovementInput;
  const blocked = shared.move(underCeiling, services);
  if (blocked.status !== "active") throw new Error("Player removed");
  expect(blocked.bounds).toEqual(Q3_SOURCE_POSTURES.crouched.bounds); expect(blocked.viewHeight).toBe(12);
  expect(shared.move({ ...underCeiling, execution: "prediction" }, services)).toEqual(blocked);
  const nativeDown = native.move({ ...current, command: ctrl }, services);
  if (nativeDown.status !== "active") throw new Error("Player removed");
  expect(nativeDown.bounds).toEqual(Q3_SOURCE_STANDING_BOUNDS); expect(nativeDown.viewHeight).toBe(26);
});
