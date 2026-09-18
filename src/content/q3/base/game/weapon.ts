// Ported from id Software's game/g_weapon.c and g_combat.c ray/invulnerability helpers.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { add3, dot3, length3, normalize3, scale3, sub3, vec3, vectorToAngles } from "../../../../core/math.ts";
import { qvmAngleVectors } from "../../../../core/qvm-math.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { q3AccuracyHit, q3BulletFire, q3GauntletAttack, q3LightningFire, q3ShotgunFire, q3RailFire, q3RailStatistics } from "./hitscan.ts";
import type { Q3AccuracySubject, Q3BulletAttack, Q3BulletHost, Q3ContactHost } from "./hitscan.ts";
import type { Vec3 } from "../../../../core/math.ts";
import { qvmFloatToInt } from "../../../../core/numeric.ts";
import { EntityEvent, EntityType, GameType, PersistentIndex, Powerup, Weapon } from "../shared/definitions.ts";
import { directionToByte } from "../shared/direction-byte.ts";
import { ServerEntityFlags } from "../shared/entity-shared.ts";
import { damage, DamageFlags } from "./combat.ts";
import { setOrigin } from "./entities.ts";
import type { EntityPool } from "./entities.ts";
import { snapVector } from "./missile.ts";
import type { MissileDirection, MissileRuntime } from "./missile.ts";
import type { GameRandom } from "./numeric.ts";
import { MAX_CLIENTS } from "./state.ts";
import { GameEntity } from "./state.ts";
import type { GameClient } from "./state.ts";

const MASK_SHOT = 0x6000001;
const AWARD_FLAGS = 0x8 | 0x40 | 0x800 | 0x8000 | 0x10000 | 0x20000;

/** quadFactor is read for each attack; random shares the map RNG used by missiles. */
export interface WeaponHost {
  readonly missiles: MissileRuntime;
  readonly quadFactor: number;
  readonly random: Pick<GameRandom, "rand" | "random" | "crandom">;
  unlink(actor: ActorId): (() => void) | null;
}

export type SphereIntersections = readonly [] | readonly [Vec3] | readonly [Vec3, Vec3];
export type InvulnerabilityImpact = { readonly kind: "miss" } |
  { readonly kind: "hit"; readonly impactPoint: Vec3; readonly bounceDirection: Vec3 };

function clientOf(entity: GameEntity): GameClient {
  if (entity.client === null) throw new Error("Weapon attack requires a client entity");
  return entity.client;
}


/** Source normalizes dir in place, retains intersection order, and does not reject negative ray times. */
export function raySphereIntersections(origin: Vec3, radius: number, point: Vec3, direction: MissileDirection): SphereIntersections {
  const dir = normalize3(vec3(direction.x, direction.y, direction.z));
  direction.x = dir.x; direction.y = dir.y; direction.z = dir.z;
  const offset = sub3(point, origin);
  const b = Math.fround(2 * dot3(dir, offset));
  const c = Math.fround(dot3(offset, offset) - Math.fround(radius * radius));
  const discriminant = Math.fround(Math.fround(b * b) - Math.fround(4 * c));
  if (discriminant > 0) {
    const root = Math.fround(Math.sqrt(discriminant));
    const first = Math.fround(Math.fround(-b + root) / 2), second = Math.fround(Math.fround(-b - root) / 2);
    return [add3(point, scale3(dir, first)), add3(point, scale3(dir, second))];
  }
  if (discriminant === 0) return [add3(point, scale3(dir, Math.fround(-b / 2)))];
  return [];
}

export function invulnerabilityEffect(pool: EntityPool, target: GameEntity, direction: Vec3, point: Vec3): InvulnerabilityImpact {
  if (pool.options.product !== "missionpack") throw new Error("Invulnerability effects require missionpack");
  if (target.client === null) return { kind: "miss" };
  const backwards = { x: -direction.x, y: -direction.y, z: -direction.z };
  const intersections = raySphereIntersections(target.client.ps.origin, 42, point, backwards);
  const impactPoint = intersections[0];
  if (impactPoint === undefined) return { kind: "miss" };
  const impact = pool.tempEntity(target.client.ps.origin, EntityEvent.EV_INVUL_IMPACT);
  const offset = sub3(impactPoint, target.client.ps.origin), angles = vectorToAngles(offset);
  let pitch = Math.fround(angles.x + 90);
  if (pitch > 360) pitch = Math.fround(pitch - 360);
  impact.s.angles = vec3(pitch, angles.y, angles.z);
  return { kind: "hit", impactPoint, bounceDirection: normalize3(offset) };
}

