// Core damage/armor/impulse ordering from original combat.qc, g_combat.c, and the TS donors.
// AI, source event accumulation, powerup sounds, obelisks and score rules stay in the owning game provider.
import type { CombatPolicy, CombatState, CurrentCombatState, DamageDecision, DamageMutation, DamagePreparation, DamageRequest } from "../../contracts/gameplay.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import { sameActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { absorbNativeArmor, attackDamageFlags } from "./armor.ts";
import type { VictimArmorContext, VictimArmorPolicy } from "./armor.ts";

interface PolicyOptions<Context> {
  readonly id: ProviderId;
  readonly context: (request: DamageRequest, target: CombatState, attacker: CombatState | null) => Context;
  /** Explicit victim policy permits Q2 armor under Q3 combat without replacing its protection stages. */
  readonly armor: VictimArmorPolicy;
}

type Arithmetic = "binary32" | "binary64";
function numberFor(profile: Arithmetic, value: number): number { return profile === "binary32" ? Math.fround(value) : value; }
function scale(direction: Vec3, amount: number, arithmetic: Arithmetic): Vec3 {
  const round = (value: number): number => numberFor(arithmetic, value);
  const x = round(direction.x); const y = round(direction.y); const z = round(direction.z);
  const length = round(Math.sqrt(round(round(round(x * x) + round(y * y)) + round(z * z))));
  if (length === 0) return { x: 0, y: 0, z: 0 };
  const inverse = round(1 / length);
  return { x: round(round(x * inverse) * amount), y: round(round(y * inverse) * amount), z: round(round(z * inverse) * amount) };
}

function selfDamage(request: DamageRequest): boolean { return request.attack.attacker !== null && sameActor(request.target, request.attack.attacker); }
function sameTeam(target: CombatState, attacker: CombatState | null): boolean { return target.team !== null && target.team !== "" && attacker !== null && target.team === attacker.team; }
function decision(request: DamageRequest, mutations: readonly DamageMutation[], appliedDamage: number, reaction: DamageDecision["reaction"]): DamageDecision {
  return { request, mutations, appliedDamage, reaction };
}

function saveArmor(request: DamageRequest, target: CombatState, damage: number, mutations: DamageMutation[], armor: VictimArmorPolicy): number {
  const result = armor(request, target.armor, damage, attackDamageFlags(request));
  if (result.armor !== target.armor) mutations.push({ kind: "armor", before: target.armor, after: result.armor });
  return result.powerSaved + result.regularSaved;
}

function addImpulse(request: DamageRequest, mutations: DamageMutation[], direction: Vec3, amount: number, arithmetic: Arithmetic): undefined {
  if (amount !== 0) mutations.push({ kind: "impulse", impulse: scale(direction, amount, arithmetic), movementProvider: request.attack.movementProvider });
  return undefined;
}

export interface Q1CombatContext {
  readonly arithmetic: Arithmetic;
  readonly quad: boolean;
  readonly teamplay: number;
  /** Rogue replaces the base teamplay-one gate with its source TeamHealthDam rule. */
  readonly baseTeamHealth?: boolean;
  readonly walk: boolean;
  /** Q1 uses target origin minus inflictor's linked bounding-box center, not the weapon's incoming direction. */
  readonly momentumDirection: Vec3 | null;
}

export interface Q1DamageSourceEffects {
  beforeQuad?(request: DamageRequest, damage: number, target: CombatState, attacker: CombatState | null): DamagePreparation;
  afterQuad?(request: DamageRequest, damage: number, target: CombatState, attacker: CombatState | null): DamagePreparation;
  armorAllowed?(request: DamageRequest, damage: number, target: CombatState, attacker: CombatState | null): boolean;
  protectionApplies?(request: DamageRequest, target: CombatState, attacker: CombatState | null): boolean;
  /** Called after armor and momentum; source reflection may reenter before returning permission to damage health. */
  beforeHealth?(request: DamageRequest, damage: number, target: CombatState, attacker: CombatState | null): boolean;
  /** Rogue Earth scales take after protection/team health gates, preserving spent armor and momentum. */
  afterArmor?(request: DamageRequest, take: number, target: CombatState, attacker: CombatState | null): number;
  /** MG3's Buddha branch replaces lethal health and returns before pain/death callbacks. */
  lethalHealth?(request: DamageRequest, health: number, target: CombatState, attacker: CombatState | null): { readonly health: number; readonly reaction: "none" | "death" };
}
export interface Q1CombatPolicyOptions extends PolicyOptions<Q1CombatContext> { readonly sourceEffects?: Q1DamageSourceEffects; }

