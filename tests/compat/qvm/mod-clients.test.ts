import { expect, test } from "bun:test";
import { QvmModClientBindings } from "../../../src/compat/qvm/mod-clients.ts";
import { readQvmPlayerState } from "../../../src/compat/qvm/player-record.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, ClientId } from "../../../src/contracts/identity.ts";
import type { ModClientCommand, ModClientEvent, ModClientServices } from "../../../src/world/session/mod-clients.ts";

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