function accuracySubject(entity: GameEntity, actor: ActorId = entity.actor.id): Q3AccuracySubject {
  return { actor, damageable: entity.takedamage, player: entity.client !== null,
    health: entity.client?.ps.health ?? entity.health, team: entity.client === null ? null : `q3-team:${entity.client.sess.sessionTeam}` };
}

export function logAccuracyHit(gameType: number, target: GameEntity, attacker: GameEntity): boolean {
  if (!target.takedamage || target === attacker || target.client === null || attacker.client === null || target.client.ps.health <= 0) return false;
  return q3AccuracyHit(gameType >= GameType.GT_TEAM, accuracySubject(target), accuracySubject(attacker));
}


type Attack = Q3BulletAttack;

export class WeaponRuntime {
  constructor(readonly host: WeaponHost) {
    host.missiles.host.combat.entities.callbacks.think.register("q3.weapon.kamikazeDamage", self => { this.kamikazeDamage(self); });
  }

  private owned(entity: GameEntity): void {
    if (this.host.missiles.host.combat.entities.get(entity.slot) !== entity) throw new Error("Weapon entity does not belong to this pool");
  }

  private quad(entity: GameEntity): number {
    const client = clientOf(entity);
    let factor = client.ps.powerups.get(Powerup.PW_QUAD) ? Math.fround(this.host.quadFactor) : 1;
    if (this.host.missiles.host.combat.product === "missionpack" && client.persistantPowerup?.item?.tag === Powerup.PW_DOUBLER) factor = Math.fround(factor * 2);
    return factor;
  }

  private attack(entity: GameEntity, quad: number): Attack {
    const client = clientOf(entity), vectors = qvmAngleVectors(client.ps.viewangles);
    const eye = vec3(entity.s.pos.base.x, entity.s.pos.base.y, Math.fround(entity.s.pos.base.z + client.ps.viewheight));
    // CalcMuzzlePointOrigin deliberately ignores oldOrigin, exactly like CalcMuzzlePoint.
    return { ...vectors, forward: { ...vectors.forward }, muzzle: snapVector(add3(eye, scale3(vectors.forward, 14))), quad };
  }


  private scaled(amount: number, attack: Attack): number { return qvmFloatToInt(Math.fround(Math.fround(amount) * attack.quad)); }

  checkGauntletAttack(entity: GameEntity): boolean {
    this.owned(entity);
    return q3GauntletAttack(this.contactHost(entity, 2), entity.actor.id, this.attack(entity, this.quad(entity)),
      Boolean(clientOf(entity).ps.powerups.get(Powerup.PW_QUAD)));
  }

  fire(entity: GameEntity): void {
    this.owned(entity);
    const client = clientOf(entity), missiles = this.host.missiles, combat = missiles.host.combat;
    const quad = this.quad(entity);
    combat.entities.rankings.fireWeapon(entity.slot, entity.s.weapon);
    if (entity.s.weapon !== Weapon.WP_GRAPPLING_HOOK && entity.s.weapon !== Weapon.WP_GAUNTLET) {
      client.accuracyShots = (client.accuracyShots + (combat.product === "missionpack" && entity.s.weapon === Weapon.WP_NAILGUN ? 15 : 1)) | 0;
    }
    const attack = this.attack(entity, quad);
    const multiply = (projectile: GameEntity): void => {
      projectile.damage = this.scaled(projectile.damage, attack); projectile.splashDamage = this.scaled(projectile.splashDamage, attack);
    };
    switch (entity.s.weapon) {
      case Weapon.WP_GAUNTLET: return; // Source Weapon_Gauntlet has an empty body; contact is checked before pmove.
      case Weapon.WP_LIGHTNING: this.lightning(entity, attack); return;
      case Weapon.WP_SHOTGUN: this.shotgun(entity, attack); return;
      case Weapon.WP_MACHINEGUN: this.bullet(entity, attack, 200, combat.gameType === GameType.GT_TEAM ? 5 : 7); return;
      case Weapon.WP_GRENADE_LAUNCHER:
        attack.forward = { ...normalize3(vec3(attack.forward.x, attack.forward.y, Math.fround(attack.forward.z + Math.fround(0.2)))) };
        multiply(missiles.fireGrenade(entity, attack.muzzle, attack.forward)); return;
      case Weapon.WP_ROCKET_LAUNCHER: multiply(missiles.fireRocket(entity, attack.muzzle, attack.forward)); return;
      case Weapon.WP_PLASMAGUN: multiply(missiles.firePlasma(entity, attack.muzzle, attack.forward)); return;
      case Weapon.WP_RAILGUN: this.railgun(entity, attack); return;
      case Weapon.WP_BFG: multiply(missiles.fireBfg(entity, attack.muzzle, attack.forward)); return;
      case Weapon.WP_GRAPPLING_HOOK:
        if (!client.fireHeld && client.hook === null) missiles.fireGrapple(entity, attack.muzzle, attack.forward);
        client.fireHeld = true; return;
      case Weapon.WP_NAILGUN:
        if (combat.product === "missionpack") for (let count = 0; count < 15; count++) multiply(missiles.fireNail(entity, attack.muzzle, attack.forward, attack.right, attack.up));
        return;
      case Weapon.WP_PROX_LAUNCHER:
        if (combat.product === "missionpack") {
          attack.forward = { ...normalize3(vec3(attack.forward.x, attack.forward.y, Math.fround(attack.forward.z + Math.fround(0.2)))) };
          multiply(missiles.fireProx(entity, attack.muzzle, attack.forward));
        }
        return;
      case Weapon.WP_CHAINGUN: if (combat.product === "missionpack") this.bullet(entity, attack, 600, 7); return;
      case Weapon.WP_NONE: return;
    }
  }