export function createQ1CombatPolicy(options: Q1CombatPolicyOptions): CombatPolicy {
  return { id: options.id,
    prepare(request, target, attacker) {
      if (!target.canTakeDamage) return { kind: "cancel" };
      const context = options.context(request, target, attacker);
      const round = (value: number): number => numberFor(context.arithmetic, value);
      const before = options.sourceEffects?.beforeQuad?.(request, round(request.amount), target, attacker);
      if (before?.kind === "cancel") return before;
      const quad = options.sourceEffects?.beforeQuad === undefined ? context.quad : options.context(request, target, attacker).quad;
      const damage = round(round(before?.amount ?? request.amount) * (quad ? 4 : 1));
      const after = options.sourceEffects?.afterQuad?.(request, damage, target, attacker);
      return after?.kind === "cancel" ? after : { kind: "continue", amount: round(after?.amount ?? damage) };
    },
    decide(request, target, attacker, prepared) {
    if (!target.canTakeDamage) return decision(request, [], 0, "none");
    const context = options.context(request, target, attacker);
    const round = (value: number): number => numberFor(context.arithmetic, value);
    const damage = prepared?.amount ?? round(round(request.amount) * (context.quad ? 4 : 1));
    const mutations: DamageMutation[] = [];
    const saved = options.sourceEffects?.armorAllowed?.(request, damage, target, attacker) === false ? 0 : saveArmor(request, target, damage, mutations, options.armor);
    const take = Math.ceil(round(damage - saved));
    if (context.walk && target.noKnockback !== true && context.momentumDirection !== null) addImpulse(request, mutations, context.momentumDirection, round(damage * 8), context.arithmetic);
    // Q1 spends armor and applies momentum even when godmode, invincibility or teamplay stops health loss.
    if ((target.invulnerable && options.sourceEffects?.protectionApplies?.(request, target, attacker) !== false) || (context.baseTeamHealth !== false && context.teamplay === 1 && sameTeam(target, attacker))) return decision(request, mutations, 0, "none");
    if (options.sourceEffects?.beforeHealth !== undefined || options.sourceEffects?.lethalHealth !== undefined) return { ...decision(request, mutations, 0, "none"), continuation: { kind: "q1-health", damage, take } };
    const healthTake = round(options.sourceEffects?.afterArmor?.(request, take, target, attacker) ?? take);
    const health = Math.max(-99, round(target.health - healthTake));
    mutations.push({ kind: "health", before: target.health, after: health });
    return decision(request, mutations, healthTake, health <= 0 ? "death" : "pain");
  },
    resume(previous, current) {
      const { request, continuation } = previous;
      if (continuation?.kind !== "q1-health") throw new Error("Q1 combat resumed without a source continuation");
      const target = current.target();
      if (target === null || options.sourceEffects?.beforeHealth?.(request, continuation.damage, target, current.attacker()) === false) return decision(request, [], 0, "none");
      const latest = current.target();
      if (latest === null) return decision(request, [], 0, "none");
      const attacker = current.attacker(), context = options.context(request, latest, attacker);
      const take = numberFor(context.arithmetic, options.sourceEffects?.afterArmor?.(request, continuation.take, latest, attacker) ?? continuation.take);
      const health = Math.max(-99, numberFor(context.arithmetic, latest.health - take));
      const lethal = health <= 0 ? options.sourceEffects?.lethalHealth?.(request, health, latest, attacker) : undefined;
      return decision(request, [{ kind: "health", before: latest.health, after: lethal?.health ?? health }], take, lethal?.reaction ?? (health <= 0 ? "death" : "pain"));
    } };
}

export interface Q2CombatContext {
  readonly arithmetic: Arithmetic;
  readonly player: boolean;
  readonly monster: boolean;
  readonly attackerPlayer: boolean;
  readonly hasEnemy: boolean;
  readonly easySkill: boolean;
  readonly deathmatch: boolean;
  readonly defenderSphere: boolean;
  readonly teamDamageEnabled: boolean;
  readonly friendlyFire: boolean;
  readonly nuke: boolean;
  readonly noKnockback: boolean;
  readonly movable: boolean;
  /** CTF's later CheckTeamDamage site occurs after protection and armor. */
  readonly rejectTeamDamage: boolean;
  readonly suppressPain: boolean;
}

