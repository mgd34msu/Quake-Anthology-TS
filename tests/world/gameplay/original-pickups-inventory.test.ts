import { expect, test } from "bun:test";
import type { ProtectionObserver, ProtectionStore } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { OriginalPickupOffer, OriginalPickupRule } from "../../../src/contracts/original-pickups.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("inventory-only pickups"));
  const player = actors.allocate("q3:world", "q3:player"), item = actors.allocate("q3:world", "q3:ammo_shells");
  const combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined,
  }), inventory = new SharedInventoryTable(actors), pickups = new SharedOriginalPickupAdmission(actors, combat, inventory);
  inventory.create(player, [{ item: "q3:ammo/shotgun", count: 2, capacity: 50, countPolicy: { kind: "source-counter", arithmetic: "int32" } }]);
  const offer: OriginalPickupOffer = { recipient: player.id, pickup: item.id, source: "q3:world", item: "q3:ammo/shotgun",
    defaultResource: { kind: "inventory", item: "q3:ammo/shotgun" }, count: { kind: "default" }, dropped: false, time: { kind: "milliseconds", value: 1000 } };
  const bind = (take: OriginalPickupRule["take"]) => inventory.bindPickup(player, { owner: "mod:ammo", item: "q3:ammo/shotgun", rules: [{ id: "shells", offered: [offer.item], take }] });
  return { actors, player, combat, inventory, pickups, offer, bind };
}
const regular: ProtectionStore = { regular: { before: { kind: "none" }, after: { kind: "source", points: 1, item: null } } };
const powered: ProtectionStore = { powered: { before: { kind: "none" }, after: { kind: "shield", cells: 1 } } };

test("inventory-only source grants settle without creating combat and retain checkpoint exclusion", () => {
  const f = fixture(), completions: boolean[] = [], observers: ProtectionObserver[] = [];
  let accept = true, fallbacks = 0;
  f.bind((_offer, observer) => {
    observers.push(observer); expect(f.combat.read(f.player.id)).toBeNull();
    expect(() => f.combat.assertIdle()).toThrow("pickup execution");
    expect(() => f.pickups.assertIdle()).toThrow("pickup execution");
    if (!accept) return "refused";
    f.inventory.configure(f.player, { item: "q3:ammo/shotgun", count: 12, capacity: 50 }); return "accepted";
  });
  const continuation = { original: () => { fallbacks++; return true; }, complete: (taken: boolean) => { completions.push(taken); } };
  try {
    expect(f.pickups.touch(f.offer, continuation)).toBe("accepted");
    expect(f.inventory.count(f.player.id, "q3:ammo/shotgun")).toBe(12);
    accept = false; expect(f.pickups.touch(f.offer, continuation)).toBe("refused");
    expect(completions).toEqual([true, false]); expect(fallbacks).toBe(0); expect(f.combat.read(f.player.id)).toBeNull();
    expect(f.combat.assertIdle()).toBeUndefined(); expect(f.pickups.assertIdle()).toBeUndefined();
    for (const observer of observers) expect(() => observer.stored(regular)).toThrow("closed");
  } finally { f.actors.close(); }
});

test("inventory-only protection reports fail the whole grant even if its callback catches the error", () => {
  for (const change of [regular, powered]) {
    const f = fixture(); let completed = false;
    f.bind((_offer, observer) => {
      expect(() => observer.stored(change)).toThrow("without a combat binding");
      return "accepted";
    });
    try {
      expect(() => f.pickups.touch(f.offer, { original: () => true, complete: () => { completed = true; } })).toThrow("without a combat binding");
      expect(completed).toBe(false); expect(f.combat.read(f.player.id)).toBeNull();
      expect(f.combat.assertIdle()).toBeUndefined(); expect(f.pickups.assertIdle()).toBeUndefined();
    } finally { f.actors.close(); }
  }
});

test("inventory-only grants reject changed combat ownership and propagate source store failures", () => {
  const f = fixture(); let completed = false;
  const unbind = f.bind(() => {
    f.combat.create(f.player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
    return "accepted";
  });
  try {
    expect(() => f.pickups.touch(f.offer, { original: () => true, complete: () => { completed = true; } })).toThrow("binding changed");
    expect(completed).toBe(false); unbind();
    const sourceFailure = new Error("original source store failed"); f.bind(() => { throw sourceFailure; });
    expect(() => f.pickups.touch(f.offer, { original: () => true, complete: () => { completed = true; } })).toThrow(sourceFailure);
    expect(completed).toBe(false); expect(f.combat.assertIdle()).toBeUndefined(); expect(f.pickups.assertIdle()).toBeUndefined();
  } finally { f.actors.close(); }
});

test("inventory-only grant retirement cancels map completion and rejects escaped actor authority", () => {
  const f = fixture(); let completed = false;
  f.bind(() => { f.actors.release(f.player); return "accepted"; });
  try {
    expect(f.pickups.touch(f.offer, { original: () => true, complete: () => { completed = true; } })).toBe("stale");
    expect(completed).toBe(false);
    expect(() => f.combat.withPickupProtection(f.player, "mod:ammo", () => "accepted")).toThrow("Stale or foreign");
    expect(f.combat.assertIdle()).toBeUndefined(); expect(f.pickups.assertIdle()).toBeUndefined();
  } finally { f.actors.close(); }
});
