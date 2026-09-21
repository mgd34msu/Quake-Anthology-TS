/* Quake II g_func.c platforms, secret doors and supporting brush entities. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, dot, integerField, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Use, Q2Touch, Q2Die } from "../../foundation/host.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2LinearMotionCheckpoint } from "../../foundation/motion.ts";
import { restoreQ2Actor } from "../../foundation/checkpoint.ts";
import { Q2LinearMotion } from "../../foundation/motion.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

export interface Q2PlatformState {
  readonly top: Vec3;
  readonly bottom: Vec3;
  phase: "top" | "bottom" | "up" | "down";
}
interface SecretState { readonly first: Vec3; readonly second: Vec3; readonly home: Vec3; readonly shootable: boolean; blockedTime: number; messageTime: number; }
export interface Q2BaseMoversCheckpoint {
  readonly platforms: readonly { readonly actor: SavedActorId; readonly state: Q2PlatformState }[];
  readonly secrets: readonly { readonly actor: SavedActorId; readonly state: SecretState }[];
  readonly linear: Q2LinearMotionCheckpoint;
}

function loop(entity: Q2Entity, game: Q2GameServices, path: string, start: boolean): undefined {
  return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path,
    channel: 2, volume: 1, attenuation: 3, reliable: false, loop: start ? "start" : "stop" });
}

function portals(entity: Q2Entity, game: Q2GameServices, open: boolean): undefined {
  for (const portal of game.targets(entity.target)) if (portal.classname === "func_areaportal") game.host.setAreaPortal(integerField(portal.spawn, "style"), open);
  return undefined;
}

/** Returns false after destroying a non-player obstruction, matching source blocked callbacks. */
function crush(entity: Q2Entity, game: Q2GameServices, other: ActorId): boolean {
  const body = game.host.bodies.read(other);
  if (body === null) return false;
  if (!game.host.isPlayer(other) && !game.host.isMonster(other)) {
    if (game.host.combat.read(other)?.canTakeDamage === true) game.damage(other, entity, entity.actor.id, 100000, 1, zero, body.origin, zero, 20);
    const obstacle = game.entity(other);
    if (obstacle !== null) {
      game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: body.origin, direction: zero, count: 1, color: 0 }); game.remove(obstacle);
    }
    return false;
  }
  game.damage(other, entity, entity.actor.id, entity.damage, 1, zero, body.origin, zero, 20);
  return true;
}

export class Q2BaseMoverEntities {
  readonly linear = new Q2LinearMotion("q2:base/linear");
  private platforms = new WeakMap<Q2Entity, Q2PlatformState>();
  private secrets = new WeakMap<Q2Entity, SecretState>();
  constructor(private readonly hooks: Q2BaseEntityHooks) {}

  get callbacks(): Q2CallbackDefinitions {
    return { think: { ...this.linear.callbacks.think, plat_hit_bottom: this.bottom, plat_hit_top: this.top, plat_go_down: this.down, plat_go_up: this.up,
      door_secret_done: this.secretDone, door_secret_move6: this.secretHome, door_secret_move5: this.secretReturnPause, door_secret_move4: this.secretReturn,
      door_secret_move3: this.secretOpened, door_secret_move2: this.secretSecond, door_secret_move1: this.secretPause,
      trigger_elevator_init: this.elevatorInit, func_object_release: this.objectRelease },
      use: { plat_use: this.platformUse, door_secret_use: this.secretUse, trigger_elevator_use: this.elevatorUse, func_conveyor_use: this.conveyorUse,
        func_killbox_use: this.killboxUse, func_object_use: this.objectUse },
      touch: { Touch_Plat_Center: this.platformTouch, door_secret_touch: this.secretTouch, func_object_touch: this.objectTouch },
      die: { door_secret_die: this.secretDie }, blocked: { plat_blocked: this.platformBlocked, door_secret_blocked: this.secretBlocked } };
  }

  capture(game: Q2GameServices): Q2BaseMoversCheckpoint {
    const platforms: Q2BaseMoversCheckpoint["platforms"][number][] = [], secrets: Q2BaseMoversCheckpoint["secrets"][number][] = [];
    for (const entity of game.entities.values()) {
      const actor = { slot: entity.actor.id.slot, generation: entity.actor.id.generation }, platform = this.platforms.get(entity), secret = this.secrets.get(entity);
      if (platform !== undefined) platforms.push({ actor, state: structuredClone(platform) });
      if (secret !== undefined) secrets.push({ actor, state: structuredClone(secret) });
    }
    return { platforms, secrets, linear: this.linear.capture(game) };
  }

