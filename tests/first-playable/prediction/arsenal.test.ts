import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorCommand } from "../../../src/contracts/session.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { encodeUnifiedActorCommand, decodeUnifiedActorCommand } from "../../../src/network/common/commands.ts";
import type { UnifiedCommandReceiver } from "../../../src/network/common/commands.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createSimulationPredictionHost, SelectedMovementPrediction } from "../../../src/app/bootstrap/simulation/prediction.ts";
import { itemList } from "../../../src/content/q3/base/shared/items.ts";
import { EntityEvent, Holdable, statSchema } from "../../../src/content/q3/base/shared/definitions.ts";

function move(kind: "q1" | "q2" | "q3", time: number): UserCommand {
  const common = { forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 7 };
  if (kind === "q3") return { kind: "q3", serverTimeMilliseconds: time, angleWords: [0, 0, 0],
    buttons: 0, weapon: 2, forwardMove: 0, rightMove: 0, upMove: 0 };
  return kind === "q1" ? { ...common, kind: "q1-netquake", acknowledgedServerTimeSeconds: time / 1000, viewAngles: { x: 0, y: 0, z: 0 } }
    : { ...common, kind: "q2-classic", milliseconds: 50, angleShorts: [0, 0, 0], lightLevel: 128 };
}

test("unified commands round-trip each raw dialect and independent intent through an authenticated actor binding", () => {
  const identity = createIdentityOwner("unified-arsenal"), actor = identity.actor(17, 3), client = identity.client(2, 1);
  const commands: readonly UserCommand[] = [move("q1", 12.345678901), move("q2", 50),
    { kind: "q1-quakeworld", milliseconds: 53, angles: { x: -0, y: 47.125, z: 0 }, forwardMove: 320, sideMove: -7, upMove: 0, buttons: 2, impulse: 8 },
    { kind: "q2-rerelease", milliseconds: 25, angles: { x: 12.000000001, y: -3, z: 0 }, forwardMove: 199.999999, sideMove: 0, buttons: 8, serverFrame: 105 },
    { kind: "q3", serverTimeMilliseconds: 500, angleWords: [17, 65000, 0], buttons: 5, weapon: 2, forwardMove: 127, rightMove: -127, upMove: 0 }];
  for (const command of commands) for (const withIntent of [false, true]) {
    const input: ActorCommand = { actor, source: { kind: "remote-client", client }, sequence: 4294967300, command,
      ...(withIntent ? { arsenal: { provider: "q3:official", weapon: "q3:weapon/gauntlet", useHoldable: true } } : {}) };
    const receiver: UnifiedCommandReceiver = { source: input.source,
      resolveControlledActor: (slot, generation) => slot === actor.slot && generation === actor.generation ? { actor, movement: command.kind, arsenal: "q3:official" } : null };
    const bytes = encodeUnifiedActorCommand(input);
    expect(decodeUnifiedActorCommand(bytes, receiver)).toEqual(input);
    expect(() => decodeUnifiedActorCommand(bytes, { ...receiver, resolveControlledActor: () => null })).toThrow("not controlled");
    if (withIntent) expect(() => decodeUnifiedActorCommand(bytes, { ...receiver,
      resolveControlledActor: () => ({ actor, movement: command.kind, arsenal: "q2:official" }) })).toThrow("another provider");
    expect(() => decodeUnifiedActorCommand(bytes.subarray(0, bytes.length - 1), receiver)).toThrow();
  }
});

