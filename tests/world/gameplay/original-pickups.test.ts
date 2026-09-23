import { expect, test } from "bun:test";
import type { DamageRequest, RegularArmorState } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { OriginalPickupOffer, OriginalPickupRule } from "../../../src/contracts/original-pickups.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("original pickups"));
  const player = actors.allocate("q1:world", "q1:player"), item = actors.allocate("q1:world", "q1:item_armor1");
  const combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined,
  });
  combat.create(player, { health: 100, mass: 200, canTakeDamage: true, invulnerable: false, team: null,
    armor: { regular: { kind: "q1", item: "q1:item_armor1", points: 17, absorption: 0.3 }, powered: { kind: "none" } } });
  const inventory = new SharedInventoryTable(actors);
  inventory.create(player, [{ item: "q1:ammo/shells", count: 2, capacity: 100 }]);
  const pickups = new SharedOriginalPickupAdmission(actors, combat, inventory);
  const offer: OriginalPickupOffer = { recipient: player.id, pickup: item.id, source: "q1:world", item: "q1:item_armor1",
    defaultResource: { kind: "protection", channel: "regular" }, count: { kind: "default" }, dropped: false, time: { kind: "seconds", value: 3 } };
  const armor: { value: RegularArmorState } = { value: { kind: "source", item: "mod:green", points: 40 } };
  const bind = (rules: readonly OriginalPickupRule[]) => combat.bindProtection(player, { owner: "mod:armor", rule: "armor", channel: "regular",
    admission: { kind: "replace-current-primary" }, inventoryItems: [], read: () => armor.value, validateWrite: () => undefined,
    write: value => { armor.value = value; return undefined; }, absorb: () => ({ saved: 0 }), pickups: rules });
  return { actors, player, item, combat, inventory, pickups, offer, armor, bind };
}

test("source grant and map targets share one scope, including eligibility and checkpoint exclusion", () => {
  const world = fixture();
  let grants = 0, eligibility = 0, completions = 0, fallbacks = 0;
  world.bind([{ id: "green", offered: [world.offer.item], take: () => { grants++; return "accepted"; } }]);
  const callbacks = { eligible: () => { eligibility++; return true; }, original: () => { fallbacks++; return true; }, complete: (taken: boolean) => {
    expect(taken).toBe(true); completions++;
    expect(() => world.pickups.assertIdle()).toThrow("pickup execution");
    expect(world.pickups.touch(world.offer, callbacks)).toBe("stale");
  } };
  expect(world.pickups.touch(world.offer, callbacks)).toBe("accepted");
  expect([grants, eligibility, completions, fallbacks]).toEqual([1, 1, 1, 0]);
  expect(world.pickups.assertIdle()).toBeUndefined();
  world.actors.close();
});

test("unmapped source armor refuses without changing hidden primary armor, and disable restores primary behavior", () => {
  const world = fixture(), settled: boolean[] = [];
  let native = 0;
  const close = world.bind([]), callbacks = { original: () => { native++; return true; }, complete: (taken: boolean) => { settled.push(taken); } };
  expect(world.pickups.touch(world.offer, callbacks)).toBe("refused");
  expect(native).toBe(0); expect(settled).toEqual([false]);
  close();
  expect(world.combat.read(world.player.id)?.armor.regular).toMatchObject({ points: 17 });
  expect(world.pickups.touch(world.offer, callbacks)).toBe("accepted");
  expect(native).toBe(1); expect(settled).toEqual([false, true]);
  world.actors.close();
});

test("disabling the selected binding during its source grant cancels map continuation without a second grant", () => {
  const world = fixture();
  let completed = false, fallback = false;
  const close = world.bind([{ id: "close", offered: [world.offer.item], take: () => { close(); return "accepted"; } }]);
  expect(world.pickups.touch(world.offer, { original: () => { fallback = true; return true; }, complete: () => { completed = true; } })).toBe("stale");
  expect(completed).toBe(false); expect(fallback).toBe(false);
  world.actors.close();
});

