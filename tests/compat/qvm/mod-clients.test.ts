import { expect, test } from "bun:test";
import { QvmModClientBindings } from "../../../src/compat/qvm/mod-clients.ts";
import { readQvmPlayerState } from "../../../src/compat/qvm/player-record.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, ClientId } from "../../../src/contracts/identity.ts";
import type { ModClientCommand, ModClientEvent, ModClientServices } from "../../../src/world/session/mod-clients.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";
import type { QvmModSourceCall } from "../../../src/contracts/qvm-mod-callbacks.ts";

test("component clients route targeted effects and accepted commands through live identities", () => {
  const ids = createIdentityOwner("component-clients"), first = ids.actor(40, 1), second = ids.actor(7, 3);
  const client = ids.client(7, 2), other = ids.client(1, 4);
  const identities = new Map<ClientId, ActorId>([[client, first], [other, second]]), info = new Map([[client, "first"], [other, "second"]]);
  const listeners = new Set<(event: ModClientEvent) => undefined>(), drops: unknown[] = [], messages: unknown[] = [];
  const projected: ActorId[] = [], released: ActorId[] = [], admitted: ActorId[] = [];
  let accepted: ModClientCommand | null = null;
  const services: ModClientServices = { maximum: 8, clients: () => [...identities].map(([client, actor]) => ({ client, actor })),
    forActor: actor => [...identities].find(([, value]) => value.equals(actor))?.[0] ?? null, actor: client => identities.get(client) ?? null,
    userinfo: client => info.get(client) ?? "", setUserinfo: (client, value) => { info.set(client, value); }, command: () => accepted,
    drop: (client, reason, content) => { drops.push({ client, reason, content }); },
    subscribeApplication: () => () => undefined,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); return undefined; }; } };
  const state = new DataView(new ArrayBuffer(468));
  state.setInt32(56, 1024, true); state.setInt32(60, 2048, true); state.setInt32(144, 11, true);
  const binding = new QvmModClientBindings({ services, content: "q3:classic:component:test",
    declaration: { maximum: 2, records: ["client"], playerStateRecord: "client", admit: [{ entry: 1, arguments: [], globals: [], returns: "void" }], userinfo: [], disconnect: [] },
    project: actor => { projected.push(actor); }, release: actor => { released.push(actor); }, invoke: (_call, actor) => { admitted.push(actor); },
    playerState: () => readQvmPlayerState(state), send: (text, recipient) => { messages.push({ text, recipient }); } });
  expect(binding.slot(first)).toBe(0);
  binding.start(); expect(admitted).toEqual([first, second]);
  expect(binding.slot(first)).toBe(0); expect(binding.slot(second)).toBe(1);
  expect(binding.getUserinfo(0)).toBe("first"); expect(binding.getUserinfo(1)).toBe("second");
  binding.setUserinfo(1, "new second"); expect(info.get(other)).toBe("new second"); expect(projected).toHaveLength(2);
  binding.sendServerCommand(0, "print first"); binding.sendServerCommand(-1, "print all");
  expect(messages).toEqual([{ text: "print first", recipient: first }, { text: "print all", recipient: null }]);
  binding.dropClient(1, "authored reason");
  expect(drops).toEqual([{ client: other, reason: "authored reason", content: "q3:classic:component:test" }]);
  expect(() => binding.getUserCommand(0)).toThrow("accepted");
  accepted = { time: { kind: "seconds", value: 1.25 }, input: { actor: first, source: { kind: "remote-client", client }, sequence: 9,
    angleSpace: "absolute", arsenal: { provider: "q3:weapons", weapon: null, useHoldable: true }, command: { kind: "q2-classic", milliseconds: 100,
      angleShorts: [4096, 8192, 0], forwardMove: 200, sideMove: -100, upMove: 0, buttons: 1, impulse: 0, lightLevel: 0 } } };
  expect(binding.getUserCommand(0)).toEqual({ serverTime: 1250, angles: [3072, 6144, 0], buttons: 5, weapon: 11, forwardmove: 127, rightmove: -63, upmove: 0 });
  expect(binding.getUserCommand(0).serverTime).toBe(1250);
  for (const listener of listeners) listener({ kind: "disconnecting", identity: { actor: first, client } });
  identities.delete(client); info.delete(client);
  expect(released).toEqual([first]); expect(binding.getUserinfo(0)).toBe("");
  expect(() => binding.setUserinfo(0, "stale")).toThrow("unbound");
  const replacement = ids.actor(40, 2), replacementClient = ids.client(7, 3);
  identities.set(replacementClient, replacement); info.set(replacementClient, "replacement");
  for (const listener of listeners) listener({ kind: "admitted", identity: { actor: replacement, client: replacementClient } });
  expect(binding.slot(replacement)).toBe(0); expect(binding.getUserinfo(1)).toBe("new second");
  binding.sendServerCommand(0, "print replacement"); expect(messages.at(-1)).toEqual({ text: "print replacement", recipient: replacement });
  binding.close(); expect(listeners.size).toBe(0); expect(identities.size).toBe(2);
});

