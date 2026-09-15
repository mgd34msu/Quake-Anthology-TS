import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import { expect, test } from "bun:test";
import { ApplicationQ3Source } from "../../src/app/bootstrap/q3-client/source.ts";
import type { Q3SourcePresentationState } from "../../src/app/bootstrap/simulation/q3/presentation.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ActorId } from "../../src/contracts/identity.ts";
import type { ActorCommand } from "../../src/contracts/session.ts";
import { createPlayerState } from "../../src/content/q3/base/shared/player-state.ts";

function state(actor: ActorId, time: number, value = "old", slot = 0): Q3SourcePresentationState {
  return { product: "missionpack", time, clients: [{ actor, slot, state: createPlayerState("missionpack") }],
    entities: [], configstrings: [{ index: 5, value }] };
}
function command(actor: ActorId, sequence: number): ActorCommand {
  return { actor, sequence, source: { kind: "bot", provider: "q3:test" }, command: { kind: "q3", serverTimeMilliseconds: sequence * 100,
    angleWords: [0, 0, 0], buttons: 1, weapon: 2, forwardMove: 127, rightMove: 0, upMove: 0 } };
}

test("local restart retains transport rings and publishes the new epoch only after rebind and settle", () => {
  const owner = createIdentityOwner("local-round"), old = owner.actor(0, 1), next = owner.actor(0, 2), third = owner.actor(0, 3);
  let currentActor = old;
  const source = new ApplicationQ3Source(old, state(old, 100), () => ({ entities: [], areaMask: new Uint8Array(0) }), () => currentActor);
  source.receive(state(old, 200), [], [command(old, 1)]);
  const before = source.current(), history = source.commands, oldSnapshot = source.read(before.number);
  source.beginRoundRestart(4, { ...state(next, 500, "new"), clients: [] });
  expect(source.current()).toEqual(before); expect(source.read(before.number)).toBe(oldSnapshot);
  expect(source.commands).toBe(history); expect(source.commands.currentNumber).toBe(1);
  expect(source.getServerCommand(1)).toEqual(["cs", "5", "new"]);
  expect(source.getServerCommand(2)).toEqual(["map_restart"]); expect(source.getServerCommand(3)).toBeNull();
  expect(() => source.beginRoundRestart(4, state(next, 500))).toThrow("pending");
  expect(() => source.actorAt(0)).toThrow("suspended");
  expect(() => source.receive(state(next, 500), [], [])).toThrow("rebinding");
  currentActor = next; source.rebindRound(next, state(next, 500, "new"));
  expect(source.current()).toEqual(before); expect(source.actor).toBe(next); expect(source.actorAt(0)).toBe(next);
  source.receive(state(next, 600, "new"), [], [command(old, 2), command(next, 3)]);
  expect(source.current()).toEqual({ number: before.number + 1, serverTime: 600 });
  const after = source.read(source.current().number);
  expect(after?.flags).toBe(4); expect(after?.serverCommandNumber).toBe(2);
  expect(after?.deltaNumber).toBe(before.number); expect(source.commands.currentNumber).toBe(2);
  expect(source.commands.read(1)?.serverTime).toBe(100); expect(source.commands.read(2)?.serverTime).toBe(300);
  source.beginRoundRestart(0, state(third, 900, "new")); currentActor = third;
  source.rebindRound(third, state(third, 900, "new")); source.receive(state(third, 1000, "new"), [], []);
  expect(source.read(source.current().number)?.flags).toBe(0);
  expect(source.getServerCommand(3)).toEqual(["map_restart"]); expect(source.getServerCommand(4)).toBeNull();
});

test("invalid restart epochs and replacement actor bindings cannot publish or change the client slot", () => {
  const owner = createIdentityOwner("local-round-checks"), old = owner.actor(0, 1), next = owner.actor(0, 2);
  const alien = createIdentityOwner("other-session").actor(0, 2);
  const source = new ApplicationQ3Source(old, state(old, 100), () => ({ entities: [], areaMask: new Uint8Array(0) }), () => old);
  const before = source.current();
  for (const input of [state(next, 99), { ...state(next, 200), product: "baseq3" } satisfies Q3SourcePresentationState])
    expect(() => source.beginRoundRestart(4, input)).toThrow("epoch");
  expect(() => source.beginRoundRestart(0, state(next, 200))).toThrow("epoch");
  expect(source.getServerCommand(1)).toBeNull(); expect(source.current()).toEqual(before);
  source.beginRoundRestart(4, state(next, 200));
  for (const [actor, input] of [[alien, state(alien, 200)], [old, state(old, 200)], [next, state(next, 200, "old", 1)],
    [next, state(next, 150)], [next, state(next, 99)]] satisfies readonly (readonly [ActorId, Q3SourcePresentationState])[]) {
    expect(() => source.rebindRound(actor, input)).toThrow("binding"); expect(source.actor).toBe(old);
    expect(source.current()).toEqual(before);
  }
  source.rebindRound(next, state(next, 200)); expect(source.clientNumber).toBe(0);
  expect(() => source.rebindRound(next, state(next, 200))).toThrow("binding");
});

test("settle and reconnect reliables surround map_restart without early snapshots or replay", () => {
  const owner = createIdentityOwner("local-reliable-order"), old = owner.actor(0, 1), next = owner.actor(0, 2);
  const source = new ApplicationQ3Source(old, state(old, 100), () => ({ entities: [], areaMask: new Uint8Array(0) }), () => next);
  const event = (sequence: number, text: string, client = -1): SimulationPresentationEvent =>
    ({ kind: "q3-source", sequence, content: "q3:classic:missionpack:base", seconds: 0.2, event: { kind: "server-command", client, text } });
  const before = source.current(), snapshot = source.read(before.number);
  const settling = [event(10, 'print "settle complete"'), event(11, 'print "other seat"', 1)];
  source.receiveEvents(settling);
  expect(source.current()).toEqual(before); expect(source.read(before.number)).toBe(snapshot);
  source.beginRoundRestart(4, { ...state(next, 400, "new"), clients: [] });
  const reconnecting = [event(12, 'print "client connected"', 0)];
  source.receiveEvents(reconnecting);
  expect(source.current()).toEqual(before); expect(source.read(before.number)).toBe(snapshot);
  expect(source.getServerCommand(1)).toEqual(["print", "settle complete"]);
  expect(source.getServerCommand(2)).toEqual(["cs", "5", "new"]);
  expect(source.getServerCommand(3)).toEqual(["map_restart"]);
  expect(source.getServerCommand(4)).toEqual(["print", "client connected"]);
  expect(source.getServerCommand(5)).toBeNull();
  source.rebindRound(next, state(next, 400, "new"));
  const final = event(13, 'print "ready"'); source.receiveEvents([final]);
  expect(source.current()).toEqual(before);
  source.receive(state(next, 500, "new"), [...settling, ...reconnecting, final], []);
  expect(source.read(source.current().number)?.serverCommandNumber).toBe(5);
  expect(source.getServerCommand(5)).toEqual(["print", "ready"]); expect(source.getServerCommand(6)).toBeNull();
  expect(source.read(source.current().number)?.flags).toBe(4);
});