test("inventory grant delegates require admitted storage and preserve signed authored count overrides", () => {
  const world = fixture();
  const rule: OriginalPickupRule = { id: "shells", offered: ["q2:ammo_shells"], take: offer => {
    expect(offer.count).toEqual({ kind: "override", amount: -1 });
    world.inventory.configure(world.player, { item: "q1:ammo/shells", count: 13, capacity: 100 });
    return "accepted";
  } };
  expect(() => world.inventory.bindPickup(world.player, { owner: "mod:ammo", item: "mod:missing", rules: [rule] })).toThrow("not admitted");
  const close = world.inventory.bindPickup(world.player, { owner: "mod:ammo", item: "q1:ammo/shells", rules: [rule] });
  expect(() => world.inventory.bindPickup(world.player, { owner: "mod:second", item: "q1:ammo/shells", rules: [rule] })).toThrow("grant owner");
  const offer: OriginalPickupOffer = { ...world.offer, item: "q2:ammo_shells", defaultResource: { kind: "inventory", item: "q1:ammo/shells" }, count: { kind: "override", amount: -1 } };
  expect(world.pickups.touch(offer, { original: () => { throw new Error("Unexpected fallback"); }, complete: taken => { expect(taken).toBe(true); } })).toBe("accepted");
  expect(world.inventory.count(world.player.id, "q1:ammo/shells")).toBe(13);
  // A delegate owns its exact offered IDs, while the primary still owns all storage and other grants.
  expect(world.pickups.touch({ ...offer, item: "q1:ammo/shells" }, { original: () => true, complete: () => {} })).toBe("accepted");
  close(); close(); world.actors.close();
});

test("ambiguous grants and unsupported objective replacements reject before original mutation", () => {
  const world = fixture();
  let calls = 0;
  const rule: OriginalPickupRule = { id: "same", offered: [world.offer.item], take: () => { calls++; return "accepted"; } };
  world.bind([rule]);
  const close = world.inventory.bindPickup(world.player, { owner: "mod:ammo", item: "q1:ammo/shells", rules: [rule] });
  const callbacks = { original: () => true, complete: () => { throw new Error("Unexpected continuation"); } };
  expect(() => world.pickups.touch(world.offer, callbacks)).toThrow("Multiple original pickup owners");
  close();
  expect(() => world.pickups.touch({ ...world.offer, grant: "map-coupled" }, callbacks)).toThrow("requires its map lifecycle");
  expect(calls).toBe(0); world.actors.close();
});

test("pickup tier and quantity stores advance an already active original damage cursor before later stores", () => {
  const world = fixture(), zero = { x: 0, y: 0, z: 0 };
  world.bind([{ id: "upgrade", offered: [world.offer.item], take: (_offer, observer) => {
    expect(() => world.combat.assertIdle()).toThrow("pickup execution");
    const before = world.armor.value;
    world.armor.value = { kind: "source", item: "mod:red", points: 80 };
    observer.stored({ regular: { before, after: world.armor.value } });
    world.combat.setHealth(world.player, 95);
    return "accepted";
  } }]);
  const request: DamageRequest = { target: world.player.id, amount: 5, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
    attack: { sequence: 1, time: { kind: "seconds", value: 3 }, attacker: null, inflictor: null, weapon: "q1:rocket", weaponProvider: "q1:weapons",
      combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement", cause: { kind: "q1", deathType: "rocket" } } };
  const result = world.combat.runSourceDamage(request, () => {
    expect(world.pickups.touch(world.offer, { original: () => false, complete: () => {} })).toBe("accepted");
    return { appliedDamage: 5, reaction: "none" };
  });
  if (result.kind !== "committed") throw new Error("Source target disappeared");
  expect(result.decision.mutations.map(change => change.kind)).toEqual(["armor", "health"]);
  expect(world.combat.read(world.player.id)).toMatchObject({ health: 95, armor: { regular: { item: "mod:red", points: 80 } } });
  world.actors.close();
});
