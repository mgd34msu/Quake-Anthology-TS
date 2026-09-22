import { expect, test } from "bun:test";
import type { ArmorStageInput, ArmorStageObserver, ArmorState, CombatPolicy, CombatState, DamageOutcome, DamageRequest, PoweredProtectionState } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import type { PoweredProtectionBinding, SourcePoweredArmorStage } from "../../../src/world/gameplay/authority.ts";
import { attackDamageFlags } from "../../../src/world/gameplay/armor.ts";
import { createQ1CombatPolicy, createQ2CombatPolicy, createQ3CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/policies.ts";

const regular: ArmorState["regular"] = { kind: "q1", points: 100, absorption: 0.5, item: "q1:armor" };
const zero = { x: 0, y: 0, z: 0 };
const armor = nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" }));
const policies: readonly CombatPolicy[] = [
  createQ1CombatPolicy({ id: "q1:combat", armor, context: () => ({ arithmetic: "binary64", quad: false, teamplay: 0, walk: true, momentumDirection: zero }) }),
  createQ2CombatPolicy({ id: "q2:combat", armor, context: () => ({ arithmetic: "binary64", player: true, monster: false, attackerPlayer: true, hasEnemy: false,
    easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false,
    noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }) }),
  createQ3CombatPolicy({ id: "q3:combat", armor, context: () => ({ player: true, attackerPlayer: true, attackerMaxHealth: 100, attackerGuard: false,
    intermission: false, noclip: false, missionpackInvulnerability: false, noKnockback: false, knockbackScale: 1000, friendlyFire: true,
    battlesuit: false, falling: false, juiced: false, proximityProtected: false, product: "baseq3" }) }),
];

function fixture(policy: CombatPolicy) {
  const actors = new SessionActorRegistry(createIdentityOwner("power stage"));
  const target = actors.allocate("q1:player", "q1:player"), attacker = actors.allocate("q3:player", "q3:player");
  const outcomes: DamageOutcome[] = [];
  let primary: CombatState = { health: 100, armor: { regular, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null };
  const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: result => { outcomes.push(result); return undefined; },
  });
  const binding = { read: () => primary, writeHealth: (health: number): undefined => { primary = { ...primary, health }; return undefined; },
    writeArmor: (armor: ArmorState): undefined => { primary = { ...primary, armor }; return undefined; } };
  authority.bind(target, binding); authority.create(attacker, primary); authority.register(policy);
  const request = (sequence = 1, amount = 30): DamageRequest => ({ target: target.id, amount, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
    attack: { sequence, time: { kind: "milliseconds", value: 100 }, attacker: attacker.id, inflictor: attacker.id, weapon: "q3:rocket", weaponProvider: "q3:weapons",
      combatProvider: policy.id, inventoryProvider: "q1:inventory", movementProvider: "q1:movement", cause: { kind: "q3", damageFlags: 0, meansOfDeath: 1 } } });
  const fuel: { state: PoweredProtectionState } = { state: { kind: "shield", cells: 12 } };
  const power = (absorb: PoweredProtectionBinding["absorb"]): PoweredProtectionBinding => ({ owner: "mod:power", rule: "original-leaf", admission: { kind: "claim" }, fuelItems: ["q2:cells"],
    read: () => fuel.state, validateWrite: () => undefined, write: next => { fuel.state = next; return undefined; }, absorb });
  return { actors, target, attacker, authority, binding, primary: () => primary, fuel, power, outcomes, request };
}

