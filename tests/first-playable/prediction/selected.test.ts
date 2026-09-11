import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { GameFamily } from "../../../src/contracts/content.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { movementOrigin } from "../../../src/app/bootstrap/simulation/players.ts";
import { copyPredictionSnapshot, createSimulationPredictionHost, predictMovementSequence, SelectedMovementPrediction } from "../../../src/app/bootstrap/simulation/prediction.ts";
import type { MovementPredictionSnapshot, MovementPredictionOptions, PredictionCommand } from "../../../src/app/bootstrap/simulation/prediction.ts";

function command(family: GameFamily, time: number, jump: boolean, attack: boolean): UserCommand {
  if (family === "q1") return { kind: "q1-netquake", acknowledgedServerTimeSeconds: time / 1000, viewAngles: { x: 0, y: 0, z: 0 },
    forwardMove: 320, sideMove: 0, upMove: 0, buttons: (jump ? 2 : 0) | (attack ? 1 : 0), impulse: 0 };
  if (family === "q2") return { kind: "q2-classic", milliseconds: 50, angleShorts: [0, 0, 0],
    forwardMove: 200, sideMove: 0, upMove: jump ? 200 : 0, buttons: attack ? 1 : 0, impulse: 0, lightLevel: 0 };
  return { kind: "q3", serverTimeMilliseconds: time, angleWords: [0, 0, 0], forwardMove: 127, rightMove: 0, upMove: jump ? 127 : 0, buttons: attack ? 1 : 0, weapon: 2 };
}

