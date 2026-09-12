import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { SessionActorRegistry } from "../../../../world/actors/registry.ts";
import type { SharedBodyTable } from "../../../../world/actors/body.ts";
import { q3AccuracyHit } from "./hitscan.ts";
import { q3BounceProjectile, q3ExplodeProjectile, q3ImpactProjectile, q3LaunchProjectile, q3StepProjectile } from "./projectile.ts";
import type { Q3Projectile, Q3ProjectileHost } from "./projectile.ts";
import type { ActorTraceResult } from "../world.ts";
import { q3MissileParameters, q3NailVelocity } from "./ballistics-math.ts";
// Ported from id Software's game/g_missile.c and g_weapon.c grapple helpers.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { add3, length3, normalize3, scale3, sub3, vec3, vectorToAngles } from "../../../../core/math.ts";
import type { Vec3 } from "../../../../core/math.ts";
import { qvmFloatToInt } from "../../../../core/numeric.ts";
import type { ServerTraceResult, ServerWorld } from "../world.ts";
import { EntityEvent, EntityType, GameType, Weapon } from "../shared/definitions.ts";
import { directionToByte } from "../shared/direction-byte.ts";
import { ServerEntityFlags } from "../shared/entity-shared.ts";
import { MoveFlags } from "../shared/player-state.ts";
import { TrajectoryType } from "../shared/trajectory.ts";
import { canDamage, damage, DamageFlags, radiusDamage } from "./combat.ts";
import type { CombatContext } from "./combat.ts";
import { runThink, setOrigin } from "./entities.ts";
import type { GameRandom } from "./numeric.ts";
import type { EntityTouch, GameClient } from "./state.ts";
import { GameEntity } from "./state.ts";

const MASK_SHOT = 1 | 0x2000000 | 0x4000000;
const EF_BOUNCE_HALF = 0x20, EF_NODRAW = 0x80, EF_TICKING = 2;
const SURF_METALSTEPS = 0x1000;

/** Source fire_* normalizes this argument in place. */
export interface MissileDirection { x: number; y: number; z: number }

export interface MissionpackMissileServices {
  readonly proxMineTimeout: number;
  readonly random: Pick<GameRandom, "random" | "crandom">;
  soundIndex(path: string): number;
  /** G_InvulnerabilityEffect publishes the impact effect and supplies its sphere normal. */
  invulnerabilityImpact(target: GameEntity, direction: Vec3, point: Vec3):
    { readonly kind: "miss" } | { readonly kind: "hit"; readonly bounceDirection: Vec3 };
}

/** Time and cvar properties must be live across scheduled think/touch callbacks. */
export type MissileHost = { readonly actors: Pick<SessionActorRegistry, "onRelease">; readonly world: ServerWorld; readonly bodies: SharedBodyTable; readonly previousTime: number } & (
  | { readonly combat: Extract<CombatContext, { product: "baseq3" }>; readonly missionpack: null }
  | { readonly combat: Extract<CombatContext, { product: "missionpack" }>; readonly missionpack: MissionpackMissileServices }
);

function clientOf(entity: GameEntity): GameClient {
  if (entity.client === null) throw new Error("Missile rule requires a client entity");
  return entity.client;
}

function parentOf(entity: GameEntity): GameEntity {
  if (entity.parent === null) throw new Error("Missile rule requires its source parent");
  return entity.parent;
}

function normalOf(trace: Pick<ServerTraceResult, "contact">): Vec3 {
  return trace.contact.kind === "plane" ? trace.contact.plane.normal : vec3(0, 0, 0);
}

export function snapVector(value: Vec3): Vec3 {
  return vec3(qvmFloatToInt(value.x), qvmFloatToInt(value.y), qvmFloatToInt(value.z));
}

// g_weapon.c intentionally uses truncation plus one, even for negative coordinates.
export function snapVectorTowards(value: Vec3, toward: Vec3): Vec3 {
  const axis = (v: number, to: number): number => (qvmFloatToInt(v) + (to <= v ? 0 : 1)) | 0;
  return vec3(axis(value.x, toward.x), axis(value.y, toward.y), axis(value.z, toward.z));
}