test("each combat family spends independent power once before foreign regular armor and preserves primary storage", () => {
  for (const policy of policies) {
    const world = fixture(policy);
    let calls = 0;
    const remove = world.authority.bindPoweredProtection(world.target, world.power((input, observer) => {
      calls++; expect(input.amount).toBe(30); expect(() => world.authority.assertIdle()).toThrow("during combat");
      const before = world.fuel.state; world.fuel.state = { kind: "shield", cells: 9 };
      observer.stored({ before, after: world.fuel.state });
      return { saved: 7 };
    }));
    expect(world.authority.poweredProtectionFuelItems(world.target)).toEqual(["q2:cells"]);
    const result = world.authority.apply(world.request());
    if (result.kind !== "committed") throw new Error("Target disappeared");
    expect(calls).toBe(1); expect(world.outcomes).toHaveLength(1);
    expect(result.decision.appliedDamage).toBe(11);
    expect(world.authority.read(world.target.id)?.armor).toEqual({ regular: { ...regular, points: 88 }, powered: { kind: "shield", cells: 9 } });
    expect(world.primary().armor.powered).toEqual({ kind: "none" });
    expect(result.decision.mutations.filter(value => value.kind === "armor")).toHaveLength(2);
    world.authority.setRegularPoints(world.target, 83);
    expect(world.fuel.state).toEqual({ kind: "shield", cells: 9 });
    remove(); remove();
    expect(world.authority.poweredProtectionOwner(world.target)).toBeNull();
    expect(world.authority.read(world.target.id)?.armor).toEqual({ regular: { ...regular, points: 83 }, powered: { kind: "none" } });
    expect(world.authority.assertIdle()).toBeUndefined(); world.actors.close();
  }
});

test("nested powered damage advances outer cursors without copying nested stores into the outer hit", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy), escaped: { observer: ArmorStageObserver | null } = { observer: null };
  world.authority.bindPoweredProtection(world.target, world.power((input, observer) => {
    if (input.request.attack.sequence === 1) {
      world.authority.apply(world.request(2, 10));
      expect(world.authority.read(world.target.id)?.health).toBe(97);
      expect(world.authority.read(world.target.id)?.armor.regular).toEqual({ ...regular, points: 96 });
    }
    const before = world.fuel.state;
    if (before.kind === "none") throw new Error("Missing cells");
    world.fuel.state = { ...before, cells: before.cells - (input.request.attack.sequence === 1 ? 2 : 1) };
    observer.stored({ before, after: world.fuel.state }); escaped.observer = observer;
    return { saved: input.request.attack.sequence === 1 ? 6 : 3 };
  }));
  const outcome = world.authority.apply(world.request());
  if (outcome.kind !== "committed") throw new Error("Target disappeared");
  expect(world.authority.read(world.target.id)?.health).toBe(85);
  expect(world.authority.read(world.target.id)?.armor).toEqual({ regular: { ...regular, points: 84 }, powered: { kind: "shield", cells: 9 } });
  expect(world.outcomes.map(value => value.kind === "committed" ? value.decision.request.attack.sequence : -1)).toEqual([2, 1]);
  expect(outcome.decision.mutations.filter(value => value.kind === "armor")).toHaveLength(2);
  expect(outcome.decision.mutations.filter(value => value.kind === "health")).toEqual([{ kind: "health", before: 97, after: 85 }]);
  const observer = escaped.observer; if (observer === null) throw new Error("Missing observer");
  expect(() => observer.stored({ before: world.fuel.state, after: world.fuel.state })).toThrow("observer is closed");
  world.actors.close();
});

test("disabling power during absorption exposes primary armor and invalidates the removed observer", () => {
  for (const policy of policies) {
    const world = fixture(policy);
    const remove = world.authority.bindPoweredProtection(world.target, world.power((_input, observer) => {
      const before = world.fuel.state;
      world.fuel.state = { kind: "shield", cells: 10 };
      observer.stored({ before, after: world.fuel.state });
      remove();
      expect(() => observer.stored({ before: world.fuel.state, after: world.fuel.state })).toThrow("owner was removed");
      return { saved: 6 };
    }));
    const result = world.authority.apply(world.request());
    if (result.kind !== "committed") throw new Error("Target disappeared");
    expect(world.authority.read(world.target.id)?.health).toBe(88);
    expect(world.authority.read(world.target.id)?.armor).toEqual({ regular: { ...regular, points: 88 }, powered: { kind: "none" } });
    expect(result.decision.mutations.filter(value => value.kind === "armor")).toHaveLength(3);
    expect(world.outcomes).toHaveLength(1);
    world.actors.close();
  }
});