const maps = [{ product: "q1-classic-id1", map: "e1m1" }, { product: "q2-classic-baseq2", map: "base1" }, { product: "q3-baseq3", map: "q3dm1" }];
const families: readonly GameFamily[] = ["q1", "q2", "q3"];
for (const map of maps) for (const family of families) test(`${map.map}: private ${family} replay moves without committing actors, inventory or events`, async () => {
  const launch = parseApplicationCommand(["--game", map.product, "--map", map.map, "--movement", family,
    "--character", map.product === "q3-baseq3" ? "q3" : family, "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Expected launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`prediction-${map.map}-${family}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
    const player = simulation.movementPlayer(admission.actor);
    if (player === null) throw new Error("No selected player");
    const adapter = simulation.q3Source() === null ? null : createSimulationPredictionHost(simulation, admission.actor, seat);
    const initial: MovementPredictionSnapshot = adapter?.options.initial ?? copyPredictionSnapshot({ sequence: -1, commandTimeMilliseconds: 0,
      state: player.state, arsenal: player.arsenal, animation: player.animation, bounds: player.bounds,
      environment: { health: simulation.playerUi(admission.actor).health, flight: false, haste: false, invulnerable: false, gravityMultiplier: player.gravityMultiplier },
      viewAngles: player.viewAngles, viewHeight: player.viewHeight, viewOffset: { x: 0, y: 0, z: player.viewHeight },
      contact: { ground: player.ground, waterLevel: player.waterLevel, waterType: player.waterType }, q3Arsenal: null });
    const options: MovementPredictionOptions = adapter?.options.movement ?? { actor: player.actor, seat, recipe: content.recipe,
      profile: player.profile, standingBounds: player.standingBounds, standingViewHeight: player.viewHeight,
      scene: simulation.scene, isBrush: hit => hit.kind === "world" };
    const captureAuthority = () => ({ actors: simulation.actors.checkpoint(),
      bodies: simulation.actors.observations().map(actor => ({ actor: actor.id, body: simulation.bodies.read(actor.id), links: simulation.bodies.linkState(actor.id),
        inventory: simulation.inventory.entries(actor.id), combat: simulation.combat.read(actor.id) })),
      events: simulation.events.capture(), random: simulation.random.checkpoint(), source: simulation.q3Source()?.sourceState() });
    const before = captureAuthority(), original = copyPredictionSnapshot(initial);
    const commands: PredictionCommand[] = Array.from({ length: 12 }, (_, index) => {
      const time = initial.commandTimeMilliseconds + (index + 1) * 50;
      return { sequence: index, timeMilliseconds: time, command: command(family, time, index >= 4, index >= 2) };
    });
    const predictor = new SelectedMovementPrediction(options, initial), otherSeat = new SelectedMovementPrediction({ ...options, seat: identity.seat(1) }, initial);
    for (const entry of commands) predictor.submit(entry);
    const result = predictor.replay();
    expect(result.status).toBe("predicted");
    expect(movementOrigin(result.player.state)).not.toEqual(movementOrigin(initial.state));
    expect(predictor.replay()).toEqual(result);
    expect(otherSeat.replay().player).toEqual(initial);
    expect(initial).toEqual(original);
    const first = predictMovementSequence(options, initial, commands.slice(0, 6));
    const second = predictMovementSequence(options, first.player, commands.slice(6));
    expect(second.player).toEqual(result.player);
    expect(first.seconds + second.seconds).toBeCloseTo(0.6);
    expect(first.trajectory).toHaveLength(7);
    predictor.receive(first.player);
    expect(predictor.replay().player).toEqual(result.player);
    if (initial.state.kind === "q1-netquake" && options.profile.kind === "q1-netquake") {
      const qw: MovementPredictionSnapshot = { ...initial, state: { kind: "q1-quakeworld", origin: initial.state.origin, velocity: initial.state.velocity,
        angles: initial.state.viewAngles, oldButtons: 0, waterJumpTimeSeconds: 0, dead: false, spectator: 0, ground: initial.state.ground } };
      const selected: MovementPredictionOptions = { ...options, profile: { ...options.profile, kind: "q1-quakeworld",
        clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 }, parameters: { ...options.profile.parameters, airAccelerate: 0.7 } } };
      const qwCommand = { kind: "q1-quakeworld", milliseconds: 53, angles: { x: 0, y: 0, z: 0 },
        forwardMove: 320, sideMove: 0, upMove: 0, buttons: 2, impulse: 0 } satisfies UserCommand;
      const long = predictMovementSequence(selected, qw, [{ sequence: 0, timeMilliseconds: qw.commandTimeMilliseconds + 53, command: qwCommand }]);
      const split = predictMovementSequence(selected, qw, [1, 2].map(index => ({ sequence: index,
        timeMilliseconds: qw.commandTimeMilliseconds + index * 26, command: { ...qwCommand, milliseconds: 26 } })));
      expect(long.player.state).toEqual(split.player.state);
      expect(long.seconds).toBeCloseTo(0.053);
    }
    if (initial.state.kind === "q2-classic" && options.profile.kind === "q2-classic") {
      const origin = movementOrigin(initial.state);
      const rerelease: MovementPredictionSnapshot = { ...initial, state: { kind: "q2-rerelease", type: 0,
        origin: { ...origin, x: origin.x + 0.03125 }, velocity: { x: 0, y: 0, z: 0 }, flags: 0, timeMilliseconds: 0,
        gravity: initial.state.gravity, deltaAngles: { x: 0, y: 0, z: 0 }, viewHeight: initial.viewHeight } };
      const selected: MovementPredictionOptions = { ...options, profile: { kind: "q2-rerelease", id: options.profile.id,
        numeric: options.profile.numeric, clock: { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" }, airAccelerate: 0, n64Physics: false } };
      const rrCommands: PredictionCommand[] = Array.from({ length: 4 }, (_, index) => ({ sequence: index,
        timeMilliseconds: rerelease.commandTimeMilliseconds + (index + 1) * 16,
        command: { kind: "q2-rerelease", milliseconds: 16, angles: { x: 0, y: 0, z: 0 }, forwardMove: 200, sideMove: 0, buttons: 0, serverFrame: 1 } }));
      const rr = new SelectedMovementPrediction(selected, rerelease);
      for (const entry of rrCommands) rr.submit(entry);
      const moved = rr.replay();
      expect(moved.player.state.kind).toBe("q2-rerelease");
      expect(Number.isInteger(movementOrigin(moved.player.state).x * 8)).toBe(false);
      expect(rr.replay()).toEqual(moved);
      if (rerelease.state.kind !== "q2-rerelease") throw new Error("Lost float movement state");
      rr.receive({ ...rerelease, state: { ...rerelease.state, flags: 64 } });
      expect(rr.replay().status).toBe("disabled");
      expect(movementOrigin(rr.replay().player.state)).toEqual(rerelease.state.origin);
    }
    expect(captureAuthority()).toEqual(before);
    if (adapter !== null) {
      const source = simulation.q3Source();
      if (source === null) throw new Error("Lost source");
      const raw = source.sourceState().clients.find(value => value.actor.equals(admission.actor))?.state;
      if (raw === undefined) throw new Error("No raw player state");
      const privateState = raw.copy();
      for (const entry of commands) {
        const wire = adapter.submit({ actor: admission.actor, source: { kind: "local-seat", seat, client }, sequence: entry.sequence, command: entry.command }, entry.timeMilliseconds);
        adapter.movePlayer(privateState, wire, { trace: (start, end, bounds, _skip, mask) => {
          const trace = simulation.scene.trace({ start, end, shape: { kind: "box", bounds }, target: { kind: "world" },
            passActor: admission.actor, numeric: options.profile.numeric, policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true } });
          if (trace.kind !== "q3") throw new Error("Unexpected trace dialect");
          return { fraction: trace.fraction, end: trace.end, solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear",
            contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
            entityNum: trace.hit.kind === "none" ? 1023 : trace.hit.kind === "world" ? 1022 : source.records.byActor(trace.hit.actor)?.slot ?? 1023 };
        }, pointContents: point => {
          const result = simulation.scene.pointContents({ point, target: { kind: "world" }, numeric: options.profile.numeric,
            passActor: admission.actor, policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
          if (result.kind !== "q3") throw new Error("Unexpected contents dialect"); return result.contents;
        }, traceMask: 0x2010001, fixedMsec: null, noFootsteps: false, gauntletHit: false });
      }
      expect(privateState.origin).toEqual(movementOrigin(result.player.state));
      if (family === "q3") {
        expect(privateState.ammo.get(2)).toBeLessThan(raw.ammo.get(2));
        expect(privateState.eventSequence).toBeGreaterThan(raw.eventSequence);
      }
      expect(raw.origin).toEqual(movementOrigin(initial.state));
      expect(captureAuthority()).toEqual(before);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