function normalizeDirection(direction: MissileDirection): Vec3 {
  const normalized = normalize3(vec3(direction.x, direction.y, direction.z));
  direction.x = normalized.x; direction.y = normalized.y; direction.z = normalized.z;
  return normalized;
}

function center(entity: GameEntity): Vec3 {
  return add3(entity.r.currentOrigin, scale3(add3(entity.r.mins, entity.r.maxs), 0.5));
}

interface NativeProjectile extends Q3Projectile {
  attachment: { readonly kind: "none" } | { readonly kind: "player"; readonly actor: ActorId };
  trigger: ActorId | null;
}

export class MissileRuntime {
  private readonly projectiles = new Map<GameEntity, NativeProjectile>();
  private readonly proximityTouch: EntityTouch = (self, other) => { if (other instanceof GameEntity) this.proximityTrigger(self, other); };

  constructor(readonly host: MissileHost) {
    if (host.combat.entities.options.product !== host.combat.product) throw new Error("Missile product does not match its entity pool");
    host.actors.onRelease(actor => { this.released(actor.id); return undefined; });
  }

  ownerOf(actor: ActorId): ActorId | null {
    const entity = this.host.combat.entities.options.records.nativeByActor(actor);
    const projectile = entity === null ? undefined : this.projectiles.get(entity);
    return projectile?.actor.id.equals(actor) === true ? projectile.owner : null;
  }

  private ownerClient(projectile: Q3Projectile): GameClient | null {
    return this.host.combat.entities.options.records.nativeByActor(projectile.owner)?.client ?? null;
  }

  private releaseProjectile(projectile: NativeProjectile): void {
    const entity = this.host.combat.entities.options.records.nativeByActor(projectile.actor.id);
    if (entity !== null) this.host.combat.entities.free(entity);
  }

  private released(actor: ActorId): void {
    const pool = this.host.combat.entities, records = pool.options.records;
    for (const [entity, projectile] of [...this.projectiles]) {
      if (this.projectiles.get(entity) !== projectile) continue;
      if (projectile.actor.id.equals(actor)) {
        this.projectiles.delete(entity);
        if (projectile.weapon === Weapon.WP_GRAPPLING_HOOK) {
          const client = this.ownerClient(projectile);
          if (client?.hook === entity) { client.hook = null; client.ps.pmFlags &= ~MoveFlags.GRAPPLE_PULL; }
        }
        if (projectile.attachment.kind === "player" && projectile.weapon === Weapon.WP_PROX_LAUNCHER) {
          const target = records.nativeByActor(projectile.attachment.actor);
          if (target?.client != null && target.activator === entity) { target.client.ps.eFlags &= ~EF_TICKING; target.activator = null; }
        }
        if (projectile.trigger !== null) { const trigger = records.nativeByActor(projectile.trigger); if (trigger !== null) pool.free(trigger); }
      } else if (projectile.weapon === Weapon.WP_GRAPPLING_HOOK && projectile.owner.equals(actor)
        || projectile.attachment.kind === "player" && projectile.attachment.actor.equals(actor)) this.releaseProjectile(projectile);
      else if (projectile.trigger?.equals(actor) === true) {
        projectile.trigger = null;
        if (records.nativeByActor(projectile.actor.id) === entity) entity.activator = null;
      }
    }
  }

  private owned(entity: GameEntity): void {
    if (this.host.combat.entities.get(entity.slot) !== entity) throw new Error("Missile entity does not belong to this pool");
  }

  isProximityTrigger(entity: GameEntity): boolean {
    this.owned(entity);
    return entity.touch === this.proximityTouch;
  }

  private missionpack(): MissionpackMissileServices {
    if (this.host.missionpack === null) throw new Error("Projectile requires missionpack");
    return this.host.missionpack;
  }

  private accuracy(owner: GameEntity): void { const client = clientOf(owner); client.accuracyHits = (client.accuracyHits + 1) | 0; }

