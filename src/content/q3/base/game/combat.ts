// Ported from id Software's code/game/g_combat.c: CheckArmor, G_Damage,
// CanDamage and G_RadiusDamage; g_team.c: OnSameTeam. GPL-2.0-or-later.
// Copyright (C) 1999-2005 Id Software, Inc.

import { add3, length3, normalize3, scale3, sub3, vec3 } from "../../../../core/math.ts";
import type { Bounds, Vec3 } from "../../../../core/math.ts";
import type { ActorSpatialQueries } from "../world.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { useActor } from "./use-participant.ts";
import { ARMOR_PROTECTION, EntityEvent, EntityType, GameType, PersistentIndex, Powerup, statSchema } from "../shared/definitions.ts";
import { ENTITYNUM_NONE, ENTITYNUM_WORLD } from "../shared/player-state.ts";
import type { AttackProvenance, DamageDecision, DamageOutcome, ItemId } from "../../../../contracts/gameplay.ts";
import type { GameplayAuthority } from "../../../../world/gameplay/authority.ts";
import { itemAt } from "../shared/items.ts";
import type { EntityPool } from "./entities.ts";
import { GameFlags, MoverState } from "./state.ts";
import { GameEntity } from "./state.ts";
import type { UseParticipant, DamageParticipant } from "./state.ts";

export enum DamageFlags {
  RADIUS = 0x1,
  NO_ARMOR = 0x2,
  NO_KNOCKBACK = 0x4,
  NO_PROTECTION = 0x8,
  NO_TEAM_PROTECTION = 0x10,
}

const MOD_JUICED = 27;

export interface DamageDiagnostic {
  readonly time: number;
  readonly entityNum: number;
  readonly health: number;
  readonly damage: number;
  readonly armor: number;
}

/** G_Damage normalizes its caller's direction after the pre-knockback early returns. */
export interface DamageDirection { x: number; y: number; z: number }

interface CombatServices {
  readonly authority: GameplayAuthority;
  attack(inflictor: GameEntity, attacker: UseParticipant, weapon: ItemId | null, meansOfDeath: number, flags: number): AttackProvenance;
  /** Runs apply synchronously while retaining this source call for beforeReaction feedback. */
  dispatch(call: Q3DamageCall, operation: () => DamageOutcome): DamageOutcome;
  readonly time: number;
  readonly intermissionQueued: number;
  readonly gameType: number;
  readonly friendlyFire: boolean;
  readonly knockback: number;
  readonly entities: EntityPool;
  readonly spatial: ActorSpatialQueries;
  readonly actors: {
    participant(actor: ActorId): DamageParticipant;
    linkedBounds(actor: ActorId): Bounds | null;
    isPlayer(actor: ActorId): boolean;
  };
  readonly debugDamage: ((diagnostic: DamageDiagnostic) => void) | null;
  checkHurtCarrier(target: GameEntity, attacker: GameEntity): void;
  logAccuracyHit(target: GameEntity, attacker: GameEntity): boolean;
}

export type CombatContext = CombatServices & (
  | { readonly product: "baseq3" }
  | {
    readonly product: "missionpack";
    checkObeliskAttack(target: GameEntity, attacker: UseParticipant): boolean;
    invulnerabilityEffect(target: GameEntity, direction: Vec3, point: Vec3): void;
  }
);

function onSameTeam(context: CombatContext, first: GameEntity, second: GameEntity): boolean {
  return first.client !== null && second.client !== null && context.gameType >= GameType.GT_TEAM &&
    first.client.sess.sessionTeam === second.client.sess.sessionTeam;
}

export function checkArmor(target: GameEntity, damage: number, flags: number): number {
  if (damage === 0 || target.client === null || (flags & DamageFlags.NO_ARMOR) !== 0) return 0;
  const ps = target.client.ps;
  const slot = statSchema(ps.product).armor;
  const scaledDamage = Math.fround(Math.fround(damage) * Math.fround(ARMOR_PROTECTION));
  const roundedSave = Math.ceil(scaledDamage);
  const armor = ps.stats.get(slot);
  const save = roundedSave >= armor ? armor : roundedSave;
  if (save === 0) return 0;
  ps.stats.set(slot, armor - save);
  return save;
}

export function q3AdmitTargetDamage(context: Pick<CombatContext, "intermissionQueued">, target: GameEntity,
  source: UseParticipant | null, owner: UseParticipant | null): "continue" | "handled" {
  if (!target.takedamage || context.intermissionQueued !== 0) return "handled";
  if (target.s.eType !== EntityType.ET_MOVER) return "continue";
  if (target.use !== null && target.moverState === MoverState.POS1) target.use(target, source, owner);
  return "handled";
}