export interface Q2DamageSourceEffects {
  /** CTF strength and LMCTF damage rune follow the surprise bonus, before momentum. */
  beforeMomentum?(request: DamageRequest, damage: number, target: CombatState, attacker: CombatState | null): number;
  powerArmorAllowed?(request: DamageRequest, target: CombatState, attacker: CombatState | null): boolean;
  /** LMCTF resistance runs after power armor and before ordinary armor. */
  afterPowerArmor?(request: DamageRequest, take: number, target: CombatState, attacker: CombatState | null): number;
  armorAllowed?(request: DamageRequest, target: CombatState, attacker: CombatState | null): boolean;
  /** CTF resistance runs after both armor sites. */
  afterArmor?(request: DamageRequest, take: number, target: CombatState, attacker: CombatState | null): number;
  /** LMCTF vampire healing observes committed victim health before death is tested. */
  afterHealth?(decision: DamageDecision, current: CurrentCombatState): undefined;
}
export interface Q2CombatPolicyOptions extends PolicyOptions<Q2CombatContext> { readonly sourceEffects?: Q2DamageSourceEffects; }

export function createQ2CombatPolicy(options: Q2CombatPolicyOptions): CombatPolicy {
  return { id: options.id, decide(request, target, attacker) {
    if (!target.canTakeDamage) return decision(request, [], 0, "none");
    const context = options.context(request, target, attacker);
    const flags = attackDamageFlags(request);
    const round = (value: number): number => numberFor(context.arithmetic, value);
    let damage = Math.trunc(request.amount);
    if (!selfDamage(request) && context.teamDamageEnabled && sameTeam(target, attacker) && !context.friendlyFire && !context.nuke) damage = 0;
    if (context.easySkill && !context.deathmatch && context.player) damage = Math.max(1, Math.trunc(damage * 0.5));
    if (context.defenderSphere && context.player) damage = Math.max(1, Math.trunc(damage * 0.5));
    if (request.delivery !== "radius" && context.monster && context.attackerPlayer && !context.hasEnemy && target.health > 0) damage = Math.trunc(damage * 2);
    damage = Math.trunc(options.sourceEffects?.beforeMomentum?.(request, damage, target, attacker) ?? damage);
    const mutations: DamageMutation[] = [];
    const knockback = context.noKnockback || target.noKnockback === true ? 0 : Math.trunc(request.knockback);
    if (!flags.noKnockback && context.movable) {
      const coefficient = context.player && selfDamage(request) ? 1600 : 500;
      addImpulse(request, mutations, request.direction, round(round(coefficient * knockback) / Math.max(50, target.mass)), context.arithmetic);
    }
    const protectionSaved = target.invulnerable && !flags.noProtection ? damage : 0;
    let take = damage - protectionSaved;
    const splitArmor = options.sourceEffects?.afterPowerArmor !== undefined || options.sourceEffects?.powerArmorAllowed !== undefined || options.sourceEffects?.armorAllowed !== undefined;
    let powerSaved: number, regularSaved: number;
    if (splitArmor) {
      const power = options.sourceEffects?.powerArmorAllowed?.(request, target, attacker) === false
        ? { armor: target.armor, powerSaved: 0, regularSaved: 0 }
        : options.armor(request, target.armor, take, { ...flags, stage: "power" });
      powerSaved = power.powerSaved;
      take -= powerSaved;
      take = Math.trunc(options.sourceEffects?.afterPowerArmor?.(request, take, { ...target, armor: power.armor }, attacker) ?? take);
      const regular = options.sourceEffects?.armorAllowed?.(request, target, attacker) === false
        ? { armor: power.armor, powerSaved: 0, regularSaved: 0 }
        : options.armor(request, power.armor, take, { ...flags, stage: "regular" });
      regularSaved = regular.regularSaved;
      take -= regularSaved;
      if (regular.armor !== target.armor) mutations.push({ kind: "armor", before: target.armor, after: regular.armor });
    } else {
      const armor = options.armor(request, target.armor, take, flags);
      powerSaved = armor.powerSaved; regularSaved = armor.regularSaved;
      if (armor.armor !== target.armor) mutations.push({ kind: "armor", before: target.armor, after: armor.armor });
      take -= powerSaved + regularSaved;
    }
    take = Math.trunc(options.sourceEffects?.afterArmor?.(request, take, target, attacker) ?? take);
    if (!flags.noProtection && context.rejectTeamDamage) return decision(request, mutations, 0, "none");
    if (flags.destroyArmor && !target.invulnerable && !flags.noProtection) take = damage;
    const feedback: NonNullable<DamageDecision["feedback"]> = { kind: "q2", powerArmor: powerSaved, armor: regularSaved + protectionSaved, blood: take, knockback };
    if (take === 0) return { ...decision(request, mutations, 0, "none"), feedback };
    const health = Math.max(-999, Math.trunc(target.health - take));
    mutations.push({ kind: "health", before: target.health, after: health });
    return { ...decision(request, mutations, take, health <= 0 ? "death" : context.suppressPain ? "none" : "pain"), feedback };
  }, afterHealth(result, current) {
    if (options.sourceEffects?.afterHealth === undefined) return result.reaction;
    options.sourceEffects.afterHealth(result, current);
    const target = current.target();
    if (target === null) return "none";
    if (target.health <= 0) return "death";
    return options.context(result.request, target, current.attacker()).suppressPain ? "none" : "pain";
  } };
}