test("QVM server frame calls retain source order and stop captured clients on retirement, reuse, close or failure", () => {
  const ids = createIdentityOwner("component-frame"), first = ids.actor(10, 1), second = ids.actor(20, 1), pending = ids.actor(30, 1);
  const client = ids.client(1, 1), secondClient = ids.client(2, 1);
  const identities = new Map<ClientId, ActorId>([[client, first], [secondClient, second], [ids.client(3, 1), pending]]);
  const services: ModClientServices = { maximum: 3, clients: () => [],
    forActor: actor => [...identities].find(([, value]) => value.equals(actor))?.[0] ?? null, actor: client => identities.get(client) ?? null,
    userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
    subscribe: () => () => undefined, subscribeApplication: () => () => undefined };
  const calls: readonly QvmModSourceCall[] = [1, 2].map(entry => ({ entry, arguments: [], globals: [], returns: "void" }));
  const binding = new QvmModClientBindings({ services, content: "q3:classic:component:test",
    declaration: { maximum: 3, records: ["client"], playerStateRecord: "client", admit: [], userinfo: [], disconnect: [], frame: calls },
    project: () => {}, release: () => {}, invoke: () => { throw new Error("Frame must use its server context"); },
    playerState: () => readQvmPlayerState(new DataView(new ArrayBuffer(468))), send: () => {} });
  const saved = [{ actor: second, slot: 1, admitted: true }, { actor: first, slot: 0, admitted: true }, { actor: pending, slot: 2, admitted: false }];
  binding.restore(saved); binding.start();
  const seen: string[] = [];
  const observe = (call: QvmModSourceCall, actor: ActorId): void => { seen.push(`${actor.slot}:${call.entry}`); };
  binding.frame(observe); expect(seen).toEqual(["10:1", "10:2", "20:1", "20:2"]);
  const replacement = ids.actor(10, 2);
  seen.length = 0;
  binding.frame((call, actor) => {
    observe(call, actor);
    if (actor.equals(first)) { binding.forget(first); identities.set(client, replacement); expect(binding.slot(replacement)).toBe(0); }
  });
  expect(seen).toEqual(["10:1", "20:1", "20:2"]);
  expect(binding.checkpoint().find(entry => entry.actor.equals(replacement))?.admitted).toBe(false);
  seen.length = 0;
  binding.frame((call, actor) => { observe(call, actor); identities.delete(secondClient); });
  expect(seen).toEqual(["20:1"]);
  identities.set(secondClient, second); identities.set(client, first); binding.restore(saved);
  expect(() => binding.frame(() => { throw new Error("original frame failed"); })).toThrow("original frame failed");
  seen.length = 0;
  binding.frame((call, actor) => { observe(call, actor); binding.close(); });
  expect(seen).toEqual(["10:1"]);
  binding.frame(observe); expect(seen).toEqual(["10:1"]);
});