/** Caller supplies already weapon-scaled damage. Doubler/quad scaling belongs to g_weapon. */
export function damage(context: CombatContext, target: DamageParticipant, inflictor: GameEntity | null,
  attacker: UseParticipant | null, direction: DamageDirection | null, point: Vec3 | null,
  amount: number, flags: number, methodOfDeath: number): void {
  if (context.intermissionQueued !== 0) return;
  if (!(target instanceof GameEntity)) {
    const origin = point ?? target.origin();
    if (origin === null) return;
    const source = inflictor ?? context.entities.at(ENTITYNUM_WORLD), owner = attacker ?? context.entities.at(ENTITYNUM_WORLD);
    const impulseDirection = direction === null ? vec3(0, 0, 0) : { ...direction };
    if (direction === null) flags |= DamageFlags.NO_KNOCKBACK;
    else { const normalized = normalize3(direction); direction.x = normalized.x; direction.y = normalized.y; direction.z = normalized.z; }
    context.authority.apply({ target: target.actor, attack: context.attack(source, owner, null, methodOfDeath, flags),
      amount, knockback: amount, direction: impulseDirection, point: origin, normal: vec3(0, 0, 0), delivery: (flags & DamageFlags.RADIUS) !== 0 ? "radius" : "direct" });
    return;
  }
  if (!target.takedamage) return;
  if (context.product === "missionpack" && target.client !== null && methodOfDeath !== MOD_JUICED &&
    target.client.invulnerabilityTime > context.time) {
    if (direction !== null && point !== null) context.invulnerabilityEffect(target, direction, point);
    return;
  }
  const source = inflictor ?? context.entities.at(ENTITYNUM_WORLD);
  const owner = attacker ?? context.entities.at(ENTITYNUM_WORLD);
  if (q3AdmitTargetDamage(context, target, source, owner) === "handled") return;
  if (context.product === "missionpack" && context.gameType === GameType.GT_OBELISK && context.checkObeliskAttack(target, owner)) return;
  if (target.client?.noclip) return;
  const impulseDirection = direction === null ? vec3(0, 0, 0) : { ...direction };
  if (direction === null) flags |= DamageFlags.NO_KNOCKBACK;
  else { const normalized = normalize3(direction); direction.x = normalized.x; direction.y = normalized.y; direction.z = normalized.z; }
  const attack = context.attack(source, owner, null, methodOfDeath, flags);
  const apply = () => context.authority.apply({ attack, target: target.actor.id,
    amount, knockback: amount, direction: impulseDirection, point: point ?? target.r.currentOrigin,
    normal: vec3(0, 0, 0), delivery: (flags & DamageFlags.RADIUS) !== 0 ? "radius" : "direct" });
  context.dispatch({ target, source, owner, direction, point, amount, flags, methodOfDeath }, apply);
}

export interface Q3DamageCall {
  readonly target: GameEntity; readonly source: GameEntity; readonly owner: UseParticipant;
  readonly direction: Vec3 | null; readonly point: Vec3 | null;
  readonly amount: number; readonly flags: number; readonly methodOfDeath: number;
}