test("power reservations reject ownership and unsupported primary stages before reading a component", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy);
  const power = world.power(() => ({ saved: 0 }));
  world.authority.rebind(world.target, { ...world.binding, poweredProtectionOwner: "q1:primary" });
  expect(() => world.authority.reservePoweredProtection(world.target, power)).toThrow("primary ownership");
  const replacement: PoweredProtectionBinding = { ...power, admission: { kind: "replace-primary", owner: "q1:primary" } };
  const reservation = world.authority.reservePoweredProtection(world.target, replacement);
  expect(world.authority.poweredProtectionOwner(world.target)).toBe("mod:power");
  expect(() => world.authority.poweredProtectionFuelItems(world.target)).toThrow("has not been bound");
  expect(() => world.authority.reservePoweredProtection(world.target, { ...replacement, owner: "mod:second" })).toThrow("component owner");
  reservation.close();
  expect(world.authority.poweredProtectionFuelItems(world.target)).toEqual([]);
  world.authority.rebind(world.target, { ...world.binding, sourceDamage: request => ({ kind: "stale-target", request }) });
  expect(() => world.authority.reservePoweredProtection(world.target, power)).toThrow("no declared powered armor stage");
  world.authority.rebind(world.target, world.binding);
  const pending = world.authority.reservePoweredProtection(world.target, power);
  world.actors.release(world.target);
  expect(() => pending.bind(power)).toThrow(); pending.close(); world.actors.close();
});

test("whole armor writes validate both owners before changing either layer", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy);
  world.authority.bindPoweredProtection(world.target, { ...world.power(() => ({ saved: 0 })),
    validateWrite: value => { if (value.kind === "screen") throw new Error("Unsupported source selection"); return undefined; } });
  expect(() => world.authority.setArmor(world.target, { regular: { ...regular, points: 50 }, powered: { kind: "screen", cells: 1 } })).toThrow("Unsupported source selection");
  expect(world.authority.read(world.target.id)?.armor).toEqual({ regular, powered: { kind: "shield", cells: 12 } });
  world.actors.close();
});

test("powered writes preserve nested regular changes and stop pending stores after retirement", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy);
  let retire = false;
  world.authority.bindPoweredProtection(world.target, { ...world.power(() => ({ saved: 0 })), write: next => {
    world.fuel.state = next;
    if (retire) { world.actors.release(world.target); return undefined; }
    world.authority.setRegularPoints(world.target, 80);
    world.authority.setHealth(world.target, 91);
    return undefined;
  } });
  expect(() => world.authority.setArmor(world.target, { regular: { ...regular, points: 50 }, powered: { kind: "shield", cells: 7 } })).toThrow("regular armor changed");
  expect(world.authority.read(world.target.id)?.armor).toEqual({ regular: { ...regular, points: 80 }, powered: { kind: "shield", cells: 7 } });
  expect(world.authority.read(world.target.id)?.health).toBe(91);
  world.authority.setRegularPoints(world.target, 60);
  world.authority.setPoweredProtection(world.target, { kind: "shield", cells: 6 });
  expect(world.authority.read(world.target.id)?.armor.regular).toEqual({ ...regular, points: 80 });
  retire = true;
  expect(() => world.authority.setArmor(world.target, { regular: { ...regular, points: 50 }, powered: { kind: "shield", cells: 5 } })).toThrow();
  expect(world.primary().armor.regular).toEqual({ ...regular, points: 80 });
  world.actors.close();
});