  restore(game: Q2GameServices, checkpoint: Q2BaseMoversCheckpoint): undefined {
    this.platforms = new WeakMap<Q2Entity, Q2PlatformState>(); this.secrets = new WeakMap<Q2Entity, SecretState>();
    const entity = (actor: SavedActorId): Q2Entity => {
      const value = game.entity(restoreQ2Actor(game, actor).id); if (value === null) throw new Error("Missing saved Q2 base mover"); return value;
    };
    for (const saved of checkpoint.platforms) this.platforms.set(entity(saved.actor), structuredClone(saved.state));
    for (const saved of checkpoint.secrets) this.secrets.set(entity(saved.actor), structuredClone(saved.state));
    return this.linear.restore(game, checkpoint.linear);
  }

  platformState(entity: Q2Entity): Readonly<Q2PlatformState> | null { return this.platforms.get(entity) ?? null; }

  traversal(entity: Q2Entity): { readonly locked: boolean; readonly destination: Vec3 | null } | null {
    const platform = this.platforms.get(entity), destination = this.linear.destination(entity);
    if (platform === undefined && !this.secrets.has(entity)) return null;
    return { locked: platform !== undefined && platform.phase === "up" && entity.targetname !== ""
      && destination === null && entity.think === null, destination };
  }

  private platform(entity: Q2Entity): Q2PlatformState {
    const state = this.platforms.get(entity);
    if (state === undefined) throw new Error("Platform callback without platform state");
    return state;
  }

  private secret(entity: Q2Entity): SecretState {
    const state = this.secrets.get(entity); if (state === undefined) throw new Error("Secret door callback without source state"); return state;
  }

  private readonly platformUse: Q2Use = (self, game) => self.think !== null ? undefined : this.down(self, game);
  private readonly platformBlocked: NonNullable<Q2Entity["blocked"]> = (self, game, other) => {
    if (!crush(self, game, other)) return undefined;
    const phase = this.platform(self).phase;
    return phase === "up" ? this.down(self, game) : phase === "down" ? this.up(self, game) : undefined;
  };
  private readonly platformTouch: Q2Touch = (self, game, contact) => {
    if (!game.host.isPlayer(contact.other) || (game.host.combat.read(contact.other)?.health ?? 0) <= 0) return undefined;
    const platform = game.entity(self.enemy); if (platform === null) return undefined;
    const state = this.platform(platform);
    if (state.phase === "bottom") return this.up(platform, game);
    return state.phase === "top" ? game.schedule(platform, 1, this.down) : undefined;
  };
  private readonly secretDone: Q2Think = (self, game) => {
    if (this.secret(self).shootable) { game.host.combat.setHealth(self.actor, 0); game.host.combat.setTraits(self.actor, { canTakeDamage: true }); }
    return portals(self, game, false);
  };
  private readonly secretHome: Q2Think = (self, game) => this.linear.moveTo(self, game, this.secret(self).home, this.secretDone);
  private readonly secretReturnPause: Q2Think = (self, game) => game.schedule(self, 1, this.secretHome);
  private readonly secretReturn: Q2Think = (self, game) => this.linear.moveTo(self, game, this.secret(self).first, this.secretReturnPause);
  private readonly secretOpened: Q2Think = (self, game) => self.wait === -1 ? undefined : game.schedule(self, self.wait, this.secretReturn);
  private readonly secretSecond: Q2Think = (self, game) => this.linear.moveTo(self, game, this.secret(self).second, this.secretOpened);
  private readonly secretPause: Q2Think = (self, game) => game.schedule(self, 1, this.secretSecond);
  private readonly secretUse: Q2Use = (self, game) => {
    const origin = game.body(self).origin, state = this.secret(self);
    if (origin.x !== state.home.x || origin.y !== state.home.y || origin.z !== state.home.z) return undefined;
    this.linear.moveTo(self, game, state.first, this.secretPause); return portals(self, game, true);
  };
  private readonly secretDie: Q2Die = (self, game, reaction) => {
    game.host.combat.setTraits(self.actor, { canTakeDamage: false }); return self.use?.(self, game, reaction.attacker, reaction.attacker);
  };
  private readonly secretTouch: Q2Touch = (self, game, contact) => {
    const state = this.secret(self);
    if (!game.host.isPlayer(contact.other) || state.messageTime > game.host.now()) return undefined;
    state.messageTime = game.host.now() + 5; game.host.emit({ kind: "centerprint", actor: contact.other, text: self.message }); return game.sound(self, "misc/talk1.wav", 0);
  };
  private readonly secretBlocked: NonNullable<Q2Entity["blocked"]> = (self, game, other) => {
    if (!game.host.isPlayer(other) && !game.host.isMonster(other)) { crush(self, game, other); return undefined; }
    const state = this.secret(self); if (state.blockedTime > game.host.now()) return undefined;
    state.blockedTime = game.host.now() + 0.5; crush(self, game, other); return undefined;
  };