  private hitTarget(attacker: ActorId, actor: ActorId) {
    const combat = this.host.missiles.host.combat;
    const state = combat.authority.read(actor); if (state === null) return null;
    const target = combat.actors.participant(actor), native = target instanceof GameEntity ? target : null;
    const sourceAttacker = combat.entities.options.records.nativeByActor(attacker);
    const attackerState = sourceAttacker === null ? { actor: attacker, damageable: false, player: false, health: 0, team: null } : accuracySubject(sourceAttacker, attacker);
    const observed = native === null ? { actor, damageable: state.canTakeDamage, player: combat.actors.isPlayer(actor), health: state.health, team: state.team } : accuracySubject(native, actor);
    return { damageable: observed.damageable, player: observed.player, accuracyEligible: q3AccuracyHit(combat.gameType >= GameType.GT_TEAM, observed, attackerState),
      invulnerable: native?.client !== null && native?.client !== undefined && native.client.invulnerabilityTime > combat.time };
  }

  private bullet(entity: GameEntity, attack: Attack, spread: number, amount: number): void {
    const combat = this.host.missiles.host.combat, pool = combat.entities, attacker = entity.actor.id;
    const services = {
      random: this.host.random,
      trace: (start: Vec3, end: Vec3, pass: ActorId | null) => combat.spatial.traceActor({ start, end, shape: { kind: "point" }, passActor: pass, mask: MASK_SHOT }),
      target: (actor: ActorId) => this.hitTarget(attacker, actor),
      emit: (hit: Parameters<Q3BulletHost["emit"]>[0]): void => {
        const event = pool.tempEntity(hit.point, hit.flesh ? EntityEvent.EV_BULLET_HIT_FLESH : EntityEvent.EV_BULLET_HIT_WALL);
        if (hit.flesh && hit.target !== null) {
          const target = combat.actors.participant(hit.target);
          if (!(target instanceof GameEntity) || target.client === null) throw new Error("Admitted Q3 map player has no native client behavior record");
          event.s.eventParm = target.s.number;
        } else event.s.eventParm = directionToByte(hit.normal);
        event.s.otherEntityNum = entity.s.number;
      },
      damage: (target: ActorId, direction: Attack["forward"], point: Vec3, scaled: number): void => {
        damage(combat, combat.actors.participant(target), entity, entity, direction, point, scaled, 0, 3);
      },
      creditAccuracyHit: (): void => { const client = clientOf(entity); client.accuracyHits = (client.accuracyHits + 1) | 0; },
    };
    const host: Q3BulletHost = combat.product === "baseq3" ? { ...services, product: "baseq3" } : {
      ...services, product: "missionpack", invulnerabilityImpact: (actor, direction, point) => {
        const target = combat.actors.participant(actor);
        if (!(target instanceof GameEntity)) throw new Error("Q3 invulnerability requires its actual client behavior");
        return invulnerabilityEffect(pool, target, direction, point);
      },
    };
    q3BulletFire(host, entity.actor.id, attack, spread, amount);
  }

  private shotgun(entity: GameEntity, attack: Attack): void {
    const pool = this.host.missiles.host.combat.entities, shooter = entity.actor.id, sourceNumber = entity.s.number;
    q3ShotgunFire({ ...this.contactHost(entity, 1), random: this.host.random, alive: () => pool.options.records.nativeByActor(shooter) === entity, begin: (muzzle, direction) => {
      const event = pool.tempEntity(muzzle, EntityEvent.EV_SHOTGUN); event.s.origin2 = direction;
      return seed => { event.s.eventParm = seed; event.s.otherEntityNum = sourceNumber; };
    } }, shooter, attack);
  }