test("QVM input callbacks read nested applied commands and retire every scoped override", () => {
  const ids = createIdentityOwner("component-applied-input"), actor = ids.actor(2, 1), client = ids.client(1, 1);
  const applications = new ModClientApplications(identity => identity.actor.equals(actor) && identity.client.equals(client));
  const observed: number[] = [];
  const services: ModClientServices = { maximum: 2, clients: () => [{ actor, client }],
    forActor: value => value.equals(actor) ? client : null, actor: value => value.equals(client) ? actor : null,
    userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
    subscribe: () => () => undefined, subscribeApplication: listener => applications.subscribe(listener) };
  const state = new DataView(new ArrayBuffer(468)); state.setInt32(56, 1024, true); state.setInt32(144, 11, true);
  const call = { entry: 1, arguments: [], globals: [], returns: "void" } satisfies import("../../../src/contracts/qvm-mod-callbacks.ts").QvmModSourceCall;
  const binding = new QvmModClientBindings({ services, content: "q3:classic:component:test",
    declaration: { maximum: 2, records: ["client"], playerStateRecord: "client", admit: [], userinfo: [], disconnect: [],
      input: [{ scope: "client-command", phase: "after", calls: [call] }, { scope: "movement-slice", phase: "after", calls: [call] }] },
    project: () => {}, release: () => {}, invoke: () => { observed.push(binding.getUserCommand(0).serverTime); },
    playerState: () => readQvmPlayerState(state), send: () => {} });
  binding.start();
  const received: ModClientCommand = { time: { kind: "seconds", value: 5 }, input: { actor, source: { kind: "remote-client", client }, sequence: 10,
    arsenal: { provider: "q3:weapons", weapon: null, useHoldable: true }, command: { kind: "q3", serverTimeMilliseconds: 5000,
      angleWords: [0, 0, 0], buttons: 4, weapon: 5, forwardMove: 0, rightMove: 0, upMove: 0 } } };
  const begin = (serverTime: number, aim: number, scope: "client-command" | "movement-slice", parentInvocation?: number) => applications.begin({
    identity: { actor, client }, scope, ...(parentInvocation === undefined ? {} : { parentInvocation }),
    command: { kind: "q3", serverTimeMilliseconds: serverTime, angleWords: [3, 4, 5], buttons: 1,
      forwardMove: 40, rightMove: -20, upMove: 0, weapon: 2 }, angleSpace: "source-relative",
    absoluteAim: { x: aim, y: 0, z: 0 }, accepted: scope === "client-command" ? received : null,
    frame: { frame: 1, time: { kind: "milliseconds", value: 999 }, elapsed: { kind: "milliseconds", value: 50 }, phase: "client-command" },
  });
  const outer = begin(100, 45, "client-command");
  expect(binding.getUserCommand(0)).toEqual({ serverTime: 100, angles: [7168, 0, 0], buttons: 1,
    weapon: 11, forwardmove: 40, rightmove: -20, upmove: 0 });
  expect(observed).toEqual([]);
  expect(() => binding.checkpoint()).toThrow("input application");
  const inner = begin(150, 90, "movement-slice", outer?.invocation);
  expect(binding.getUserCommand(0).angles[0]).toBe(15360);
  applications.finish(inner);
  expect(observed).toEqual([150]); expect(binding.getUserCommand(0).serverTime).toBe(100);
  applications.finish(outer);
  expect(observed).toEqual([150, 100]);
  expect(() => binding.getUserCommand(0)).toThrow("accepted");
  expect(binding.checkpoint()).toHaveLength(1);
  applications.finish(begin(200, 0, "client-command"), true);
  expect(observed).toEqual([150, 100]); expect(() => binding.getUserCommand(0)).toThrow("accepted");
  const pending = begin(250, 0, "client-command"); binding.close(); applications.finish(pending);
  expect(observed).toEqual([150, 100]); expect(applications.active).toBe(false);
});