/** Called by GameplayAuthority.beforeReaction after its commits and before pain/die. */
export function q3DamageFeedback(context: CombatContext, call: Q3DamageCall, decision: DamageDecision): void {
  const { target, owner, direction, flags, methodOfDeath } = call;
  const nativeOwner = owner instanceof GameEntity ? owner : null;
  const ownerClient = nativeOwner?.client ?? null;
  const ownerNumber = nativeOwner?.s.number ?? ENTITYNUM_NONE;
  const client = target.client;
  let incoming = Math.trunc(call.amount);
  if (ownerClient !== null && owner !== target) {
    const schema = statSchema(context.product);
    let maximum = ownerClient.ps.stats.get(schema.maxHealth);
    if (schema.product === "missionpack" && itemAt("missionpack", ownerClient.ps.stats.get(schema.persistentPowerup)).tag === Powerup.PW_GUARD) maximum = Math.trunc(maximum / 2);
    incoming = Math.trunc(Math.imul(incoming, maximum) / 100);
  }
  const knockback = (flags & DamageFlags.NO_KNOCKBACK) !== 0 || (target.flags & GameFlags.NO_KNOCKBACK) !== 0 ? 0 : Math.min(incoming, 200);
  if (knockback !== 0 && client !== null && direction !== null && client.ps.pmTime === 0) {
    client.ps.pmTime = Math.min(200, Math.max(50, Math.imul(knockback, 2))); client.ps.pmFlags |= 64;
  }
  if ((flags & DamageFlags.NO_PROTECTION) === 0) {
    const checkTeam = context.product === "baseq3" || methodOfDeath !== 27 && (flags & DamageFlags.NO_TEAM_PROTECTION) === 0;
    if (checkTeam && target !== owner && nativeOwner !== null && onSameTeam(context,target,nativeOwner) && !context.friendlyFire) return;
    if (context.product === "missionpack" && methodOfDeath === 25 &&
      (target === owner || call.source.parent !== null && onSameTeam(context,target,call.source.parent))) return;
    if ((target.flags & GameFlags.GODMODE) !== 0 || context.authority.read(target.actor.id)?.invulnerable) return;
  }
  if (client !== null && client.ps.powerups.get(Powerup.PW_BATTLESUIT) !== 0) {
    context.entities.addEvent(target, EntityEvent.EV_POWERUP_BATTLESUIT);
    if ((flags & DamageFlags.RADIUS) !== 0 || methodOfDeath === 19) return;
  }
  if (decision.appliedDamage === 0 && decision.mutations.every(mutation => mutation.kind !== "armor")) return;
  let armor = 0;
  for (const mutation of decision.mutations) {
    if (mutation.kind === "armor" && mutation.before.kind !== "none" && mutation.after.kind !== "none") armor += mutation.before.points - mutation.after.points;
  }
  const previousHealth = decision.mutations.find(mutation => mutation.kind === "health")?.before ?? target.health;
  if (ownerClient !== null && target !== owner && previousHealth > 0 && target.s.eType !== EntityType.ET_MISSILE && target.s.eType !== EntityType.ET_GENERAL) {
    const persistent = ownerClient.ps.persistant;
    persistent.set(PersistentIndex.PERS_HITS, persistent.get(PersistentIndex.PERS_HITS) + (nativeOwner !== null && onSameTeam(context, target, nativeOwner) ? -1 : 1));
    const previousArmor = (client?.ps.stats.get(statSchema(context.product).armor) ?? 0) + armor;
    persistent.set(PersistentIndex.PERS_ATTACKEE_ARMOR, (previousHealth << 8) | previousArmor);
  }
  context.debugDamage?.({ time: context.time, entityNum: target.s.number, health: previousHealth, damage: decision.appliedDamage, armor });
  if (client !== null) {
    client.ps.persistant.set(PersistentIndex.PERS_ATTACKER, ownerNumber);
    client.damageArmor = (client.damageArmor + armor) | 0;
    client.damageBlood = (client.damageBlood + decision.appliedDamage) | 0;
    client.damageKnockback = (client.damageKnockback + knockback) | 0;
    client.damageFrom = { ...(direction ?? target.r.currentOrigin) };
    client.damageFromWorld = direction === null;
    client.lastHurtClient = ownerNumber; client.lastHurtMod = methodOfDeath;
  }
  if (nativeOwner !== null && (context.gameType === GameType.GT_CTF || context.product === "missionpack" && context.gameType === GameType.GT_1FCTF)) context.checkHurtCarrier(target, nativeOwner);
  if (decision.reaction === "death" && client !== null) target.flags |= GameFlags.NO_KNOCKBACK;
}

export function canDamage(context: CombatContext, target: DamageParticipant, origin: Vec3): boolean {
  const actor = useActor(target), bounds = context.actors.linkedBounds(actor);
  if (bounds === null) return false;
  const midpoint = scale3(add3(bounds.min, bounds.max), 0.5);
  const trace = (end: Vec3) => context.spatial.traceActor({ start: origin, end, shape: { kind: "point" }, passActor: null, mask: 1 });
  const center = trace(midpoint);
  if (center.fraction === 1 || center.hit.kind === "actor" && center.hit.actor.equals(actor)) return true;
  for (const [x, y] of [[15, 15], [15, -15], [-15, 15], [-15, -15]] satisfies readonly (readonly [number, number])[]) {
    if (trace(vec3(midpoint.x + x, midpoint.y + y, midpoint.z)).fraction === 1) return true;
  }
  return false;
}

export function radiusDamage(context: CombatContext, origin: Vec3, attacker: DamageParticipant,
  amount: number, radius: number, ignore: DamageParticipant | null, methodOfDeath: number): boolean {
  radius = Math.max(1, Math.fround(radius));
  amount = Math.fround(amount);
  const extent = vec3(radius, radius, radius);
  const candidates = context.spatial.areaActors({ min: sub3(origin, extent), max: add3(origin, extent) }, 1024);
  let hitClient = false;
  for (const actor of candidates) {
    if (ignore !== null && actor.equals(useActor(ignore)) || !context.authority.read(actor)?.canTakeDamage) continue;
    const bounds = context.actors.linkedBounds(actor);
    if (bounds === null) continue;
    const target = context.actors.participant(actor);
    const distanceAxis = (value: number, min: number, max: number): number => value < min ? min - value : value > max ? value - max : 0;
    const distance = length3(vec3(distanceAxis(origin.x, bounds.min.x, bounds.max.x),
      distanceAxis(origin.y, bounds.min.y, bounds.max.y), distanceAxis(origin.z, bounds.min.z, bounds.max.z)));
    if (distance >= radius) continue;
    const points = Math.fround(amount * Math.fround(1 - Math.fround(distance / radius)));
    if (!canDamage(context, target, origin)) continue;
    if (target instanceof GameEntity && attacker instanceof GameEntity && context.logAccuracyHit(target, attacker)) hitClient = true;
    const targetOrigin = target instanceof GameEntity ? target.r.currentOrigin : target.origin();
    if (targetOrigin === null) continue;
    const direction = add3(sub3(targetOrigin, origin), vec3(0, 0, 24));
    damage(context, target, null, attacker, direction, origin, Math.trunc(points), DamageFlags.RADIUS, methodOfDeath);
  }
  return hitClient;
}