  private railgun(entity: GameEntity, attack: Attack): void {
    const combat = this.host.missiles.host.combat, pool = combat.entities, shooter = entity.actor.id, client = clientOf(entity), clientNumber = entity.s.clientNum;
    const alive = (): boolean => pool.options.records.nativeByActor(shooter) === entity;
    const hits = q3RailFire({ ...this.contactHost(entity, 10), alive, unlink: actor => this.host.unlink(actor), trail: shot => {
      const event = pool.tempEntity(shot.end, EntityEvent.EV_RAILTRAIL);
      event.s.clientNum = clientNumber; event.s.origin2 = shot.start; event.s.eventParm = shot.impact.kind === "none" ? 255 : directionToByte(shot.impact.normal);
    } }, shooter, attack);
    if (!alive()) return;
    const state = q3RailStatistics({ streak: client.accurateCount, hits: client.accuracyHits,
      impressiveCount: client.ps.persistant.get(PersistentIndex.PERS_IMPRESSIVE_COUNT), rewardUntil: client.rewardTime }, hits, combat.time);
    client.accurateCount = state.streak; client.accuracyHits = state.hits;
    if (state.awarded) {
      pool.rankings.reward(entity.slot, 0x8000);
      client.ps.persistant.set(PersistentIndex.PERS_IMPRESSIVE_COUNT, state.impressiveCount);
      client.ps.eFlags = (client.ps.eFlags & ~AWARD_FLAGS) | 0x8000; client.rewardTime = state.rewardUntil;
    }
  }

  private contactHost(entity: GameEntity, method: number): Q3ContactHost {
    const combat = this.host.missiles.host.combat, pool = combat.entities, attacker = entity.actor.id, firingWeapon = entity.s.weapon, firingClient = clientOf(entity);
    const services = {
      trace: (start: Vec3, end: Vec3, pass: ActorId | null) => combat.spatial.traceActor({ start, end, shape: { kind: "point" }, passActor: pass, mask: MASK_SHOT }),
      target: (actor: ActorId) => this.hitTarget(attacker, actor),
      emit: (hit: Parameters<Q3ContactHost["emit"]>[0]): void => {
        switch (hit.kind) {
          case "gauntlet-quad": pool.addEvent(entity, EntityEvent.EV_POWERUP_QUAD); return;
          case "lightning-reflection": pool.tempEntity(hit.start, EntityEvent.EV_LIGHTNINGBOLT).s.origin2 = hit.end; return;
          case "miss": pool.tempEntity(hit.point, EntityEvent.EV_MISSILE_MISS).s.eventParm = directionToByte(hit.normal); return;
          case "hit": {
            const target = combat.actors.participant(hit.target);
            if (!(target instanceof GameEntity) || target.client === null) throw new Error("Admitted Q3 map player has no native client behavior record");
            const event = pool.tempEntity(hit.point, EntityEvent.EV_MISSILE_HIT);
            event.s.otherEntityNum = target.s.number; event.s.eventParm = directionToByte(hit.normal); event.s.weapon = firingWeapon; return;
          }
        }
      },
      damage: (target: ActorId, direction: Attack["forward"], point: Vec3, amount: number): void => {
        damage(combat, combat.actors.participant(target), entity, entity, direction, point, amount, 0, method);
      },
      creditAccuracyHit: (): void => { if (combat.authority.read(attacker) !== null) firingClient.accuracyHits = (firingClient.accuracyHits + 1) | 0; },
    };
    return combat.product === "baseq3" ? { ...services, product: "baseq3" } : {
      ...services, product: "missionpack", invulnerabilityImpact: (actor, direction, point) => {
        const target = combat.actors.participant(actor);
        if (!(target instanceof GameEntity)) throw new Error("Q3 invulnerability requires its actual client behavior");
        return invulnerabilityEffect(pool, target, direction, point);
      },
    };
  }

  private lightning(entity: GameEntity, attack: Attack): void {
    q3LightningFire(this.contactHost(entity, 11), entity.actor.id, attack);
  }