test("original source power interception shares one hit and composes only primary regular observations", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy);
  const entry: { call: Parameters<SourcePoweredArmorStage["bind"]>[0] | null } = { call: null };
  let originalCalls = 0;
  world.authority.rebind(world.target, { ...world.binding, poweredProtectionOwner: "q1:primary", poweredArmorStage: {
    bind: callback => { entry.call = callback; return () => { entry.call = null; return undefined; }; },
  }, sourceDamage: input => world.authority.runSourceDamage(input, (observer, request) => {
    const stage: ArmorStageInput = { request, geometry: request, amount: request.amount, flags: attackDamageFlags(request) };
    const original = (): number => { originalCalls++; return 0; };
    const saved = entry.call === null ? original() : entry.call(stage, original);
    const before = world.primary().armor;
    world.binding.writeArmor({ ...before, regular: { ...regular, points: 98 } });
    observer.stored({ kind: "armor", before, after: world.primary().armor });
    // An unchanged hidden-primary powered store is not another effective mutation.
    observer.stored({ kind: "armor", before: world.primary().armor, after: world.primary().armor });
    const health = world.primary().health, take = request.amount - saved - 2;
    world.binding.writeHealth(health - take); observer.stored({ kind: "health", before: health, after: health - take });
    const result = { appliedDamage: take, reaction: "pain" } satisfies { appliedDamage: number; reaction: "pain" };
    observer.beforeReaction(result); return result;
  }) });
  const remove = world.authority.bindPoweredProtection(world.target, { ...world.power((_input, observer) => {
    const before = world.fuel.state; world.fuel.state = { kind: "shield", cells: 10 }; observer.stored({ before, after: world.fuel.state }); return { saved: 7 };
  }), admission: { kind: "replace-primary", owner: "q1:primary" } });
  const result = world.authority.apply(world.request());
  if (result.kind !== "committed") throw new Error("Target disappeared");
  expect(result.decision.appliedDamage).toBe(21); expect(originalCalls).toBe(0); expect(world.outcomes).toHaveLength(1);
  expect(result.decision.mutations.map(value => value.kind)).toEqual(["armor", "armor", "health"]);
  remove(); expect(entry.call).toBeNull(); world.authority.apply(world.request(2)); expect(originalCalls).toBe(1);
  world.actors.close();
});

test("removed targets retain committed stores, and missing source observations fail with closed capabilities", () => {
  const policy = policies[0]; if (policy === undefined) throw new Error("Missing Q1 policy");
  const world = fixture(policy);
  const remove = world.authority.bindPoweredProtection(world.target, world.power((_input, observer) => {
    const before = world.fuel.state; world.fuel.state = { kind: "shield", cells: 8 }; observer.stored({ before, after: world.fuel.state });
    world.actors.release(world.target); return { saved: 7 };
  }));
  const result = world.authority.apply(world.request());
  expect(result.kind === "committed" && result.decision.mutations.map(value => value.kind)).toEqual(["armor"]);
  expect(result.kind === "committed" && result.decision.reaction).toBe("none");
  expect(world.outcomes).toHaveLength(1); remove(); world.actors.close();
  const invalid = fixture(policy);
  invalid.authority.bindPoweredProtection(invalid.target, invalid.power(() => { invalid.fuel.state = { kind: "shield", cells: 1 }; return { saved: 6 }; }));
  expect(() => invalid.authority.apply(invalid.request())).toThrow("omitted a committed armor observation");
  expect(invalid.outcomes).toHaveLength(0); expect(invalid.authority.assertIdle()).toBeUndefined(); invalid.actors.close();
  const health = fixture(policy);
  health.authority.bindPoweredProtection(health.target, health.power(() => { health.binding.writeHealth(99); return { saved: 6 }; }));
  expect(() => health.authority.apply(health.request())).toThrow("changed health without damage observation");
  expect(health.outcomes).toHaveLength(0); expect(health.authority.assertIdle()).toBeUndefined(); health.actors.close();
});
