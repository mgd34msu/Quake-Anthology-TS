import { expect, test } from "bun:test";
import type { DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner, type ActorId } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable } from "../../../src/world/actors/callbacks.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { ModOperation } from "../../../src/world/gameplay/mod-composition.ts";
import { createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/policies.ts";

test("source inventory stores publish normalized values before reentrant observers", () => {
  const { actors, target } = world(), inventory = new SharedInventoryTable(actors), seen: string[] = [];
  const item = { item: "q2:cells", count: 40, capacity: 50 } satisfies import("../../../src/contracts/gameplay.ts").InventoryEntry;
  inventory.create(target, [item]);
  const stopTransform = inventory.operations.configure.register({ provider: "q1:mod", id: "fuel:transform", order: 0, kind: "transform",
    transform: ([actor, entry]) => [actor, { ...entry, count: entry.count - 1 }] });
  let nested = false;
  const stopObserve = inventory.operations.configure.register({ provider: "q3:mod", id: "fuel:observe", order: 0, kind: "observe", observe: () => {
    seen.push(`observe:${inventory.count(target.id, item.item)}`);
    if (!nested) { nested = true; inventory.configure(target, { ...item, count: 20 }, change => {
      seen.push(`inner:${change.before?.count}:${change.after.count}`); return undefined;
    }); }
    return undefined;
  } });
  inventory.configure(target, { ...item, count: 30 }, change => {
    expect(inventory.count(target.id, item.item)).toBe(change.after.count);
    seen.push(`outer:${change.before?.count}:${change.after.count}`); return undefined;
  });
  expect(seen).toEqual(["outer:40:29", "observe:29", "inner:29:19", "observe:19"]);
  expect(inventory.count(target.id, item.item)).toBe(19);
  stopTransform(); stopObserve();
  let observed = false;
  inventory.operations.configure.register({ provider: "q1:mod", id: "fuel:cancel", order: 0, kind: "replace", replace: () => undefined });
  inventory.operations.configure.register({ provider: "q3:mod", id: "fuel:after", order: 0, kind: "observe", observe: () => { observed = true; return undefined; } });
  expect(() => inventory.configure(target, item, () => undefined)).toThrow("requires its canonical store");
  expect(observed).toBe(false); expect(inventory.count(target.id, item.item)).toBe(19);
  inventory.configure(target, item); expect(observed).toBe(true);
});

test("mod operations order transforms and observers around one replaceable canonical call", () => {
  const operation = new ModOperation<number, number>("test.amount"), calls: string[] = [];
  operation.register({ provider: "q1:mod", id: "scale:amount", order: 2, kind: "transform", transform: amount => { calls.push("scale"); return amount * 2; } });
  operation.register({ provider: "q3:mod", id: "offset:amount", order: 1, kind: "transform", transform: amount => { calls.push("offset"); return amount + 3; } });
  const remove = operation.register({ provider: "q2:mod", id: "replace:amount", order: 0, kind: "replace", replace: (amount, next) => next(amount + 1) });
  operation.register({ provider: "q1:mod", id: "report:amount", order: 2, kind: "observe", observe: (amount, result) => { calls.push(`second:${amount}:${result}`); return undefined; } });
  operation.register({ provider: "q3:mod", id: "report:amount", order: 1, kind: "observe", observe: (amount, result) => { calls.push(`first:${amount}:${result}`); return undefined; } });
  expect(operation.dispatch(4, amount => { calls.push("canonical"); return amount; })).toBe(15);
  expect(calls).toEqual(["offset", "scale", "canonical", "first:15:15", "second:15:15"]);
  expect(() => operation.register({ provider: "q3:other", id: "replace:amount", order: 0, kind: "replace", replace: amount => amount })).toThrow("q2:mod/replace:amount and q3:other/replace:amount");
  expect(() => operation.register({ provider: "q1:mod", id: "scale:amount", order: 0, kind: "transform", transform: amount => amount })).toThrow("Duplicate mod registration");
  remove(); remove();
  const replacement = operation.register({ provider: "q2:mod", id: "replace:amount", order: 0, kind: "replace", replace: amount => amount + 2 });
  remove();
  expect(operation.dispatch(4, () => { throw new Error("Replacement must suppress the canonical call"); })).toBe(16);
  replacement(); operation.clear();
  expect(operation.active).toBe(false);
  expect(operation.dispatch(4, amount => amount)).toBe(4);
});

test("registration changes take effect safely during nested operation dispatch", () => {
  const operation = new ModOperation<number, number>("test.reentry"), calls: string[] = [];
  let nested = false;
  const remove = operation.register({ provider: "q2:mod", id: "later:transform", order: 2, kind: "transform", transform: amount => { calls.push("removed"); return amount; } });
  operation.register({ provider: "q1:mod", id: "nested:transform", order: 1, kind: "transform", transform: amount => {
    if (!nested) {
      nested = true; remove();
      operation.register({ provider: "q3:mod", id: "new:observer", order: 0, kind: "observe", observe: (_request, result) => { calls.push(`new:${result}`); return undefined; } });
      expect(operation.dispatch(2, value => { calls.push(`inner:${value}`); return value; })).toBe(2);
    }
    return amount;
  } });
  expect(operation.dispatch(1, value => { calls.push(`outer:${value}`); return value; })).toBe(1);
  expect(calls).toEqual(["inner:2", "new:2", "outer:1"]);
});

test("replacement continuations cannot repeat mutation or escape synchronous dispatch", () => {
  const operation = new ModOperation<number, number>("test.once");
  let mutations = 0;
  const retained: { next: ((value: number) => number) | null } = { next: null };
  const remove = operation.register({ provider: "q1:mod", id: "repeat:replace", order: 0, kind: "replace", replace: (value, next) => { next(value); return next(value); } });
  expect(() => operation.dispatch(1, value => { mutations++; return value; })).toThrow("already called");
  expect(mutations).toBe(1); remove();
  operation.register({ provider: "q3:mod", id: "retain:replace", order: 0, kind: "replace", replace: (value, next) => { retained.next = next; return next(value); } });
  expect(operation.dispatch(2, value => { mutations++; return value; })).toBe(2);
  const next = retained.next; if (next === null) throw new Error("Missing continuation");
  expect(() => next(3)).toThrow("closed"); expect(mutations).toBe(2);
  operation.clear();
  operation.register({ provider: "q2:mod", id: "catch:replace", order: 0, kind: "replace", replace: (value, next) => { try { next(value); } catch {} return value; } });
  expect(() => operation.dispatch(3, () => { throw new Error("Mutation failed"); })).toThrow("Mutation failed");
});

function request(target: ActorId, amount: number, sequence = 1): DamageRequest {
  const zero = { x: 0, y: 0, z: 0 };
  return { target, amount, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
    attack: { sequence, time: { kind: "seconds", value: 1 }, attacker: null, inflictor: null, weapon: "q3:weapon/railgun",
      weaponProvider: "q3:weapons", combatProvider: "q1:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement", cause: { kind: "q3", meansOfDeath: 10, damageFlags: 0 } } };
}

function world() {
  const actors = new SessionActorRegistry(createIdentityOwner("mod-composition")), callbacks = new ActorCallbackTable(actors), outcomes: DamageOutcome[] = [];
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: () => ({ arithmetic: "binary32", quad: false, teamplay: 0, walk: false, momentumDirection: null }),
    armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary32", q2: { product: "classic", ctf: false, alive: true } })) }));
  const target = actors.allocate("q2:game", "q2:monster");
  combat.create(target, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  return { actors, callbacks, combat, target, outcomes };
}

test("mixed mod damage, actor reactions and inventory compose on the real authoritative stores", () => {
  const { actors, callbacks, combat, target, outcomes } = world(), inventory = new SharedInventoryTable(actors), observed: number[] = [];
  inventory.create(target, [{ item: "q2:cells", count: 0, capacity: 50 }]);
  combat.damageOperation.register({ provider: "q3:mod", id: "scale:damage", order: 1, kind: "transform", transform: input => ({ ...input, amount: input.amount * 2 }) });
  combat.damageOperation.register({ provider: "q1:mod", id: "observe:damage", order: 2, kind: "observe", observe: (_input, outcome) => {
    observed.push(combat.read(target.id)?.health ?? -1);
    if (outcome.kind === "committed" && outcome.decision.request.attack.sequence === 1) combat.apply(request(target.id, 3, 2));
    return undefined;
  } });
  inventory.operations.give.register({ provider: "q2:mod", id: "bonus:inventory", order: 0, kind: "transform", transform: ([actor, item, count]) => [actor, item, count + 2] });
  callbacks.operations.pain.register({ provider: "q3:mod", id: "reward:pain", order: 0, kind: "observe", observe: ([reaction], called) => {
    if (called) inventory.give(reaction.self, "q2:cells", 1);
    return undefined;
  } });
  const pains: number[] = [];
  callbacks.bind(target, { think: null, touch: null, use: null, die: null, pain: reaction => {
    expect(callbacks.current?.self).toBe(target); pains.push(reaction.damage); return undefined;
  } });
  combat.apply(request(target.id, 5));
  expect(combat.read(target.id)?.health).toBe(84); expect(outcomes).toHaveLength(2);
  expect(observed).toEqual([90, 84]); expect(pains).toEqual([10, 6]); expect(inventory.count(target.id, "q2:cells")).toBe(6);
  expect(callbacks.current).toBeNull(); actors.close();
});

test("actor removal during a transform prevents the owner callback and canonical damage", () => {
  const { actors, callbacks, combat, target } = world();
  let invoked = 0;
  callbacks.bind(target, { think: null, touch: null, pain: null, die: null, use: () => { invoked++; return undefined; } });
  callbacks.operations.use.register({ provider: "q1:mod", id: "remove:use", order: 0, kind: "transform", transform: input => { actors.release(input[0]); return input; } });
  expect(callbacks.use(target, null, null)).toBe(false); expect(invoked).toBe(0);
  expect(callbacks.use(target, null, null)).toBe(false);
  expect(combat.apply(request(target.id, 5)).kind).toBe("stale-target"); actors.close();
});

test("source-owned damage consumes transformed arguments once and keeps nested calls distinct", () => {
  const { actors, combat, target } = world();
  let transforms = 0, observations = 0;
  combat.damageOperation.register({ provider: "q1:mod", id: "scale:damage", order: 0, kind: "transform", transform: input => { transforms++; return { ...input, amount: input.amount * 2 }; } });
  combat.damageOperation.register({ provider: "q2:mod", id: "observe:damage", order: 0, kind: "observe", observe: () => { observations++; return undefined; } });
  combat.bindDamageAdmission(target, input => {
    combat.runSourceDamage(input, (_observer, effective) => {
      const before = combat.read(target.id)?.health;
      if (before === undefined) throw new Error("Missing source health");
      combat.setHealth(target, before - effective.amount);
      return { appliedDamage: effective.amount, reaction: "none" };
    });
    return "handled";
  });
  combat.apply(request(target.id, 4));
  expect(combat.read(target.id)?.health).toBe(92); expect(transforms).toBe(1); expect(observations).toBe(1);
  combat.runSourceDamage(request(target.id, 3, 2), (_observer, effective) => {
    const before = combat.read(target.id)?.health;
    if (before === undefined) throw new Error("Missing source health");
    combat.setHealth(target, before - effective.amount);
    return { appliedDamage: effective.amount, reaction: "none" };
  });
  expect(combat.read(target.id)?.health).toBe(86); expect(transforms).toBe(2); expect(observations).toBe(2); actors.close();
});
