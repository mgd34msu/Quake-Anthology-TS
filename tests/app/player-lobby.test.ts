import { expect, test } from "bun:test";
import { createContentDigest, type ExecutableRecipe, type ProviderReference, type ResolvedResourceReference } from "../../src/contracts/content.ts";
import { compositionIdentity } from "../../src/network/common/session.ts";
import { ipAddress } from "../../src/network/common/endpoint.ts";
import { LocalLobbyService, type Account } from "../../src/network/services/online.ts";
test("completion retains members, clears readiness, and stale completion cannot close a later match", () => {
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
  const owner: Account = { id: "account:owner", name: "Owner" }, guest: Account = { id: "account:guest", name: "Guest" };
  const service = new LocalLobbyService(), lobby = service.create(owner, "campaign", 2, identity, ipAddress("127.0.0.1", 27960));
  service.join(lobby.id, guest); service.ready(lobby.id, owner.id, true); service.ready(lobby.id, guest.id, true);
  const first = service.start(lobby.id, owner.id);
  expect(() => service.complete(lobby.id, guest.id, first.matchGeneration)).toThrow();
  const completed = service.complete(lobby.id, owner.id, first.matchGeneration);
  expect(completed.phase).toBe("open"); expect(completed.members.map(member => member.ready)).toEqual([false, false]);
  expect(completed.members.map(member => member.account.id)).toEqual([owner.id, guest.id]);
  service.ready(lobby.id, owner.id, true);
  expect(service.complete(lobby.id, owner.id, first.matchGeneration).members[0]?.ready).toBe(true);
  service.ready(lobby.id, guest.id, true); const second = service.start(lobby.id, owner.id);
  expect(second.matchGeneration).toBe(first.matchGeneration + 1);
  expect(service.complete(lobby.id, owner.id, first.matchGeneration).phase).toBe("playing");
  expect(service.complete(lobby.id, owner.id, second.matchGeneration).phase).toBe("open");
});