  private platformSound(entity: Q2Entity, game: Q2GameServices, start: boolean): undefined {
    game.sound(entity, start ? "plats/pt1_strt.wav" : "plats/pt1_end.wav", 2, 1, 3);
    return loop(entity, game, "plats/pt1_mid.wav", start);
  }

  private readonly bottom: Q2Think = (entity, game) => {
    this.platform(entity).phase = "bottom"; return this.platformSound(entity, game, false);
  };

  private readonly top: Q2Think = (entity, game) => {
    this.platform(entity).phase = "top"; this.platformSound(entity, game, false);
    return game.schedule(entity, 3, this.down);
  };

  private readonly down: Q2Think = (entity, game) => {
    const state = this.platform(entity); state.phase = "down"; this.platformSound(entity, game, true);
    return this.linear.moveTo(entity, game, state.bottom, this.bottom);
  };

  private readonly up: Q2Think = (entity, game) => {
    const state = this.platform(entity); state.phase = "up"; this.platformSound(entity, game, true);
    return this.linear.moveTo(entity, game, state.top, this.top);
  };

  private spawnPlatform(entity: Q2Entity, game: Q2GameServices): undefined {
    game.move(entity, { angles: zero }, false); game.solid(entity, "brush"); game.motion(entity, "push");
    entity.speed = entity.speed === 0 ? 20 : entity.speed * 0.1;
    entity.accel = entity.accel === 0 ? 5 : entity.accel * 0.1;
    entity.decel = entity.decel === 0 ? 5 : entity.decel * 0.1;
    entity.damage ||= 2;
    const body = game.body(entity), lip = numberField(entity.spawn, "lip") || 8;
    const height = numberField(entity.spawn, "height") || body.bounds.max.z - body.bounds.min.z - lip;
    const top = body.origin, bottom = { ...top, z: top.z - height };
    const state: Q2PlatformState = { top, bottom, phase: entity.targetname !== "" ? "up" : "bottom" };
    this.platforms.set(entity, state);
    entity.use = this.platformUse; entity.blocked = this.platformBlocked;
    const trigger = game.create("plat_trigger"); trigger.enemy = entity.actor.id; trigger.visible = false;
    let minX = body.bounds.min.x + 25, maxX = body.bounds.max.x - 25;
    let minY = body.bounds.min.y + 25, maxY = body.bounds.max.y - 25;
    const minZ = body.bounds.max.z + 8 - (height + lip);
    if (maxX - minX <= 0) { minX = (body.bounds.min.x + body.bounds.max.x) * 0.5; maxX = minX + 1; }
    if (maxY - minY <= 0) { minY = (body.bounds.min.y + body.bounds.max.y) * 0.5; maxY = minY + 1; }
    game.move(trigger, { bounds: { min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: (entity.spawnflags & 1) !== 0 ? minZ + 8 : body.bounds.max.z + 8 } } }, false);
    trigger.touch = this.platformTouch;
    game.solid(trigger, "trigger");
    if (entity.targetname === "") game.move(entity, { origin: bottom });
    return game.show(entity);
  }

  private spawnSecret(entity: Q2Entity, game: Q2GameServices): undefined {
    const axes = angleVectors(game.body(entity).angles);
    game.move(entity, { angles: zero }, false); game.solid(entity, "brush"); game.motion(entity, "push");
    const body = game.body(entity), size = subtract(body.bounds.max, body.bounds.min);
    const width = Math.abs(dot((entity.spawnflags & 4) !== 0 ? axes.up : axes.right, size));
    const length = Math.abs(dot(axes.forward, size));
    const first = add(body.origin, scale((entity.spawnflags & 4) !== 0 ? axes.up : axes.right, (entity.spawnflags & 4) !== 0 ? -width : (1 - (entity.spawnflags & 2)) * width));
    const second = add(first, scale(axes.forward, length));
    const home = zero;
    entity.damage ||= 2; entity.wait ||= 5; entity.speed = 50; entity.accel = 50; entity.decel = 50;
    const shootable = entity.targetname === "" || (entity.spawnflags & 1) !== 0;
    if (shootable || entity.maxHealth !== 0) game.host.combat.create(entity.actor, { health: shootable ? 0 : entity.maxHealth,
      armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    this.secrets.set(entity, { first, second, home, shootable, blockedTime: 0, messageTime: 0 });
    entity.use = this.secretUse;
    if (shootable || entity.maxHealth !== 0) entity.die = this.secretDie;
    else if (entity.targetname !== "" && entity.message !== "") entity.touch = this.secretTouch;
    entity.blocked = this.secretBlocked;
    return game.show(entity);
  }

  private readonly elevatorInit: Q2Think = (self, game) => {
    const train = game.pickTarget(self.target);
    if (train === null || train.classname !== "func_train") { game.host.diagnostic(`trigger_elevator has invalid train ${self.target}`); return undefined; }
    self.enemy = train.actor.id; self.visible = false; self.use = this.elevatorUse; return undefined;
  };
  private readonly elevatorUse: Q2Use = (self, game, other) => {
    const train = game.entity(self.enemy); if (train === null || train.nextThink !== null) return undefined;
    const path = game.entity(other)?.spawn.values.get("pathtarget") ?? "", corner = game.pickTarget(path);
    if (corner === null) { game.host.diagnostic(`trigger_elevator used with invalid pathtarget ${path}`); return undefined; }
    return this.hooks.movers.resumeTrainAt(train, game, corner);
  };
  private readonly conveyorUse: Q2Use = self => {
    if ((self.spawnflags & 1) !== 0) { self.speed = 0; self.spawnflags &= ~1; }
    else { self.speed = self.count; self.spawnflags |= 1; }
    if ((self.spawnflags & 2) === 0) self.count = 0; return undefined;
  };
  private readonly killboxUse: Q2Use = (self, game) => { killQ2Box(self, game); return undefined; };
  private readonly objectTouch: Q2Touch = (self, game, contact) => {
    if (contact.plane === null || contact.plane.normal.z < 1 || game.host.combat.read(contact.other)?.canTakeDamage !== true) return undefined;
    game.damage(contact.other, self, self.actor.id, self.damage, 1, zero, game.body(self).origin, zero, 20); return undefined;
  };
  private readonly objectRelease: Q2Think = (self, game) => { game.motion(self, "toss"); self.touch = this.objectTouch; return undefined; };
  private readonly objectUse: Q2Use = (self, game) => {
    self.visible = true; self.use = null; game.solid(self, "brush"); game.move(self, { bounds: game.body(self).bounds });
    killQ2Box(self, game); game.show(self); return this.objectRelease(self, game);
  };

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "func_plat": this.spawnPlatform(entity, game); return true;
      case "func_door_secret": this.spawnSecret(entity, game); return true;
      case "trigger_elevator":
        game.schedule(entity, game.host.frameSeconds(), this.elevatorInit);
        return true;
      case "func_conveyor":
        entity.speed ||= 100;
        if ((entity.spawnflags & 1) === 0) { entity.count = entity.speed; entity.speed = 0; }
        game.solid(entity, "brush"); game.show(entity);
        entity.use = this.conveyorUse;
        return true;
      case "func_killbox":
        entity.visible = false; game.solid(entity, "none");
        entity.use = this.killboxUse;
        return true;
      case "func_object": {
        game.solid(entity, "brush"); game.motion(entity, "push"); entity.damage ||= 100;
        const original = game.body(entity).bounds;
        const bounds = { min: add(original.min, { x: 1, y: 1, z: 1 }), max: add(original.max, { x: -1, y: -1, z: -1 }) };
        if (entity.spawnflags === 0) game.schedule(entity, 2 * game.host.frameSeconds(), this.objectRelease);
        else { entity.visible = false; game.solid(entity, "none"); entity.use = this.objectUse; }
        if ((entity.spawnflags & 2) !== 0) entity.effects |= 0x1000;
        if ((entity.spawnflags & 4) !== 0) entity.effects |= 0x2000;
        entity.clipMask = 0x2010003; game.move(entity, { bounds }); game.show(entity);
        return true;
      }
      default: return false;
    }
  }
}
