import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { OriginalPickupOffer, PickupCargoEntry, SourcePickupLifetime } from "../../../src/contracts/original-pickups.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";
import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("pickup cargo"));
  const player = actors.allocate("q1:world", "q1:player"), pickup = actors.allocate("q1:world", "q1:item_backpack");
  const inventory = new SharedInventoryTable(actors);
  inventory.create(player, [{ item: "q3:ammo/shotgun", count: 2, capacity: 200 }, { item: "q3:weapon/shotgun", count: 0, capacity: 1 }]);
  const combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const admission = new SharedOriginalPickupAdmission(actors, combat, inventory);
  const cargo: PickupCargoEntry[] = [{ kind: "counter", item: "q1:ammo/shells", count: 7 }];
  const offer: OriginalPickupOffer = { recipient: player.id, pickup: pickup.id, source: "q1:world", item: "q1:item_backpack", defaultResource: null,
    time: { kind: "seconds", value: 2 }, count: { kind: "default" }, dropped: true, cargo };
  return { actors, player, pickup, inventory, admission, cargo, offer };
}

test("source terminal consumption holds the immutable cargo and recipient binding through caller continuation", () => {
  const f = fixture();
  let captured: SourcePickupLifetime | null = null;
  f.inventory.bindPickup(f.player, { owner: "q3:weapons", rules: [{ id: "backpack", offered: [f.offer.item], writes: [{ kind: "inventory", item: "q3:ammo/shotgun", fields: "count" }], take: offer => {
    expect(offer.cargo).toEqual([{ kind: "counter", item: "q1:ammo/shells", count: 7 }]);
    expect(Object.isFrozen(offer.cargo)).toBe(true); expect(Object.isFrozen(offer.cargo?.[0])).toBe(true);
    return "accepted";
  } }] });
  f.admission.runSource(f.offer, (selection, lifetime) => {
    captured = lifetime;
    expect(selection.kind).toBe("replacement"); if (selection.kind !== "replacement") throw new Error("Missing source replacement");
    f.cargo.length = 0;
    expect(() => lifetime.consumePickup(() => f.actors.release(f.pickup))).toThrow("source scope");
    expect(selection.grant()).toBe("accepted");
    lifetime.consumePickup(() => {
      expect(() => lifetime.consumePickup(() => f.actors.release(f.pickup))).toThrow("source scope");
      return f.actors.release(f.pickup);
    });
    expect(selection.current()).toBe(true);
    expect(() => f.admission.assertIdle()).toThrow("pickup execution");
    expect(() => lifetime.consumePickup(() => undefined)).toThrow("source scope");
  });
  if (captured === null) throw new Error("Missing source lifetime");
  const expired: SourcePickupLifetime = captured;
  expect(() => expired.consumePickup(() => undefined)).toThrow("source scope");
  expect(f.admission.assertIdle()).toBeUndefined(); f.actors.close();
});

test("arbitrary donor removal is stale and terminal removal must retire the exact pickup", () => {
  const f = fixture();
  f.inventory.bindPickup(f.player, { owner: "q3:weapons", rules: [{ id: "backpack", offered: [f.offer.item], writes: [{ kind: "inventory", item: "q3:ammo/shotgun", fields: "count" }], take: () => {
    f.actors.release(f.pickup); return "accepted";
  } }] });
  f.admission.runSource(f.offer, (selection, lifetime) => {
    if (selection.kind !== "replacement") throw new Error("Missing replacement");
    expect(selection.grant()).toBe("stale"); expect(selection.current()).toBe(false);
    expect(() => lifetime.consumePickup(() => undefined)).toThrow("source scope");
  }); f.actors.close();
  const original = fixture();
  expect(() => original.admission.runSource(original.offer, (_selection, lifetime) => lifetime.consumePickup(() => undefined))).toThrow("exact pickup");
  expect(original.actors.isLive(original.pickup.id)).toBe(true); original.actors.close();
});

test("cargo preflights every destination and empty weapon payload retains the selected owner", () => {
  const f = fixture(), selected: string[] = [];
  const supply = new SharedPickupAdmission({ inventory: f.inventory, profile: { id: "test:cargo", weaponOwnership: "all-destinations", ammo: [{ source: "q1:ammo/shells", destinations: ["q3:ammo/shotgun"] }, { source: "q1:ammo/nails", destinations: ["q3:ammo/machinegun"] }], weapons: [{ source: "q1:weapon/supershotgun", destinations: ["q3:weapon/shotgun"] }] },
    ammoGranted: () => undefined, weaponGranted: (_actor, weapons) => { selected.push(...weapons); return undefined; } });
  expect(() => supply.cargo(f.player, [{ kind: "weapon", item: "q1:weapon/supershotgun", count: 1 }, ...f.cargo, { kind: "counter", item: "q1:ammo/nails", count: 9 }], "always")).toThrow("not admitted");
  expect(f.inventory.count(f.player.id, "q3:ammo/shotgun")).toBe(2); expect(f.inventory.count(f.player.id, "q3:weapon/shotgun")).toBe(0);
  expect(supply.cargo(f.player, f.cargo, "always")).toBe(true); expect(selected).toEqual([]);
  expect(f.inventory.count(f.player.id, "q3:ammo/shotgun")).toBe(9); f.actors.close();
});
