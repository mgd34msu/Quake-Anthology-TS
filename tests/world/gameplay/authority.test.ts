import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { ArmorState, CombatState, DamageRequest } from "../../../src/contracts/gameplay.ts";
import type { BodyState } from "../../../src/contracts/world.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { SparseGuestMemory } from "../../../src/guest/core/memory.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, SourceActorSlots, quakeEdictLifetime, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, SharedTransitionCoordinator, absorbNativeArmor, createQ1CombatPolicy, createQ2CombatPolicy, createQ3CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import type { Q2CombatContext, Q3CombatContext } from "../../../src/world/gameplay/index.ts";

const emptyArmor: ArmorState = { kind: "none" };
const origin = { x: 0, y: 0, z: 0 };
const initialBody: BodyState = { origin, angles: origin, velocity: origin, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null };
const q3Context: Q3CombatContext = { player: true, attackerPlayer: true, attackerMaxHealth: 100, attackerGuard: false, intermission: false, noclip: false,
  missionpackInvulnerability: false, noKnockback: false, knockbackScale: 1000, friendlyFire: true, battlesuit: false, falling: false,
  juiced: false, proximityProtected: false, product: "baseq3" };
const q2Context: Q2CombatContext = { arithmetic: "binary64", player: true, monster: false, attackerPlayer: true, hasEnemy: false,
  easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false,
  noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false };

function state(health = 100, armor: ArmorState = emptyArmor): CombatState {
  return { health, armor, mass: 200, canTakeDamage: true, invulnerable: false, team: null };
}

function attack(target: ActorId, attacker: ActorId, sequence = 1, amount = 40): DamageRequest {
  return { attack: { sequence, time: { kind: "milliseconds", value: 100 }, attacker, inflictor: attacker, weapon: "q1:rocket",
    weaponProvider: "q1:weapons", combatProvider: "q3:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement", cause: { kind: "q1", deathType: "rocket" } },
    target, amount, knockback: amount, direction: { x: 1, y: 0, z: 0 }, point: origin, normal: origin, delivery: "direct" };
}

