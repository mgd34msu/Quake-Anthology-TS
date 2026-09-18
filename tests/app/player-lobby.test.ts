import { expect, test } from "bun:test";
import { createContentDigest, type ExecutableRecipe, type ProviderReference, type ResolvedResourceReference } from "../../src/contracts/content.ts";
import { compositionIdentity } from "../../src/network/common/session.ts";
import { ipAddress } from "../../src/network/common/endpoint.ts";
import { LocalLobbyService, type Account } from "../../src/network/services/online.ts";
function composition() {
  const provider: ProviderReference = { provider: "q3:authored", content: "q3:test:authored:1" };
  const resource: ResolvedResourceReference = {
    id: "resource:authored-map", requestedPath: "maps/authored.bsp", digest: createContentDigest("0".repeat(64)), byteLength: 0,
    provenance: { kind: "loose", memberPath: "maps/authored.bsp", mount: { kind: "loose", identity: { id: "mount:test:maps", content: provider.content, generation: 0 }, rootPath: "/tmp/authored-map-fixture" } },
    resolution: { kind: "default-order", plan: "mount-plan:test:1", rank: 0 },
  };
  const recipe: ExecutableRecipe = {
    schemaVersion: 3, id: "recipe:test:1", preset: "recipe:test:1", map: { geometryContent: provider.content, geometry: resource, entities: provider }, campaign: { kind: "none" },
    movement: provider, character: { definition: provider, appearance: provider }, weapons: [provider], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider }, engineBehavior: provider, combat: provider, inventory: provider,
    match: provider, transition: provider, execution: [], mounts: { id: "mount-plan:test:1", mounts: [resource.provenance.mount], defaultOrder: [resource.provenance.mount.identity.id], prefixOrders: [] },
    resources: [resource], timing: [], ordering: { kind: "mixed", providers: [provider.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" },
  };
  const identity = compositionIdentity({ schemaVersion: 1, recipe, snapshotSchema: "unified:snapshot-v1", actorConfigurations: [] });
  return identity;
}
test("completion retains members, clears readiness, and stale completion cannot close a later match", () => {
  const identity = composition();
  const owner: Account = { id: "account:owner", name: "Owner" }, guest: Account = { id: "account:guest", name: "Guest" };
  const service = new LocalLobbyService(), lobby = service.create(owner, "campaign", 2, identity);
  service.join(lobby.id, guest); service.ready(lobby.id, owner.id, true); service.ready(lobby.id, guest.id, true);
  const first = service.start(lobby.id, owner.id);
  expect(first.endpoint).toBeNull();
  service.publish(lobby.id, owner.id, first.matchGeneration, ipAddress("127.0.0.1", 27960), {kind:"unified",version:1,composition:identity.digest,snapshotSchema:"unified:snapshot-v1"});
  expect(() => service.complete(lobby.id, guest.id, first.matchGeneration)).toThrow();
  const completed = service.complete(lobby.id, owner.id, first.matchGeneration);
  expect(completed.phase).toBe("open"); expect(completed.members.map(member => member.ready)).toEqual([false, false]);
  expect(completed.members.map(member => member.account.id)).toEqual([owner.id, guest.id]);
  service.ready(lobby.id, owner.id, true);
  expect(service.complete(lobby.id, owner.id, first.matchGeneration).members[0]?.ready).toBe(true);
  service.ready(lobby.id, guest.id, true); const second = service.start(lobby.id, owner.id);
  service.publish(lobby.id, owner.id, second.matchGeneration, ipAddress("127.0.0.1", 27961), {kind:"unified",version:1,composition:identity.digest,snapshotSchema:"unified:snapshot-v1"});
  expect(second.matchGeneration).toBe(first.matchGeneration + 1);
  expect(service.complete(lobby.id, owner.id, first.matchGeneration).phase).toBe("playing");
  expect(service.complete(lobby.id, owner.id, second.matchGeneration).phase).toBe("open");
});

import { ApplicationLocalLobby } from "../../src/app/bootstrap/local-lobby.ts";

test("prepared lobby publishes only bound host endpoint, preserves room for next match and cleans clients when host leaves", async () => {
  const service = new LocalLobbyService(), events: string[] = [];
  const host = new ApplicationLocalLobby(service, {id:"account:host",name:"Host"}, {
    host: async lobby => { events.push(`host:${lobby.matchGeneration}`); expect(lobby.endpoint).toBeNull(); return {endpoint:ipAddress("127.0.0.1", 27910),wire:{kind:"unified",version:1,composition:lobby.composition.digest,snapshotSchema:"unified:snapshot-v1"}}; },
    join: async () => { throw new Error("Host cannot join itself"); }, leave: async () => { events.push("host-left"); }, completed: async () => { events.push("host-completed"); },
  });
  const peer = new ApplicationLocalLobby(service, {id:"account:peer",name:"Peer"}, {
    host: async () => { throw new Error("Peer cannot host"); },
    join: async lobby => { expect(lobby.endpoint).toEqual(ipAddress("127.0.0.1", 27910)); events.push(`peer:${lobby.matchGeneration}`); },
    leave: async () => { events.push("peer-left"); }, completed: async () => { events.push("peer-completed"); },
  });
  await host.host("room", 2, {composition:composition()}); const room = host.current(); if (room === null) throw new Error("Missing room");
  expect(room.endpoint).toBeNull(); await peer.join(room.id); await host.ready(true); await peer.ready(true);
  await host.start(); await peer.poll(); await peer.poll(); expect(events).toEqual(["host:1","peer:1"]);
  await host.complete(); await peer.poll(); expect(host.current()?.members).toHaveLength(2); expect(peer.current()?.phase).toBe("open");
  await host.ready(true); await peer.ready(true); await host.start(); await peer.poll();
  expect(events).toContain("host:2"); expect(events).toContain("peer:2");
  await host.leave(); await peer.poll(); expect(peer.current()).toBeNull(); expect(events.at(-1)).toBe("peer-left");
  await host.close(); await peer.close();
});

test("failed listener launch restores prepared lobby and readiness without publishing an endpoint", async () => {
  const service = new LocalLobbyService();
  const host = new ApplicationLocalLobby(service, {id:"account:host",name:"Host"}, {
    host: async () => { throw new Error("Bind failed"); }, join: async () => undefined,
    leave: async () => undefined, completed: async () => undefined,
  });
  await host.host("room", 1, {composition:composition()}); await host.ready(true);
  await expect(host.start()).rejects.toThrow("Bind failed");
  expect(host.current()?.phase).toBe("open"); expect(host.current()?.endpoint).toBeNull(); expect(host.current()?.members[0]?.ready).toBe(false);
  await host.close(); expect(service.list()).toEqual([]);
});

import { rereleaseMatchScore } from "../../src/app/bootstrap/q2-match-reports.ts";
test("native rerelease match reports require explicit public intermission and exclude spectators", () => {
  const stats: number[] = Array.from({length:64}, () => 0); stats[14] = -3;
  expect(rereleaseMatchScore({stats})).toBeNull();
  stats[13] = 8; expect(rereleaseMatchScore({stats})).toBe(-3);
  stats[17] = 1; expect(rereleaseMatchScore({stats})).toBeNull();
});

import { registerLocalLobbyMenu } from "../../src/ui/settings/local-lobby.ts";
import { NativeUiController, defaultUiSkin } from "../../src/ui/common/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
test("local lobby menu creates a prepared room with actual local seat capacity before any host launch", async () => {
  const service = new LocalLobbyService(), seat = createIdentityOwner("lobby-menu").seat(0); let launches = 0;
  const owner = new ApplicationLocalLobby(service, {id:"account:menu",name:"Local player"}, {
    host: async lobby => { launches++; return {endpoint:ipAddress("127.0.0.1",27910),wire:{kind:"unified",version:1,composition:lobby.composition.digest,snapshotSchema:"unified:snapshot-v1"}}; },
    join: async () => undefined, leave: async () => undefined, completed: async () => undefined,
  });
  const ui = new NativeUiController({seat,now:()=>0,skin:()=>defaultUiSkin("resource:test:font"),bindings:()=>[],focus:()=>undefined,sound:()=>undefined,executeScript:()=>undefined});
  const menu = registerLocalLobbyMenu(ui, () => owner, async () => ({composition:composition()}), () => 2);
  ui.openMenu(menu.root);
  for (const code of [KeyCode.Tab,KeyCode.Tab,KeyCode.Enter]) ui.input({kind:"key",seat,timeMilliseconds:0,code,down:true,repeat:false});
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  expect(owner.current()?.phase).toBe("open"); expect(owner.current()?.endpoint).toBeNull();
  expect(owner.current()?.members[0]?.seats).toBe(2); expect(launches).toBe(0);
  menu.dispose(); await owner.close();
});

test("rejected lobby publication retires the successfully bound host", async () => {
  const service = new LocalLobbyService(); let retired = false;
  const host = new ApplicationLocalLobby(service, {id:"account:host",name:"Host"}, {
    host: async () => ({endpoint:ipAddress("127.0.0.1",27910),wire:{kind:"unified",version:1,composition:createContentDigest("f".repeat(64)),snapshotSchema:"unified:snapshot-v1"}}),
    join: async () => undefined, leave: async () => { retired = true; }, completed: async () => undefined,
  });
  await host.host("room",1,{composition:composition()}); await host.ready(true);
  await expect(host.start()).rejects.toThrow("does not match"); expect(retired).toBe(true);
  expect(host.current()?.phase).toBe("open"); await host.close();
});

import { classicMatchScore } from "../../src/app/bootstrap/q2-match-reports.ts";
test("classic native transition reports use public final score and spectator fields without freeze inference", () => {
  const stats: number[] = Array.from({length:32}, () => 0); stats[14] = 7;
  expect(classicMatchScore({stats})).toBe(7);
  stats[17] = 1; expect(classicMatchScore({stats})).toBeNull();
});