for (const family of ["q1", "q2", "q3"]) test(`Q3 gauntlet selection and medkit intent use ${family} movement in authority and private prediction`, async () => {
  if (family !== "q1" && family !== "q2" && family !== "q3") throw new Error("Unexpected movement family");
  const launch = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", family, "--character", "q3", "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Expected launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`mixed-arsenal-${family}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
    const player = simulation.movementPlayer(admission.actor), source = simulation.q3Source();
    if (player === null || source === null) throw new Error("Missing admitted source player");
    for (let index = 0; index < 3; index++) simulation.step({ elapsedMilliseconds: 50, commands: [{ actor: admission.actor,
      source: { kind: "local-seat", client, seat }, sequence: index, command: move(family, (index + 1) * 50) }] });
    const ps = source.records.byActor(admission.actor)?.client?.ps;
    if (ps === undefined) throw new Error("Missing raw player state");
    const medkit = itemList(ps.product).findIndex(item => item.className === "holdable_medkit");
    if (medkit < 0) throw new Error("No source medkit");
    simulation.combat.setHealth(player.actor, 75);
    ps.stats.set(statSchema(ps.product).holdableItem, medkit);
    const adapter = createSimulationPredictionHost(simulation, admission.actor, seat), initial = adapter.options.initial;
    const prediction = new SelectedMovementPrediction(adapter.options.movement, initial);
    const commands: ActorCommand[] = Array.from({ length: 14 }, (_, index) => ({ actor: admission.actor,
      source: { kind: "local-seat", seat, client }, sequence: index + 3, command: move(family, initial.commandTimeMilliseconds + (index + 1) * 50),
      arsenal: { provider: player.arsenal.provider, weapon: index >= 10 ? null : "q3:weapon/gauntlet", useHoldable: index >= 12 } }));
    for (const [index, input] of commands.entries()) prediction.submit({ sequence: input.sequence,
      timeMilliseconds: initial.commandTimeMilliseconds + (index + 1) * 50, command: input.command,
      ...(input.arsenal === undefined ? {} : { arsenal: input.arsenal }) });
    const predicted = prediction.replay();
    expect(predicted.player.arsenal.activeWeapon).toBe("q3:weapon/gauntlet");
    expect(predicted.player.q3Arsenal?.holdableItem).toBe(0);
    expect(predicted.effects.filter(value => value.effect.kind === "event" && value.effect.value.event === EntityEvent.EV_USE_ITEM0 + Holdable.HI_MEDKIT)).toHaveLength(1);
    expect(simulation.playerUi(admission.actor).activeWeapon).toBe("q3:weapon/machinegun");
    expect(simulation.playerUi(admission.actor).health).toBe(75);
    expect(ps.stats.get(statSchema(ps.product).holdableItem)).toBe(medkit);
    expect(prediction.replay()).toEqual(predicted);
    const privatePlayer = ps.copy();
    for (const [index, input] of commands.entries()) {
      const time = initial.commandTimeMilliseconds + (index + 1) * 50, command = adapter.submit(input, time);
      expect(command.buttons & 4).toBe(input.arsenal?.useHoldable === true ? 4 : 0);
      expect(input.command.buttons).toBe(0);
      const rounded = family === "q3" ? { ...command, serverTime: Math.ceil(command.serverTime / 8) * 8 } : command;
      adapter.movePlayer(privatePlayer, rounded, { originalServerTime: command.serverTime, trace: (start, end, bounds, _skip, mask) => {
        if (family !== "q3") throw new Error("Foreign movement must query its selected scene policy");
        const trace = simulation.scene.trace({ start, end, shape: { kind: "box", bounds }, target: { kind: "world" },
          passActor: admission.actor, numeric: player.profile.numeric, policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true } });
        if (trace.kind !== "q3") throw new Error("Unexpected trace dialect");
        return { fraction: trace.fraction, end: trace.end, solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear",
          contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
          entityNum: trace.hit.kind === "none" ? 1023 : trace.hit.kind === "world" ? 1022 : source.records.byActor(trace.hit.actor)?.slot ?? 1023 };
      }, pointContents: point => {
        if (family !== "q3") throw new Error("Foreign movement must query its selected contents policy");
        const result = simulation.scene.pointContents({ point, target: { kind: "world" }, numeric: player.profile.numeric,
          passActor: admission.actor, policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
        if (result.kind !== "q3") throw new Error("Unexpected contents dialect"); return result.contents;
      },
        fixedMsec: 8, traceMask: 0x2010001, noFootsteps: false, gauntletHit: false });
      expect(privatePlayer.commandTime).toBe(rounded.serverTime);
      if (index >= 10 && index < 12) {
        expect(privatePlayer.weapon).toBe(1);
        expect(privatePlayer.weaponState).toBe(0);
        expect(command.weapon).toBe(2);
      }
    }
    expect(privatePlayer.weapon).toBe(1);
    expect(privatePlayer.stats.get(statSchema(ps.product).holdableItem)).toBe(0);
    expect(simulation.playerUi(admission.actor).health).toBe(75);
    for (const input of commands) simulation.step({ elapsedMilliseconds: 50, commands: [input] });
    expect(simulation.playerUi(admission.actor).activeWeapon).toBe(predicted.player.arsenal.activeWeapon);
    expect(ps.stats.get(statSchema(ps.product).holdableItem)).toBe(0);
    expect(simulation.playerUi(admission.actor).health).toBeGreaterThan(75);
    expect(predicted.player.environment.health).toBe(75);
    const invalid = new SelectedMovementPrediction(adapter.options.movement, initial), input = commands[0];
    if (input === undefined) throw new Error("No command");
    invalid.submit({ sequence: input.sequence, timeMilliseconds: initial.commandTimeMilliseconds + 50, command: input.command,
      arsenal: { provider: "q1:official", weapon: "q3:weapon/gauntlet", useHoldable: false } });
    expect(() => invalid.replay()).toThrow("different provider");
  } finally { simulation.close(); await content.close(); }
}, 30000);