  startKamikaze(entity: GameEntity): GameEntity {
    this.owned(entity);
    const combat = this.host.missiles.host.combat, pool = combat.entities;
    if (combat.product !== "missionpack") throw new Error("Kamikaze requires missionpack");
    const explosion = pool.spawn(); explosion.s.eType = EntityType.ET_EVENTS + EntityEvent.EV_KAMIKAZE; explosion.eventTime = combat.time;
    const source = entity.client !== null ? entity : entity.activator;
    if (source === null) throw new Error("Kamikaze timer requires its activator");
    const position = snapVector(source.s.pos.base); setOrigin(explosion, position); explosion.classname = "kamikaze";
    explosion.kamikazeTime = combat.time; explosion.think = this.host.missiles.host.combat.entities.callbacks.think.resolve("q3.weapon.kamikazeDamage"); explosion.nextthink = (combat.time + 100) | 0;
    explosion.count = 0; explosion.movedir = vec3(0, 0, 0); this.host.missiles.host.world.link(explosion);
    if (entity.client !== null) {
      explosion.activator = entity; entity.s.eFlags &= ~0x200;
      damage(combat, entity, entity, entity, null, null, 100000, DamageFlags.NO_PROTECTION, 26);
    } else explosion.activator = source.classname === "bodyque" ? pool.at(source.r.ownerNum) : source;
    const event = pool.tempEntity(position, EntityEvent.EV_GLOBAL_TEAM_SOUND); event.r.svFlags |= ServerEntityFlags.BROADCAST; event.s.eventParm = 13;
    return explosion;
  }

  private kamikazeArea(origin: Vec3, attacker: GameEntity | null, amount: number, radius: number, shock: boolean): void {
    const combat = this.host.missiles.host.combat, world = this.host.missiles.host.world;
    radius = Math.max(1, Math.fround(radius));
    const extent = vec3(radius, radius, radius);
    const candidates = world.areaEntities({ min: sub3(origin, extent), max: add3(origin, extent) });
    for (const number of candidates) {
      const target = combat.entities.at(number);
      if (shock ? target.kamikazeShockTime > combat.time : !target.takedamage || target.kamikazeTime > combat.time) continue;
      const link = world.linkState(number);
      if (link === undefined) throw new Error("Kamikaze area query returned an unlinked entity");
      const axis = (p: number, min: number, max: number): number => p < min ? min - p : p > max ? p - max : 0;
      const dist = length3(vec3(axis(origin.x, link.absbounds.min.x, link.absbounds.max.x), axis(origin.y, link.absbounds.min.y, link.absbounds.max.y), axis(origin.z, link.absbounds.min.z, link.absbounds.max.z)));
      if (dist >= radius) continue;
      const offset = sub3(target.r.currentOrigin, origin), direction = { x: offset.x, y: offset.y, z: Math.fround(offset.z + 24) };
      damage(combat, target, null, attacker, direction, origin, amount, DamageFlags.RADIUS | DamageFlags.NO_TEAM_PROTECTION, 26);
      if (shock) {
        const horizontal = normalize3(vec3(direction.x, direction.y, 0));
        if (target.client !== null) target.client.ps.velocity = vec3(Math.fround(horizontal.x * 400), Math.fround(horizontal.y * 400), 100);
        target.kamikazeShockTime = (combat.time + 3000) | 0;
      } else target.kamikazeTime = (combat.time + 3000) | 0;
    }
  }

  private kamikazeDamage(entity: GameEntity): void {
    const combat = this.host.missiles.host.combat, random = this.host.random;
    entity.count = (entity.count + 100) | 0;
    if (entity.count >= 0) this.kamikazeArea(entity.s.pos.base, entity.activator, 25, Math.trunc(Math.imul(entity.count, 1320) / 2000), true);
    if (entity.count >= 250) this.kamikazeArea(entity.s.pos.base, entity.activator, 400, Math.trunc(Math.imul(entity.count - 250, 720) / 1750), false);
    if (entity.count >= 2000) { combat.entities.free(entity); return; }
    entity.nextthink = (combat.time + 100) | 0;
    const angles = vec3(Math.fround(random.crandom() * 2), Math.fround(random.crandom() * 2), 0);
    const short = (angle: number): number => qvmFloatToInt(Math.fround(Math.fround(angle * 65536) / 360)) & 65535;
    for (let index = 0; index < MAX_CLIENTS; index++) {
      const target = combat.entities.at(index), client = target.client;
      if (!target.inuse || client === null) continue;
      if (target.binding.body.read().ground !== null) client.ps.velocity = vec3(
        Math.fround(client.ps.velocity.x + Math.fround(random.crandom() * 120)),
        Math.fround(client.ps.velocity.y + Math.fround(random.crandom() * 120)),
        Math.fround(30 + Math.fround(random.random() * 25)));
      const delta = sub3(angles, entity.movedir), old = client.ps.deltaAngles;
      client.ps.deltaAngles = { x: (old.x + short(delta.x)) | 0, y: (old.y + short(delta.y)) | 0, z: (old.z + short(delta.z)) | 0 };
    }
    entity.movedir = angles;
  }
}