export interface Q3CombatContext {
  readonly player: boolean;
  readonly attackerPlayer: boolean;
  readonly attackerMaxHealth: number;
  readonly attackerGuard: boolean;
  readonly intermission: boolean;
  readonly noclip: boolean;
  readonly missionpackInvulnerability: boolean;
  readonly noKnockback: boolean;
  readonly knockbackScale: number;
  readonly friendlyFire: boolean;
  readonly battlesuit: boolean;
  readonly falling: boolean;
  readonly juiced: boolean;
  readonly proximityProtected: boolean;
  readonly product: "baseq3" | "missionpack";
}

export function createQ3CombatPolicy(options: PolicyOptions<Q3CombatContext>): CombatPolicy {
  return { id: options.id, decide(request, target, attacker) {
    if (!target.canTakeDamage) return decision(request, [], 0, "none");
    const context = options.context(request, target, attacker);
    if (context.intermission || context.noclip || (context.missionpackInvulnerability && !context.juiced)) return decision(request, [], 0, "none");
    const flags = attackDamageFlags(request);
    let damage = Math.trunc(request.amount);
    if (context.attackerPlayer && !selfDamage(request)) {
      const maximum = context.attackerGuard ? Math.trunc(context.attackerMaxHealth / 2) : context.attackerMaxHealth;
      damage = Math.trunc(Math.imul(damage, maximum) / 100);
    }
    const mutations: DamageMutation[] = [];
    if (context.player && !context.noKnockback && target.noKnockback !== true && !flags.noKnockback) {
      addImpulse(request, mutations, request.direction, Math.fround(Math.fround(Math.fround(context.knockbackScale) * Math.fround(Math.min(damage, 200))) / 200), "binary32");
    }
    if (!flags.noProtection) {
      const checkTeam = context.product === "baseq3" || (!context.juiced && !flags.noTeamProtection);
      if ((checkTeam && !selfDamage(request) && sameTeam(target, attacker) && !context.friendlyFire) || context.proximityProtected || target.invulnerable) return decision(request, mutations, 0, "none");
    }
    if (context.battlesuit) {
      if (request.delivery === "radius" || context.falling) return decision(request, mutations, 0, "none");
      damage = Math.trunc(damage * 0.5);
    }
    if (selfDamage(request)) damage = Math.trunc(damage * 0.5);
    damage = Math.max(1, damage);
    const take = (damage - saveArmor(request, target, damage, mutations, options.armor)) | 0;
    if (take === 0) return decision(request, mutations, 0, "none");
    const health = Math.max(-999, (target.health - take) | 0);
    mutations.push({ kind: "health", before: target.health, after: health });
    return decision(request, mutations, take, health <= 0 ? "death" : "pain");
  } };
}

export function nativeVictimArmor(context: (request: DamageRequest) => VictimArmorContext): VictimArmorPolicy {
  return (request, armor, damage, flags) => absorbNativeArmor(armor, damage, flags, context(request));
}