  private projectile(entity: GameEntity): NativeProjectile {
    const projectile = this.projectiles.get(entity);
    if (projectile === undefined || this.host.combat.entities.options.records.nativeByActor(projectile.actor.id) !== entity)
      throw new Error("Missile continuation does not own this actor lifetime");
    return projectile;
  }

  private projectileHost(entity: GameEntity, projectile: Q3Projectile): Q3ProjectileHost {
    const runtime = this, combat = this.host.combat, pool = combat.entities, records = pool.options.records;
    const owner = () => records.nativeByActor(projectile.owner);
    const live = () => records.nativeByActor(projectile.actor.id) === entity;
    const special = entity.classname === "hook" || entity.s.weapon === Weapon.WP_PROX_LAUNCHER ? {
      impact: (trace: ActorTraceResult, target: ActorId): boolean => this.specialImpact(entity, trace, target),
      afterMove: (): void => {
        if (this.host.missionpack !== null && entity.s.weapon === Weapon.WP_PROX_LAUNCHER && entity.count === 0) {
          const trace = combat.spatial.traceActor({ start: entity.r.currentOrigin, end: entity.r.currentOrigin,
            shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs }, passActor: null, mask: entity.clipmask });
          if (trace.solidity === "clear" || trace.hit.kind !== "actor" || !trace.hit.actor.equals(projectile.owner)) { entity.count = 1; projectile.pass = null; }
        }
      },
      noImpact: (): void => { const client = owner()?.client; if (client != null && client.hook === entity) client.hook = null; }
    } : null;
    return {
      get time() { return combat.time; }, get previousTime() { return runtime.host.previousTime; }, live,
      phase: () => entity.freeAfterEvent ? "event" : entity.s.eType === EntityType.ET_MISSILE ? "flight" : "attached",
      eventTime: () => entity.eventTime, clearEvent: () => { entity.s.event = 0; }, origin: () => entity.r.currentOrigin,
      move: (origin, velocity) => { const body = runtime.host.bodies.read(projectile.actor.id); if (body !== null) runtime.host.bodies.write(projectile.actor, { ...body, origin, velocity }); },
      setOrigin: origin => { setOrigin(entity, origin); const body = runtime.host.bodies.read(projectile.actor.id); if (body !== null) runtime.host.bodies.write(projectile.actor, { ...body, velocity: vec3(0, 0, 0) }); }, link: () => { runtime.host.world.link(entity); },
      release: () => { pool.free(entity); },
      trace: (start, end, passActor) => combat.spatial.traceActor({ start, end, passActor,
        shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs }, mask: entity.clipmask }),
      worldActor: () => pool.at(1022).actor.id,
      target: actor => {
        const state = combat.authority.read(actor); if (state === null) return null;
        const native = records.nativeByActor(actor), attacker = combat.authority.read(projectile.owner);
        return { damageable: state.canTakeDamage, player: combat.actors.isPlayer(actor),
          invulnerable: native?.client !== null && native?.client !== undefined && native.client.invulnerabilityTime > combat.time,
          accuracyEligible: q3AccuracyHit(combat.gameType >= GameType.GT_TEAM,
            { actor, damageable: state.canTakeDamage, player: combat.actors.isPlayer(actor), health: state.health, team: state.team },
            { actor: projectile.owner, damageable: attacker?.canTakeDamage ?? false, player: owner()?.client != null, health: attacker?.health ?? 0, team: attacker?.team ?? null }) };
      },
      emit: event => {
        if (event.kind === "bounce") { pool.addEvent(entity, EntityEvent.EV_GRENADE_BOUNCE); return; }
        if (event.flesh && event.target !== null) {
          const target = records.nativeByActor(event.target); if (target?.client == null) throw new Error("Q3 admitted player has no native hit-event client");
          pool.addEvent(entity, EntityEvent.EV_MISSILE_HIT, directionToByte(event.normal)); entity.s.otherEntityNum = target.s.number;
        } else pool.addEvent(entity, event.surfaceFlags & SURF_METALSTEPS ? EntityEvent.EV_MISSILE_MISS_METAL : EntityEvent.EV_MISSILE_MISS, directionToByte(event.normal));
      },
      retain: () => { entity.freeAfterEvent = true; entity.s.eType = EntityType.ET_GENERAL; },
      damage: (target, direction, point) => damage(combat, combat.actors.participant(target), entity, combat.actors.participant(projectile.owner),
        direction, point, entity.damage, 0, entity.methodOfDeath, projectile.actor.id),
      radius: (origin, ignore) => radiusDamage(combat, origin, combat.actors.participant(projectile.owner), entity.splashDamage,
        entity.splashRadius, ignore === null ? null : combat.actors.participant(ignore), entity.splashMethodOfDeath, projectile.actor.id),
      accuracy: () => { const current = owner(); if (current?.client != null) this.accuracy(current); },
      think: () => { runThink(entity, combat.time); }, moved: () => {}, special,
      reflection: this.host.missionpack === null ? null : { impact: (target, direction, point) => {
        const current = records.nativeByActor(target); if (current?.client == null) throw new Error("Invulnerable Q3 player lost its native client");
        return this.missionpack().invulnerabilityImpact(current, direction, point);
      } }
    };
  }

  runOwned(actor: OwnedActor): boolean {
    const entity = this.host.combat.entities.options.records.nativeByActor(actor.id);
    if (entity === null) return false;
    const projectile = this.projectiles.get(entity);
    if (projectile === undefined || !projectile.actor.id.equals(actor.id)) return false;
    q3StepProjectile(projectile, this.projectileHost(entity, projectile)); return true;
  }

  bounce(entity: GameEntity, trace: ServerTraceResult): void {
    const projectile = this.projectile(entity), target = this.host.combat.entities.at(trace.entityNum);
    q3BounceProjectile(projectile, this.projectileHost(entity, projectile), { ...trace, hit: { kind: "actor", actor: target.actor.id } });
  }
  explode(entity: GameEntity): void { const projectile = this.projectile(entity); q3ExplodeProjectile(projectile, this.projectileHost(entity, projectile)); }
  impact(entity: GameEntity, trace: ServerTraceResult): void {
    const projectile = this.projectile(entity), target = this.host.combat.entities.at(trace.entityNum);
    q3ImpactProjectile(projectile, this.projectileHost(entity, projectile), { ...trace, hit: { kind: "actor", actor: target.actor.id } });
  }
  run(entity: GameEntity): void { const projectile = this.projectile(entity); q3StepProjectile(projectile, this.projectileHost(entity, projectile)); }

  private specialImpact(entity: GameEntity, trace: ActorTraceResult, actor: ActorId): boolean {
    const combat = this.host.combat, pool = combat.entities, other = pool.options.records.nativeByActor(actor), normal = normalOf(trace);
    if (other === null && combat.actors.isPlayer(actor)) throw new Error("Admitted Q3 map player has no native client behavior record");
    if (this.host.missionpack !== null && entity.s.weapon === Weapon.WP_PROX_LAUNCHER) {
      if (entity.s.pos.type !== TrajectoryType.TR_GRAVITY) return true;
      if (other !== null && other.s.eType === EntityType.ET_PLAYER && other.health > 0) { this.proximityPlayer(entity, other); return true; }
      setOrigin(entity, snapVectorTowards(trace.end, entity.s.pos.base));
      pool.addEvent(entity, EntityEvent.EV_PROXIMITY_MINE_STICK, trace.surfaceFlags);
      entity.think = self => { this.proximityActivate(self); }; entity.nextthink = (combat.time + 2000) | 0;
      const angles = vectorToAngles(normal); entity.s.angles = vec3(angles.x + 90, angles.y, angles.z);
      entity.enemy = other; entity.die = self => { this.proximityDie(self); }; entity.movedir = { ...normal };
      entity.r.mins = vec3(-4, -4, -4); entity.r.maxs = vec3(4, 4, 4);
      this.host.world.link(entity); return true;
    }
    if (entity.classname === "hook") {
      const event = pool.spawn();
      let position: Vec3;
      if (other !== null && other.takedamage && other.client !== null) {
        pool.addEvent(event, EntityEvent.EV_MISSILE_HIT, directionToByte(normal)); event.s.otherEntityNum = other.s.number;
        this.projectile(entity).attachment = { kind: "player", actor: other.actor.id }; position = snapVectorTowards(center(other), entity.s.pos.base);
      } else {
        position = trace.end; pool.addEvent(event, EntityEvent.EV_MISSILE_MISS, directionToByte(normal)); entity.enemy = null;
      }
      position = snapVectorTowards(position, entity.s.pos.base);
      event.freeAfterEvent = true; event.s.eType = EntityType.ET_GENERAL; entity.s.eType = EntityType.ET_GRAPPLE;
      setOrigin(entity, position); setOrigin(event, position);
      entity.think = self => { this.hookThink(self); }; entity.nextthink = (combat.time + 100) | 0;
      const client = this.ownerClient(this.projectile(entity)); if (client === null) { pool.free(entity); pool.free(event); return true; } client.ps.pmFlags |= MoveFlags.GRAPPLE_PULL;
      client.ps.grapplePoint = { ...entity.r.currentOrigin };
      this.host.world.link(entity); this.host.world.link(event); return true;
    }
    return false;
  }

  hookFree(entity: GameEntity): void {
    this.owned(entity);
    this.releaseProjectile(this.projectile(entity));
  }

  hookThink(entity: GameEntity): void {
    const projectile = this.projectile(entity), client = this.ownerClient(projectile);
    if (client === null) { this.releaseProjectile(projectile); return; }
    if (projectile.attachment.kind === "player") {
      const target = this.host.combat.entities.options.records.nativeByActor(projectile.attachment.actor);
      if (target === null) { this.releaseProjectile(projectile); return; }
      setOrigin(entity, snapVectorTowards(center(target), entity.r.currentOrigin));
    }
    client.ps.grapplePoint = { ...entity.r.currentOrigin };
  }

  private proximityExplode(mine: GameEntity): void {
    const projectile = this.projectile(mine), trigger = projectile.trigger;
    this.explode(mine);
    if (trigger !== null) { const entity = this.host.combat.entities.options.records.nativeByActor(trigger); if (entity !== null) this.host.combat.entities.free(entity); }
  }

  private proximityDie(mine: GameEntity): void {
    mine.think = self => { this.proximityExplode(self); }; mine.nextthink = (this.host.combat.time + 1) | 0;
  }

  private proximityTrigger(trigger: GameEntity, other: GameEntity): void {
    if (other.client === null) return;
    const mine = parentOf(trigger), combat = this.host.combat;
    if (length3(sub3(trigger.s.pos.base, other.s.pos.base)) > mine.splashRadius) return;
    if (combat.gameType >= GameType.GT_TEAM && mine.s.generic1 === other.client.sess.sessionTeam) return;
    if (!canDamage(combat, other, trigger.s.pos.base)) return;
    mine.s.loopSound = 0; combat.entities.addEvent(mine, EntityEvent.EV_PROXIMITY_MINE_TRIGGER);
    mine.nextthink = (combat.time + 500) | 0; combat.entities.free(trigger);
  }

  private proximityActivate(mine: GameEntity): void {
    const services = this.missionpack(), combat = this.host.combat;
    mine.think = self => { this.proximityExplode(self); }; mine.nextthink = (combat.time + services.proxMineTimeout) | 0;
    mine.takedamage = true; mine.health = 1; mine.die = self => { this.proximityDie(self); };
    mine.s.loopSound = services.soundIndex("sound/weapons/proxmine/wstbtick.wav");
    const trigger = combat.entities.spawn(), radius = Math.fround(mine.splashRadius);
    trigger.classname = "proxmine_trigger"; trigger.r.mins = vec3(-radius, -radius, -radius); trigger.r.maxs = vec3(radius, radius, radius);
    setOrigin(trigger, mine.s.pos.base); trigger.parent = mine; trigger.r.contents = 0x40000000;
    trigger.touch = this.proximityTouch;
    this.host.world.link(trigger); mine.activator = trigger; this.projectile(mine).trigger = trigger.actor.id;
  }

  private proximityExplodeOnPlayer(mine: GameEntity): void {
    const projectile = this.projectile(mine);
    if (projectile.attachment.kind !== "player") throw new Error("Attached proximity mine requires its player lifetime");
    const player = this.host.combat.entities.options.records.nativeByActor(projectile.attachment.actor);
    if (player === null) { this.releaseProjectile(projectile); return; }
    const client = clientOf(player), combat = this.host.combat;
    client.ps.eFlags &= ~EF_TICKING;
    if (client.invulnerabilityTime > combat.time) {
      const owner = combat.actors.participant(projectile.owner);
      damage(combat, player, owner, owner, vec3(0, 0, 0), mine.s.origin, 1000, DamageFlags.NO_KNOCKBACK, 27, projectile.actor.id);
      if (combat.entities.options.records.nativeByActor(projectile.attachment.actor) !== player) return;
      client.invulnerabilityTime = 0; combat.entities.tempEntity(client.ps.origin, EntityEvent.EV_JUICED);
    } else {
      setOrigin(mine, player.s.pos.base); mine.r.svFlags &= ~ServerEntityFlags.NOCLIENT;
      mine.splashMethodOfDeath = 25; this.explode(mine);
    }
  }

  private proximityPlayer(mine: GameEntity, player: GameEntity): void {
    if (mine.s.eFlags & EF_NODRAW) return;
    const combat = this.host.combat; combat.entities.addEvent(mine, EntityEvent.EV_PROXIMITY_MINE_STICK);
    if (player.s.eFlags & EF_TICKING) {
      if (player.activator === null) throw new Error("Ticking player requires its proximity mine");
      player.activator.splashDamage = (player.activator.splashDamage + mine.splashDamage) | 0;
      player.activator.splashRadius = Math.fround(player.activator.splashRadius * Math.fround(1.5));
      mine.think = self => { combat.entities.free(self); }; mine.nextthink = combat.time; return;
    }
    const client = clientOf(player); client.ps.eFlags |= EF_TICKING; player.activator = mine;
    mine.s.eFlags |= EF_NODRAW; mine.r.svFlags |= ServerEntityFlags.NOCLIENT;
    mine.s.pos = { ...mine.s.pos, type: TrajectoryType.TR_LINEAR, delta: vec3(0, 0, 0) };
    this.projectile(mine).attachment = { kind: "player", actor: player.actor.id }; mine.think = self => { this.proximityExplodeOnPlayer(self); };
    mine.nextthink = (combat.time + (client.invulnerabilityTime > combat.time ? 2000 : 10000)) | 0;
  }

  private launch(self: GameEntity, start: Vec3, direction: Vec3, weapon: Weapon, classname: string, speed: number,
    duration: number, gravity: boolean, direct: number, splash: number, radius: number, method: number, splashMethod: number): GameEntity {
    this.owned(self);
    const owner = self.actor.id, time = this.host.combat.time, bolt = this.host.combat.entities.spawn();
    const launch = q3LaunchProjectile(start, direction, speed, gravity, duration, time);
    bolt.classname = classname; bolt.nextthink = launch.expires; bolt.think = entity => { this.explode(entity); };
    bolt.s.eType = EntityType.ET_MISSILE; bolt.r.svFlags = ServerEntityFlags.USE_CURRENT_ORIGIN; bolt.s.weapon = weapon;
    bolt.r.ownerNum = self.s.number; bolt.parent = weapon === Weapon.WP_GRAPPLING_HOOK || weapon === Weapon.WP_PROX_LAUNCHER ? self : null; bolt.damage = direct; bolt.splashDamage = splash; bolt.splashRadius = radius;
    bolt.methodOfDeath = method; bolt.splashMethodOfDeath = splashMethod; bolt.clipmask = MASK_SHOT; bolt.targetEnt = null;
    bolt.s.pos = launch.trajectory;
    bolt.r.currentOrigin = vec3(start.x, start.y, start.z);
    const actor = bolt.actor;
    this.projectiles.set(bolt, {
      actor, owner, attachment: { kind: "none" }, trigger: null, get weapon() { return bolt.s.weapon; }, get direct() { return bolt.damage; }, get splash() { return bolt.splashDamage; },
      get radius() { return bolt.splashRadius; }, get method() { return bolt.methodOfDeath; }, get splashMethod() { return bolt.splashMethodOfDeath; },
      get damagePoint() { return bolt.s.origin; },
      get trajectory() { return bolt.s.pos; }, set trajectory(value) { bolt.s.pos = value; },
      get flags() { return bolt.s.eFlags; }, set flags(value) { bolt.s.eFlags = value; }, pass: owner
    });
    return bolt;
  }

  firePlasma(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    const spec = q3MissileParameters(Weapon.WP_PLASMAGUN);
    return this.launch(self, start, normalizeDirection(direction), Weapon.WP_PLASMAGUN, "plasma", spec.speed, spec.duration, spec.gravity, spec.direct, spec.splash, spec.radius, spec.method, spec.splashMethod);
  }
  fireGrenade(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    const spec = q3MissileParameters(Weapon.WP_GRENADE_LAUNCHER);
    const bolt = this.launch(self, start, normalizeDirection(direction), Weapon.WP_GRENADE_LAUNCHER, "grenade", spec.speed, spec.duration, spec.gravity, spec.direct, spec.splash, spec.radius, spec.method, spec.splashMethod);
    bolt.s.eFlags = EF_BOUNCE_HALF; return bolt;
  }
  fireRocket(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    const spec = q3MissileParameters(Weapon.WP_ROCKET_LAUNCHER);
    return this.launch(self, start, normalizeDirection(direction), Weapon.WP_ROCKET_LAUNCHER, "rocket", spec.speed, spec.duration, spec.gravity, spec.direct, spec.splash, spec.radius, spec.method, spec.splashMethod);
  }
  fireBfg(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    const spec = q3MissileParameters(Weapon.WP_BFG);
    return this.launch(self, start, normalizeDirection(direction), Weapon.WP_BFG, "bfg", spec.speed, spec.duration, spec.gravity, spec.direct, spec.splash, spec.radius, spec.method, spec.splashMethod);
  }
  fireGrapple(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    const bolt = this.launch(self, start, normalizeDirection(direction), Weapon.WP_GRAPPLING_HOOK, "hook", 800, 10000, false, 0, 0, 0,
      this.host.combat.product === "baseq3" ? 23 : 28, 0);
    bolt.think = entity => { this.hookFree(entity); }; bolt.s.otherEntityNum = self.s.number; clientOf(self).hook = bolt; return bolt;
  }
  fireProx(self: GameEntity, start: Vec3, direction: MissileDirection): GameEntity {
    this.missionpack();
    const bolt = this.launch(self, start, normalizeDirection(direction), Weapon.WP_PROX_LAUNCHER, "prox mine", 700, 3000, true, 0, 100, 150, 25, 25);
    bolt.s.generic1 = clientOf(self).sess.sessionTeam; return bolt;
  }
  fireNail(self: GameEntity, start: Vec3, forward: Vec3, right: Vec3, up: Vec3): GameEntity {
    const random = this.missionpack().random;
    const bolt = this.launch(self, start, vec3(0, 0, 0), Weapon.WP_NAILGUN, "nail", 0, 10000, false, 20, 0, 0, 23, 0);
    const velocity = q3NailVelocity(start, forward, right, up, random);
    bolt.s.pos = { ...bolt.s.pos, time: this.host.combat.time, delta: snapVector(velocity) };
    return bolt;
  }
}
