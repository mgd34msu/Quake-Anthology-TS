// Core damage/armor/impulse ordering from original combat.qc, g_combat.c, and the TS donors.
// AI, source event accumulation, powerup sounds, obelisks and score rules stay in the owning game provider.
import type { CombatPolicy, CombatState, DamageDecision, DamageMutation, DamageRequest } from "../../contracts/gameplay.ts";
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
  readonly walk: boolean;
  /** Q1 uses target origin minus inflictor's linked bounding-box center, not the weapon's incoming direction. */
  readonly momentumDirection: Vec3 | null;
}

export function createQ1CombatPolicy(options: PolicyOptions<Q1CombatContext>): CombatPolicy {
  return { id: options.id, decide(request, target, attacker) {
    if (!target.canTakeDamage) return decision(request, [], 0, "none");
    const context = options.context(request, target, attacker);
    const round = (value: number): number => numberFor(context.arithmetic, value);
    const damage = round(round(request.amount) * (context.quad ? 4 : 1));
    const mutations: DamageMutation[] = [];
    const saved = saveArmor(request, target, damage, mutations, options.armor);
    const take = Math.ceil(round(damage - saved));
    if (context.walk && context.momentumDirection !== null) addImpulse(request, mutations, context.momentumDirection, round(damage * 8), context.arithmetic);
    // Q1 spends armor and applies momentum even when godmode, invincibility or teamplay stops health loss.
    if (target.invulnerable || (context.teamplay === 1 && sameTeam(target, attacker))) return decision(request, mutations, 0, "none");
    const health = Math.max(-99, round(target.health - take));
    mutations.push({ kind: "health", before: target.health, after: health });
    return decision(request, mutations, take, health <= 0 ? "death" : "pain");
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

export function createQ2CombatPolicy(options: PolicyOptions<Q2CombatContext>): CombatPolicy {
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
    const mutations: DamageMutation[] = [];
    const knockback = context.noKnockback || target.noKnockback === true ? 0 : Math.trunc(request.knockback);
    if (!flags.noKnockback && context.movable) {
      const coefficient = context.player && selfDamage(request) ? 1600 : 500;
      addImpulse(request, mutations, request.direction, round(round(coefficient * knockback) / Math.max(50, target.mass)), context.arithmetic);
    }
    const protectionSaved = target.invulnerable && !flags.noProtection ? damage : 0;
    let take = damage - protectionSaved;
    const armor = options.armor(request, target.armor, take, flags);
    if (armor.armor !== target.armor) mutations.push({ kind: "armor", before: target.armor, after: armor.armor });
    take -= armor.powerSaved + armor.regularSaved;
    if (!flags.noProtection && context.rejectTeamDamage) return decision(request, mutations, 0, "none");
    if (flags.destroyArmor && !target.invulnerable && !flags.noProtection) take = damage;
    const feedback: NonNullable<DamageDecision["feedback"]> = { kind: "q2", powerArmor: armor.powerSaved, armor: armor.regularSaved + protectionSaved, blood: take, knockback };
    if (take === 0) return { ...decision(request, mutations, 0, "none"), feedback };
    const health = Math.max(-999, Math.trunc(target.health - take));
    mutations.push({ kind: "health", before: target.health, after: health });
    return { ...decision(request, mutations, take, health <= 0 ? "death" : context.suppressPain ? "none" : "pain"), feedback };
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