describe("shared actor and gameplay authority", () => {
  test("level travel and same-session loading cannot alias prior actor generations", () => {
    const identity = createIdentityOwner("travel");
    const before = new SessionActorRegistry(identity);
    const released = before.allocate("q1:game", "q1:projectile-owner");
    before.release(released);
    const prior = before.allocateAtSource("q1:game", 7, "q1:player");
    const priorOtherSlot = before.allocate("q1:game", "q1:old-monster");
    const checkpoint = before.checkpoint(), sources = before.sourceCheckpoint();
    before.close();
    const after = new SessionActorRegistry(identity);
    const next = after.allocateAtSource("q1:game", 7, "q1:player");
    expect(after.session).toBe(before.session);
    expect(after.isLive(prior.id)).toBe(false);
    expect(next.id.equals(prior.id)).toBe(false);
    const traveledSave = SessionActorRegistry.restore(createIdentityOwner("traveled-save"), after.checkpoint(), after.sourceCheckpoint());
    expect(traveledSave.isLive(traveledSave.referenceSaved({ slot: priorOtherSlot.id.slot, generation: priorOtherSlot.id.generation }))).toBe(false);
    traveledSave.close();
    const concurrent = new SessionActorRegistry(identity);
    const third = concurrent.allocate("q1:game", "q1:player");
    expect(after.isLive(third.id)).toBe(false);
    const restored = SessionActorRegistry.restore(identity, checkpoint, sources);
    const loaded = restored.resolveSaved({ slot: prior.id.slot, generation: prior.id.generation });
    expect(loaded).toBe(restored.atSource("q1:game", 7));
    expect(loaded?.id.equals(prior.id)).toBe(false);
    expect(loaded?.id.equals(next.id)).toBe(false);
    expect(loaded?.id.equals(third.id)).toBe(false);
    expect(restored.sourceOf(loaded?.id ?? prior.id)?.slot).toBe(7);
    const historical = restored.referenceSaved({ slot: released.id.slot, generation: released.id.generation });
    expect(restored.isLive(historical)).toBe(false);
    expect(historical.equals(released.id)).toBe(false);
    expect(restored.referenceSaved({ slot: released.id.slot, generation: released.id.generation })).toBe(historical);
    const fresh = SessionActorRegistry.restore(createIdentityOwner("fresh-history"), checkpoint, sources);
    expect(fresh.referenceSaved({ slot: released.id.slot, generation: released.id.generation }).generation).toBe(released.id.generation);
    fresh.close();
    after.close(); concurrent.close(); restored.close();
  });
  test("source allocation preserves the cooldown boundary and QW's final-edict overwrite", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("slots"));
    const free = new Uint8Array(3);
    const freedAt = new Float64Array(3);
    let count = 1; let now = 10;
    const unlinked: number[] = [];
    const slots = new SourceActorSlots(actors, { provider: "qw:game", capacity: 3, lifetime: quakeEdictLifetime(1, "qw-last-slot"),
      now: () => ({ kind: "seconds", value: now }), exhausted: () => undefined,
      unlink: actor => { const source = actors.sourceOf(actor.id); if (source !== null) unlinked.push(source.slot); return undefined; },
      storage: { count: () => count, setCount: next => { count = next; return undefined; },
        read: slot => ({ free: free[slot] === 1, freedAt: { kind: "seconds", value: freedAt[slot] ?? 0 } }),
        initialize: slot => { free[slot] = 0; return undefined; },
        clearFreed: (slot, time) => { free[slot] = 1; freedAt[slot] = time.value; return undefined; }, canFree: slot => slot !== 0 } });
    const world = slots.bindExisting(0, "qw:world");
    const first = slots.allocate("qw:rocket");
    const last = slots.allocate("qw:nail");
    slots.free(first);
    now = 10.5;
    const overwrite = slots.allocate("qw:grenade");
    expect(slots.at(2)).toBe(overwrite);
    expect(actors.isLive(last.id)).toBe(false);
    now = 10.5001;
    expect(actors.sourceOf(slots.allocate("qw:rocket").id)?.slot).toBe(1);
    expect(slots.free(world)).toBe(false);
    expect(actors.isLive(world.id)).toBe(true);
    expect(unlinked).toEqual([1, 2, 0]);
  });
  test("source slots resolve reuse while generations and sessions remain isolated", () => {
    const identities = createIdentityOwner("first");
    const first = new SessionActorRegistry(identities);
    const second = new SessionActorRegistry(createIdentityOwner("second"));
    const old = first.allocateAtSource("q2:game", 7, "q2:soldier");
    const other = second.allocateAtSource("q2:game", 7, "q2:soldier");
    expect(first.isLive(other.id)).toBe(false);
    expect(() => first.release(identities.ownedActor(old.id, old.owner))).toThrow("authority");
    first.release(old);
    const replacement = first.allocateAtSource("q2:game", 7, "q2:infantry");
    expect(replacement.id.slot).toBe(old.id.slot);
    expect(first.isLive(old.id)).toBe(false);
    expect(first.atSource("q2:game", 7)).toBe(replacement);
    expect(second.isLive(other.id)).toBe(true);
    const restored = SessionActorRegistry.restore(createIdentityOwner("restore"), first.checkpoint(), first.sourceCheckpoint());
    expect(restored.atSource("q2:game", 7)?.id.generation).toBe(replacement.id.generation);
    expect(restored.isLive(replacement.id)).toBe(false);
    first.close(); second.close(); restored.close();
  });

  test("body field writes leave link bounds unchanged until the next source link", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("body"));
    const links: number[] = [];
    const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
      onLink: body => { links.push(body.linkCount); return undefined; }, onUnlink: () => undefined });
    const actor = actors.allocate("q1:game", "q1:player");
    bodies.create(actor, initialBody); bodies.link(actor);
    bodies.write(actor, { ...initialBody, origin: { x: 100, y: 0, z: 0 } });
    expect(bodies.read(actor.id)?.origin.x).toBe(100);
    expect(bodies.linked(actor.id)?.absoluteBounds.min.x).toBe(-16);
    bodies.link(actor);
    expect(bodies.linked(actor.id)?.absoluteBounds.min.x).toBe(84);
    expect(links).toEqual([1, 2]);
  });

  test("Q1 rocket, Q2 guest victim and Q3 combat commit nested damage once before returning", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("mixed"));
    const callbacks = new ActorCallbackTable(actors);
    const module = { id: "fixture:guest", artifactPath: "authored-fixture", digest: createContentDigest("0".repeat(64)), revision: "1" } satisfies ConstructorParameters<typeof SparseGuestMemory>[0]["module"];
    const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
    const address = memory.allocate({ byteLength: 32 });
    const bytes = memory.borrow(address, 32);
    bytes.setInt32(0, 30, true); bytes.setInt32(4, 30, true); bytes.setUint32(28, 0x12345678, true);
    const target = actors.allocateAtSource("q2:guest", 13, "q2:soldier");
    const attacker = actors.allocate("q1:game", "q1:player");
    const steps: string[] = [];
    let replacement: OwnedActor | null = null;
    const authority = new GameplayAuthority(actors, callbacks, {
      impulse: (_actor, impulse, movement) => { steps.push(`impulse:${impulse.x}:${movement}`); return undefined; },
      beforeReaction: (_actor, result) => { steps.push(`health:${bytes.getInt32(0, true)}:${result.request.attack.sequence}`); return undefined; },
      confirmed: outcome => { if (outcome.kind === "committed") steps.push(`score:${outcome.decision.request.attack.sequence}`); return undefined; },
    });
    authority.create(attacker, state());
    authority.setTraits(attacker, { invulnerable: true });
    expect(authority.read(attacker.id)?.invulnerable).toBe(true);
    const armor = (): ArmorState => ({ kind: "q2", points: bytes.getInt32(4, true), normalProtection: 0.6, energyProtection: 0.3, item: "q2:combat-armor", powerArmor: { kind: "none" } });
    authority.bind(target, { read: () => state(bytes.getInt32(0, true), armor()),
      writeHealth: health => { bytes.setInt32(0, health, true); return undefined; },
      writeArmor: value => { if (value.kind !== "q2") throw new Error("Wrong victim armor"); bytes.setInt32(4, value.points, true); return undefined; } });
    authority.register(createQ3CombatPolicy({ id: "q3:combat", context: () => q3Context, armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "classic", ctf: false, alive: true } })) }));
    callbacks.bind(target, { think: null, touch: null, use: null,
      pain: () => {
        expect(callbacks.current?.kind).toBe("pain");
        authority.apply(attack(target.id, attacker.id, 2, 100));
        expect(callbacks.current?.kind).toBe("pain");
        steps.push("pain-return"); return undefined;
      },
      die: () => {
        expect(callbacks.current?.parent?.kind).toBe("pain");
        actors.release(target);
        replacement = actors.allocateAtSource("q2:guest", 13, "q2:replacement");
        return undefined;
      },
    });
    const outcome = authority.apply(attack(target.id, attacker.id));
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") expect(outcome.survived).toBe(false);
    expect(steps).toEqual(["impulse:200:q1:movement", "health:14:1", "impulse:500:q1:movement", "health:-80:2", "score:2", "pain-return", "score:1"]);
    expect(actors.atSource("q2:guest", 13)).toBe(replacement);
    expect(authority.apply(attack(target.id, attacker.id)).kind).toBe("stale-target");
    expect(callbacks.current).toBeNull();
    expect(bytes.getUint32(28, true)).toBe(0x12345678);
    const restoredMemory = SparseGuestMemory.restore(module, memory.checkpoint());
    const restoredAddress = restoredMemory.pointer(address.byteOffset);
    if (restoredAddress === null) throw new Error("Fixture address is not null");
    expect(restoredMemory.borrow(restoredAddress, 32).getInt32(0, true)).toBe(-80);
    expect(() => restoredMemory.borrow(address, 32)).toThrow();
  });

  test("source protection orders and Q2 power armor stay distinct", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("policies"));
    const target = actors.allocate("q1:game", "q1:player");
    const attacker = actors.allocate("q1:game", "q1:player");
    const q1 = createQ1CombatPolicy({ id: "q1:combat", context: () => ({ arithmetic: "binary32", quad: false, teamplay: 0, walk: true, momentumDirection: { x: 1, y: 0, z: 0 } }), armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary32" })) });
    const protectedState: CombatState = { ...state(100, { kind: "q1", points: 10, absorption: 0.8, item: "q1:red-armor" }), invulnerable: true };
    const result = q1.decide(attack(target.id, attacker.id), protectedState, state());
    expect(result.mutations.map(mutation => mutation.kind)).toEqual(["armor", "impulse"]);
    expect(result.appliedDamage).toBe(0);
    const rogue = createQ1CombatPolicy({ id: "q1:rogue-combat", context: () => ({ arithmetic: "binary32", quad: false, teamplay: 1, baseTeamHealth: false, walk: false, momentumDirection: null }), armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary32" })) });
    expect(rogue.decide(attack(target.id, attacker.id), { ...state(), team: "1" }, { ...state(), team: "1" }).appliedDamage).toBe(40);
    const q2 = createQ2CombatPolicy({ id: "q2:combat", context: () => q2Context, armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "classic", ctf: false, alive: true } })) });
    expect(q2.decide(attack(target.id, attacker.id), protectedState, state()).mutations.map(mutation => mutation.kind)).toEqual(["impulse"]);
    const shield: ArmorState = { kind: "q2", points: 100, normalProtection: 0.6, energyProtection: 0.3, item: "q2:armor", powerArmor: { kind: "shield", cells: 10 } };
    const absorption = absorbNativeArmor(shield, 30, { noArmor: false, noPowerArmor: false, noRegularArmor: false, energy: false }, { screenFacingDot: 1, arithmetic: "binary64", q2: { product: "classic", ctf: false, alive: true } });
    expect([absorption.powerSaved, absorption.regularSaved]).toEqual([20, 6]);
    const rerelease = absorbNativeArmor(shield, 1, { noArmor: false, noPowerArmor: false, noRegularArmor: false, energy: false }, { screenFacingDot: 1, arithmetic: "binary32", q2: { product: "rerelease", ctf: false, alive: true } });
    expect([rerelease.powerSaved, rerelease.regularSaved, rerelease.armor.kind === "q2" && rerelease.armor.powerArmor.kind !== "none" ? rerelease.armor.powerArmor.cells : null]).toEqual([1, 0, 8]);
    expect(q2.decide(attack(target.id, attacker.id), protectedState, state()).feedback).toEqual({ kind: "q2", powerArmor: 0, armor: 40, blood: 0, knockback: 40 });
    expect(q2.decide(attack(target.id, attacker.id, 2, 5), state(100, shield), state()).feedback).toEqual({ kind: "q2", powerArmor: 3, armor: 2, blood: 0, knockback: 5 });
    const inventory = new SharedInventoryTable(actors);
    inventory.create(target, [{ item: "q2:cells", count: 10, capacity: 200 }]);
    const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    authority.create(target, state(100, shield));
    authority.bindPowerArmorCells(target, { read: () => inventory.count(target.id, "q2:cells"), write: count => inventory.configure(target, { item: "q2:cells", count, capacity: 200 }) });
    authority.register(q2);
    inventory.consume(target, "q2:cells", 6);
    const request = attack(target.id, attacker.id, 1, 30);
    authority.apply({ ...request, attack: { ...request.attack, combatProvider: "q2:combat" } });
    expect(inventory.count(target.id, "q2:cells")).toBe(0);
    expect(authority.read(target.id)?.health).toBe(92);
    authority.setTraits(target, { noKnockback: true });
    const fixed = q2.decide(request, authority.read(target.id) ?? state(), state());
    expect(fixed.mutations.some(mutation => mutation.kind === "impulse")).toBe(false);
    expect(fixed.feedback?.knockback).toBe(0);
  });

  test("CTF and LMCTF source stages preserve distinct armor order and native shield cost", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q2-mode-stages"));
    const target = actors.allocate("q1:game", "q1:player"), attacker = actors.allocate("q3:game", "q3:player");
    const shield: ArmorState = { kind: "q2", points: 100, normalProtection: 0.6, energyProtection: 0.3, item: "q2:armor", powerArmor: { kind: "shield", cells: 10 } };
    const armor = nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "classic", ctf: false, alive: true } }));
    const request = attack(target.id, attacker.id, 1, 41);
    const lmctf = createQ2CombatPolicy({ id: "lmctf:combat", context: () => q2Context, armor, sourceEffects: {
      beforeMomentum: (_request, damage) => Math.trunc(Math.fround(damage * 1.75)),
      afterPowerArmor: (_request, take) => Math.trunc(Math.fround(take / 1.75)),
    } });
    const lm = lmctf.decide(request, state(100, shield), state());
    // 41 * 1.75 -> 71; shield saves 20; resistance 51 / 1.75 -> 29; armor saves 18.
    expect(lm.feedback).toEqual({ kind: "q2", powerArmor: 20, armor: 18, blood: 11, knockback: 41 });
    const changed = lm.mutations.find(mutation => mutation.kind === "armor");
    expect(changed?.kind === "armor" && changed.after.kind === "q2" ? changed.after.powerArmor : null).toEqual({ kind: "shield", cells: 0 });
    const surprised = createQ2CombatPolicy({ id: "lmctf:combat", context: () => ({ ...q2Context, monster: true }), armor, sourceEffects: {
      beforeMomentum: (_request, damage) => { expect(damage).toBe(82); return Math.trunc(Math.fround(damage * 1.75)); },
      afterPowerArmor: (_request, take) => Math.trunc(Math.fround(take / 1.75)),
    } });
    expect(surprised.decide(request, state(100, shield), state()).appliedDamage).toBe(28);
    const ctf = createQ2CombatPolicy({ id: "ctf:combat", context: () => q2Context, armor, sourceEffects: {
      beforeMomentum: (_request, damage) => damage * 2,
      afterArmor: (_request, take) => Math.trunc(take / 2),
    } });
    expect(ctf.decide(request, state(100, shield), state()).feedback).toEqual({ kind: "q2", powerArmor: 20, armor: 38, blood: 12, knockback: 41 });
    const regularProtected = createQ2CombatPolicy({ id: "lmctf:combat", context: () => q2Context, armor, sourceEffects: { armorAllowed: () => false } });
    expect(regularProtected.decide(request, state(100, shield), state()).feedback).toEqual({ kind: "q2", powerArmor: 20, armor: 0, blood: 21, knockback: 41 });
    const bothProtected = createQ2CombatPolicy({ id: "ctf:combat", context: () => q2Context, armor, sourceEffects: { powerArmorAllowed: () => false, armorAllowed: () => false } });
    expect(bothProtected.decide(request, state(100, shield), state()).feedback).toEqual({ kind: "q2", powerArmor: 0, armor: 0, blood: 41, knockback: 41 });
    const q1Armor: ArmorState = { kind: "q1", points: 100, absorption: 0.5, item: "q1:armor" };
    expect(lmctf.decide(request, state(100, q1Armor), state()).appliedDamage).toBe(20);
  });

  test("Q2 after-health effects observe committed health and reenter before fresh death selection", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q2-after-health"));
    const callbacks = new ActorCallbackTable(actors);
    const target = actors.allocate("q1:game", "q1:player"), attacker = actors.allocate("q3:game", "q3:player");
    const steps: string[] = [];
    const authority = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    authority.create(target, state(10)); authority.create(attacker, state(200));
    authority.register(createQ2CombatPolicy({ id: "q2:combat", context: () => q2Context,
      armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" })), sourceEffects: {
        afterHealth: (result, current) => {
          steps.push(`health:${current.target()?.health}:${result.request.attack.sequence}`);
          if (result.request.attack.sequence === 1) {
            const health = current.attacker()?.health;
            if (health !== undefined) authority.setHealth(attacker, Math.min(250, health + (result.appliedDamage >> 1)));
            const nested = attack(target.id, attacker.id, 2, 20);
            authority.apply({ ...nested, attack: { ...nested.attack, combatProvider: "q2:combat" } });
          }
          return undefined;
        },
      } }));
    callbacks.bind(target, { think: null, touch: null, use: null, pain: () => { steps.push("pain"); return undefined; },
      die: () => { steps.push(`death:${authority.read(attacker.id)?.health}`); return undefined; } });
    const request = attack(target.id, attacker.id, 1, 4);
    authority.apply({ ...request, attack: { ...request.attack, combatProvider: "q2:combat" } });
    expect(steps).toEqual(["health:6:1", "health:-14:2", "death:202", "death:202"]);
    expect(authority.read(target.id)?.health).toBe(-14);
  });

  test("Q1 empathy reenters after quad and reads the victim again before armor commits", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q1-effects")), callbacks = new ActorCallbackTable(actors);
    const target = actors.allocate("q1:game", "q1:player"), attacker = actors.allocate("q1:game", "q1:player");
    const authority = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    authority.create(target, state(100, { kind: "q1", points: 100, absorption: 0.5, item: "q1:armor" })); authority.create(attacker, state());
    const observed: number[] = [];
    const policy = createQ1CombatPolicy({ id: "q1:combat", context: request => ({ arithmetic: "binary32", quad: request.attack.sequence === 1, teamplay: 0, walk: false, momentumDirection: null }), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 1 })), sourceEffects: {
      afterQuad(request, damage) {
        observed.push(damage);
        if (request.attack.sequence === 1) {
          const reflected = attack(attacker.id, target.id, 2, damage / 2);
          authority.apply({ ...reflected, attack: { ...reflected.attack, combatProvider: "q1:combat" } });
          return { kind: "continue", amount: damage / 2 };
        }
        return { kind: "continue", amount: damage };
      },
    } });
    authority.register(policy);
    callbacks.bind(attacker, { think: null, touch: null, use: null, die: null, pain: () => {
      authority.setHealth(target, 90); authority.setArmor(target, { kind: "q1", points: 3, absorption: 0.5, item: "q1:armor" }); return undefined;
    } });
    const request = attack(target.id, attacker.id, 1, 10);
    authority.apply({ ...request, attack: { ...request.attack, combatProvider: "q1:combat" } });
    expect(observed).toEqual([40, 20]);
    expect([authority.read(attacker.id)?.health, authority.read(target.id)?.health]).toEqual([80, 73]);
    const armor: ArmorState = { kind: "q1", points: 10, absorption: 0.8, item: "q1:armor" };
    const lava = attack(target.id, attacker.id, 3, 18);
    const half = policy.decide({ ...lava, attack: { ...lava.attack, cause: { kind: "q1", deathType: "rogue:super-lava", armorEffect: "half-effectiveness" } } }, state(100, armor), state());
    expect(half.appliedDamage).toBe(10);
    expect(half.mutations.find(mutation => mutation.kind === "armor")?.after).toEqual({ ...armor, points: 2 });
    const bypass = policy.decide({ ...lava, attack: { ...lava.attack, cause: { kind: "q1", deathType: "rogue:lava", armorEffect: "bypass" } } }, state(100, armor), state());
    expect(bypass.appliedDamage).toBe(18); expect(bypass.mutations.some(mutation => mutation.kind === "armor")).toBe(false);
    const earth = createQ1CombatPolicy({ id: "q1:earth", context: () => ({ arithmetic: "binary32", quad: false, teamplay: 0, walk: false, momentumDirection: null }), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 1 })), sourceEffects: { afterArmor: (_request, take) => take * 0.5 } });
    const earthResult = earth.decide({ ...lava, amount: 10 }, state(100, { kind: "q1", points: 30, absorption: 0.5, item: "q1:armor" }), state());
    expect(earthResult.appliedDamage).toBe(2.5);
    expect(earthResult.mutations).toEqual([{ kind: "armor", before: { kind: "q1", points: 30, absorption: 0.5, item: "q1:armor" }, after: { kind: "q1", points: 25, absorption: 0.5, item: "q1:armor" } }, { kind: "health", before: 100, after: 97.5 }]);
  });

  test("Q1 CTF reflection observes committed protection and rereads health after nested pain", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q1-ctf")), callbacks = new ActorCallbackTable(actors);
    const target = actors.allocate("q1:game", "q1:player"), attacker = actors.allocate("q1:game", "q1:player");
    const order: string[] = [];
    const authority = new GameplayAuthority(actors, callbacks, { impulse: actor => { order.push(`impulse:${actor.id.slot}`); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
    authority.create(target, state(100, { kind: "q1", points: 30, absorption: 0.5, item: "q1:armor" })); authority.create(attacker, state());
    authority.register(createQ1CombatPolicy({ id: "q1:combat", context: () => ({ arithmetic: "binary32", quad: false, teamplay: 0, walk: true, momentumDirection: { x: 1, y: 0, z: 0 } }), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 1 })), sourceEffects: {
      armorAllowed: request => request.attack.sequence !== 3,
      beforeHealth(request, damage, victim) {
        if (request.attack.sequence === 1) {
          expect(victim.armor).toEqual({ kind: "q1", points: 10, absorption: 0.5, item: "q1:armor" });
          order.push(`reflect:${damage}`);
          authority.apply({ ...request, target: attacker.id, amount: damage, attack: { ...request.attack, sequence: 2 } });
        }
        return request.attack.sequence !== 3;
      },
    } }));
    callbacks.bind(attacker, { think: null, touch: null, use: null, die: null, pain: () => { order.push("nested-pain"); authority.setHealth(target, 77); return undefined; } });
    const request = attack(target.id, attacker.id, 1, 40);
    authority.apply({ ...request, attack: { ...request.attack, combatProvider: "q1:combat" } });
    expect([authority.read(target.id)?.health, authority.read(attacker.id)?.health]).toEqual([57, 60]);
    expect(order).toEqual([`impulse:${target.id.slot}`, "reflect:40", `impulse:${attacker.id.slot}`, "nested-pain"]);
    authority.apply({ ...request, attack: { ...request.attack, sequence: 3, combatProvider: "q1:combat" } });
    expect(authority.read(target.id)?.health).toBe(57);
    expect(authority.read(target.id)?.armor).toEqual({ kind: "q1", points: 10, absorption: 0.5, item: "q1:armor" });
  });

  test("inventory consumption is immediate and campaign gates own combined travel", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("inventory"));
    const actor = actors.allocate("q2:game", "q2:player");
    const inventory = new SharedInventoryTable(actors);
    inventory.create(actor, [{ item: "q1:rockets", count: 2, capacity: 10 }]);
    expect(inventory.consume(actor, "q1:rockets", 2)).toBe(true);
    expect(inventory.consume(actor, "q1:rockets", 1)).toBe(false);
    expect(inventory.give(actor, "q1:rockets", 20)).toBe(10);
    expect(() => inventory.configure(actor, { item: "q1:rockets", count: -1, capacity: 10 })).toThrow("nonnegative");
    inventory.configure(actor, { item: "q1:nails", count: 1, capacity: 200, countPolicy: { kind: "source-counter", arithmetic: "binary32" } });
    expect(inventory.adjustSourceCounter(actor, "q1:nails", -4)).toBe(-3);
    inventory.configure(actor, { item: "q1:nails", count: -2, capacity: 200 });
    expect(inventory.count(actor.id, "q1:nails")).toBe(-2);
    const copied = actors.allocate("q1:game", "q1:gremlin-clone"); inventory.create(copied, inventory.entries(actor.id));
    expect(inventory.count(copied.id, "q1:nails")).toBe(-2);
    inventory.configure(copied, { item: "q1:nails", count: 16777216, capacity: 200 });
    expect(inventory.adjustSourceCounter(copied, "q1:nails", 1)).toBe(16777216);
    let trips = 0;
    const transitions = new SharedTransitionCoordinator(() => { trips++; return undefined; });
    const mode = { kind: "combined", campaign: "q1:campaign", match: "q3:match", levelAuthority: "campaign-gates", simultaneous: "campaign-first" } satisfies Parameters<typeof transitions.resolve>[0];
    const blocked = transitions.resolve(mode, [
      { kind: "campaign-level", campaign: "q1:campaign", map: "q1:e1m2", spawnPoint: "", gates: [{ objective: "q1:silver-key", satisfied: false }], cause: actor.id },
      { kind: "match-rotation", match: "q3:match", map: "q3:q3dm1" },
    ]);
    expect(blocked).toEqual({ kind: "stay", blocked: ["q1:silver-key"] });
    const travel = transitions.resolve(mode, [{ kind: "campaign-level", campaign: "q1:campaign", map: "q1:e1m2", spawnPoint: "", gates: [], cause: actor.id }]);
    transitions.commit(travel);
    expect(trips).toBe(1);
    expect(() => transitions.commit(travel)).toThrow();
  });
});
