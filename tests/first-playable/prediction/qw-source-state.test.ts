import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { QwPlayerState, QwUserCommand } from "../../../src/contracts/protocol.ts";
import type { MovementPredictionOptions, MovementPredictionSnapshot } from "../../../src/app/bootstrap/simulation/prediction/types.ts";
import { QuakeWorldPrediction, qwPredictionSnapshot } from "../../../src/app/bootstrap/simulation/prediction/qw-source-state.ts";

const zero = { x: 0, y: 0, z: 0 };
const idle: QwUserCommand = { kind: "q1-quakeworld", milliseconds: 50, angles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };

test("QW native snapshots replay turned commands, held jumps and acknowledged continuation through shared movement", async () => {
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner("qw-source-prediction");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    const admission = simulation.admitPlayer(identity.client(0, 0)), player = simulation.movementPlayer(admission.actor);
    if (player === null || player.state.kind !== "q1-netquake" || player.profile.kind !== "q1-netquake") throw new Error("Missing original Q1 actor");
    const initial: MovementPredictionSnapshot = { sequence: -1, commandTimeMilliseconds: 0,
      state: { kind: "q1-quakeworld", origin: player.state.origin, velocity: zero, angles: zero, oldButtons: 0, waterJumpTimeSeconds: 0,
        dead: false, spectator: 0, ground: { kind: "none" } }, arsenal: player.arsenal, animation: player.animation,
      environment: { health: 100, gravityMultiplier: 1, flight: false, haste: false, invulnerable: false }, bounds: player.standingBounds,
      viewAngles: zero, viewHeight: 22, viewOffset: { x: 0, y: 0, z: 22 }, contact: null, q3Arsenal: null };
    const options: MovementPredictionOptions = { actor: player.actor, seat: identity.seat(0), recipe: content.recipe, profile: player.profile,
      standingBounds: player.standingBounds, standingViewHeight: 22, scene: simulation.scene, isBrush: hit => hit.kind === "world" };
    const variables = { ...player.profile.parameters, airAccelerate: 0.7 };
    const before = simulation.bodies.read(admission.actor), inventory = simulation.inventory.entries(admission.actor);
    const settle = new QuakeWorldPrediction(options, initial, variables); settle.sent(0, idle, 50);
    const grounded = settle.replay().player;
    if (grounded.state.kind !== "q1-quakeworld") throw new Error("Lost QW state");
    expect(grounded.state.ground.kind).toBe("world");
    const fast = new QuakeWorldPrediction(options, grounded, variables), slow = new QuakeWorldPrediction({ ...options, seat: identity.seat(1) }, grounded, { ...variables, maxSpeed: 64 });
    const turned = { ...idle, angles: { x: 0, y: 90, z: 0 }, forwardMove: 320 };
    fast.sent(1, turned, 100); slow.sent(1, turned, 100);
    const moved = fast.replay().player.state, limited = slow.replay().player.state;
    if (moved.kind !== "q1-quakeworld" || limited.kind !== "q1-quakeworld") throw new Error("Wrong movement");
    expect(moved.origin.x).toBeCloseTo(grounded.state.origin.x, 4);
    expect(moved.origin.y).toBeGreaterThan(grounded.state.origin.y); expect(moved.velocity.y).toBeGreaterThan(limited.velocity.y);
    expect(slow.replay().player.sequence).toBe(1);
    const groundedOrigin = grounded.state.origin;
    const wire = (origin = groundedOrigin, velocity = zero, flags = 0): QwPlayerState => ({ number: 0, flags, origin, velocity,
      modelIndex: 1, frame: 0, skin: 0, effects: 0, weaponFrame: 0, milliseconds: 200, command: idle });
    const jump = new QuakeWorldPrediction(options, grounded, variables);
    jump.sent(10, { ...idle, buttons: 3 }, 500);
    const airborne = jump.replay().player;
    if (airborne.state.kind !== "q1-quakeworld") throw new Error("Lost jump state");
    expect(airborne.state.origin.z).toBeGreaterThan(grounded.state.origin.z); expect(airborne.state.oldButtons).toBe(3);
    jump.acknowledged(10, 900); jump.receive(grounded, wire(), variables, { health: 100, spectator: 0 });
    expect(jump.replay().player.commandTimeMilliseconds).toBe(500);
    jump.sent(11, { ...idle, buttons: 2 }, 950);
    const held = jump.replay().player.state;
    if (held.kind !== "q1-quakeworld") throw new Error("Lost held jump");
    expect(held.origin.z).toBeCloseTo(grounded.state.origin.z, 4); expect(held.velocity.z).toBe(0);
    jump.sent(12, idle, 1000); jump.sent(13, { ...idle, buttons: 2 }, 1050);
    const released = jump.replay().player.state;
    if (released.kind !== "q1-quakeworld") throw new Error("Lost released jump");
    expect(released.origin.z).toBeGreaterThan(grounded.state.origin.z);
    jump.acknowledged(13, 1100); jump.receive(grounded, wire(undefined, undefined, 512), variables, { health: 0, spectator: 0 });
    jump.sent(14, { ...turned, buttons: 2 }, 1150);
    const dead = jump.replay().player;
    if (dead.state.kind !== "q1-quakeworld") throw new Error("Lost dead state");
    expect(dead.state.dead).toBe(true); expect(dead.viewHeight).toBe(-16); expect(dead.state.origin).toEqual(grounded.state.origin);
    expect(() => jump.receive(grounded, wire(), variables, { health: 100, spectator: 1 })).toThrow("spectators");
    const continuation = { ...grounded, state: { ...grounded.state, origin: { ...grounded.state.origin, z: grounded.state.origin.z + 100 },
      velocity: { x: 0, y: 0, z: 200 }, waterJumpTimeSeconds: 1 } };
    const water = new QuakeWorldPrediction(options, continuation, variables);
    water.sent(1, { ...idle, buttons: 3 }, 100); const first = water.replay().player;
    water.sent(2, { ...idle, buttons: 2 }, 150); const second = water.replay().player;
    if (first.state.kind !== "q1-quakeworld" || second.state.kind !== "q1-quakeworld") throw new Error("Lost water jump");
    water.acknowledged(1, 200); water.receive(grounded, wire(first.state.origin, first.state.velocity), variables, { health: 100, spectator: 0 });
    const corrected = water.replay().player;
    if (corrected.state.kind !== "q1-quakeworld") throw new Error("Lost corrected continuation");
    expect(corrected.state.waterJumpTimeSeconds).toBeCloseTo(second.state.waterJumpTimeSeconds, 6);
    expect(corrected.state.origin).toEqual(second.state.origin);
    expect(corrected.state.oldButtons).toBe(2); expect(corrected.sequence).toBe(2);
    expect(qwPredictionSnapshot(grounded, wire(undefined, undefined, 1024), { health: 1, spectator: 0 }, first, 1, 100).viewHeight).toBe(8);
    const exhausted = new QuakeWorldPrediction(options, grounded, variables);
    for (let sequence = 1; sequence <= 63; sequence++) exhausted.sent(sequence, { ...idle, milliseconds: 0 }, 100 + sequence);
    expect(exhausted.replay().status).toBe("history-exhausted");
    exhausted.acknowledged(63, 250); exhausted.receive(grounded, wire(), variables, { health: 100, spectator: 0 });
    expect(exhausted.replay().status).toBe("unchanged");
    exhausted.sent(64, idle, 300); expect(exhausted.replay().status).toBe("predicted");
    expect(simulation.bodies.read(admission.actor)).toEqual(before); expect(simulation.inventory.entries(admission.actor)).toEqual(inventory);
  } finally { simulation.close(); await content.close(); }
}, 15000);
