/* Rogue g_func.c plat2 and g_newfnc.c secret doors/force walls. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch, Q2Use } from "../../foundation/host.ts";
import { add, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import type { Q2MissionPackEntityHooks } from "./types.ts";
import { explode } from "../projectiles/common.ts";

export class Q2RogueMovers implements Q2SpawnModule {
  constructor(readonly hooks: Q2MissionPackEntityHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { plat2_go_up: this.up, plat2_go_down: this.down, plat2_hit_top: this.top, plat2_hit_bottom: this.bottom,
      fd_secret_move1: this.secret1, fd_secret_move2: this.secret2, fd_secret_move3: this.secret3, fd_secret_move4: this.secret4,
      fd_secret_move5: this.secret5, fd_secret_move6: this.secret6, fd_secret_done: this.secretDone, force_wall_think: this.forceThink },
      use: { Use_Plat2: this.platUse, plat2_activate: this.activate, fd_secret_use: this.secretUse, force_wall_use: this.forceUse },
      touch: { Touch_Plat_Center2: this.platTouch, secret_touch: this.secretTouch }, die: { fd_secret_killed: this.secretDie },
      blocked: { plat2_blocked: this.platBlocked, secret_blocked: this.secretBlocked } };
  }

  platformState(entity: Q2Entity): { readonly top: typeof entity.pos1; readonly bottom: typeof entity.pos2; readonly phase: "top" | "bottom" | "up" | "down" } | null {
    return entity.classname !== "func_plat2" ? null : { top: entity.pos1, bottom: entity.pos2,
      phase: entity.style === 0 ? "top" : entity.style === 1 ? "bottom" : entity.style === 2 ? "up" : "down" };
  }

  private sound(entity: Q2Entity, game: Q2GameServices, start: boolean): undefined {
    if ((entity.flags & 1024) !== 0) return undefined;
    game.sound(entity, start ? "plats/pt1_strt.wav" : "plats/pt1_end.wav", 10, 1, 3);
    entity.sound = start ? "plats/pt1_mid.wav" : "";
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: "plats/pt1_mid.wav", channel: 0,
      volume: 1, attenuation: 3, reliable: false, loop: start ? "start" : "stop" });
  }

  private hit(entity: Q2Entity, game: Q2GameServices, top: boolean): undefined {
    this.sound(entity, game, false); entity.style = top ? 0 : 1;
    const returning = top ? this.down : this.up;
    if ((entity.count & 1) !== 0) {
      entity.count = 4;
      if ((entity.spawnflags & 2) === 0) game.schedule(entity, 5, returning);
      entity.timestamp = game.host.now() - (game.options.mode === "deathmatch" ? 1 : 2);
    } else {
      entity.count = 0; entity.timestamp = game.host.now();
      if (((entity.spawnflags & 4) !== 0) !== top && (entity.spawnflags & 2) === 0) game.schedule(entity, 2, returning);
    }
    if (!top) for (const area of [...game.entities.values()]) if (area.classname === "bad_area" && area.owner === entity.actor.id) game.remove(area);
    return game.useTargets(entity, entity.actor.id);
  }
  private readonly top: Q2Think = (entity, game) => this.hit(entity, game, true);
  private readonly bottom: Q2Think = (entity, game) => this.hit(entity, game, false);
  private readonly down: Q2Think = (entity, game) => {
    this.sound(entity, game, true); entity.style = 3; entity.count |= 2;
    return this.hooks.movers.linear.moveTo(entity, game, entity.pos2, this.bottom);
  };
  private readonly up: Q2Think = (entity, game) => {
    this.sound(entity, game, true); entity.style = 2; entity.count |= 2;
    const bounds = game.body(entity).bounds;
    this.hooks.projectiles.spawnBadArea(game, bounds.min, { ...bounds.max, z: bounds.min.z + 64 }, 0, entity.actor.id);
    return this.hooks.movers.linear.moveTo(entity, game, entity.pos1, this.top);
  };

  private operate(trigger: Q2Entity, game: Q2GameServices, actor: ActorId): undefined {
    const entity = game.entity(trigger.enemy), other = game.host.bodies.read(actor);
    if (entity === null || other === null || (entity.count & 2) !== 0 || entity.timestamp + 2 > game.host.now()) return undefined;
    const bounds = game.body(trigger), min = add(bounds.origin, bounds.bounds.min), max = add(bounds.origin, bounds.bounds.max), center = (min.z + max.z) / 2;
    const otherState = entity.style === 0 ? (((entity.spawnflags & 32) !== 0 ? center : max.z) > other.origin.z ? 1 : 0) : other.origin.z > center ? 0 : 1;
    entity.count = 2;
    let pause = game.options.mode === "deathmatch" ? 0.3 : 0.5;
    if (entity.style !== otherState) { entity.count |= 1; pause = 0.1; }
    entity.timestamp = game.host.now(); return game.schedule(entity, pause, entity.style === 1 ? this.up : this.down);
  }

  private readonly platTouch: Q2Touch = (entity, game, contact) => {
    if ((game.host.combat.read(contact.other)?.health ?? 0) <= 0 || !game.host.isPlayer(contact.other) && !game.host.isMonster(contact.other)) return undefined;
    return this.operate(entity, game, contact.other);
  };
  private readonly platUse: Q2Use = (entity, game, _other, activator) => {
    if (entity.style > 1 || entity.timestamp + 2 > game.host.now() || activator === null) return undefined;
    for (const trigger of game.entities.values()) if (trigger.touch === this.platTouch && trigger.enemy === entity.actor.id) return this.operate(trigger, game, activator);
    return undefined;
  };
  private readonly activate: Q2Use = (entity, game) => { entity.use = this.platUse; this.trigger(entity, game); return this.down(entity, game); };
  private readonly platBlocked: NonNullable<Q2Entity["blocked"]> = (entity, game, other) => {
    const body = game.host.bodies.read(other);
    if (body === null) return undefined;
    if (!game.host.isMonster(other) && !game.host.isPlayer(other)) {
      game.damage(other, entity, entity.actor.id, 100000, 1, zero, body.origin, zero, 20);
      const target = game.entity(other); return target === null ? undefined : explode(target, game);
    }
    if ((game.host.combat.read(other)?.health ?? 0) < 1) game.damage(other, entity, entity.actor.id, 100, 1, zero, body.origin, zero, 20);
    game.damage(other, entity, entity.actor.id, entity.damage, 1, zero, body.origin, zero, 20);
    return entity.style === 2 ? this.down(entity, game) : entity.style === 3 ? this.up(entity, game) : undefined;
  };

  private trigger(entity: Q2Entity, game: Q2GameServices): undefined {
    const bounds = game.body(entity).bounds, lip = numberField(entity.spawn, "lip");
    let minX = bounds.min.x + 25, minY = bounds.min.y + 25, maxX = bounds.max.x - 25, maxY = bounds.max.y - 25;
    const minZ = bounds.max.z + 8 - (entity.pos1.z - entity.pos2.z + lip), maxZ = (entity.spawnflags & 1) !== 0 ? minZ + 8 : bounds.max.z + 8;
    if (maxX - minX <= 0) { minX = (bounds.min.x + bounds.max.x) * 0.5; maxX = minX + 1; }
    if (maxY - minY <= 0) { minY = (bounds.min.y + bounds.max.y) * 0.5; maxY = minY + 1; }
    const trigger = game.create("plat2_trigger"); trigger.enemy = entity.actor.id; trigger.touch = this.platTouch; trigger.visible = false;
    game.move(trigger, { bounds: { min: { x: minX - 10, y: minY - 10, z: minZ }, max: { x: maxX + 10, y: maxY + 10, z: maxZ } } });
    return game.solid(trigger, "trigger");
  }

  private spawnPlatform(entity: Q2Entity, game: Q2GameServices): undefined {
    game.move(entity, { angles: zero }); game.solid(entity, "brush"); game.motion(entity, "push"); entity.blocked = this.platBlocked;
    const multiplier = game.options.mode === "deathmatch" ? 2 : 1;
    entity.speed = (entity.speed === 0 ? 20 : entity.speed * 0.1) * multiplier;
    entity.accel = (entity.accel === 0 ? 5 : entity.accel * 0.1) * multiplier;
    entity.decel = (entity.decel === 0 ? 5 : entity.decel * 0.1) * multiplier; entity.damage ||= 2;
    const body = game.body(entity), lip = numberField(entity.spawn, "lip"), height = numberField(entity.spawn, "height") || body.bounds.max.z - body.bounds.min.z;
    entity.pos1 = body.origin; entity.pos2 = { ...body.origin, z: body.origin.z - height + lip }; entity.style = 0; entity.count = 0;
    if (entity.targetname !== "" && !(game.options.edition === "rerelease" && (entity.spawnflags & 8) !== 0)) entity.use = this.activate;
    else {
      entity.use = this.platUse; this.trigger(entity, game);
      if ((entity.spawnflags & 4) === 0) { game.move(entity, { origin: entity.pos2 }); entity.style = 1; }
    }
    return game.show(entity);
  }

  private readonly secretUse: Q2Use = (entity, game) => {
    if ((entity.flags & 1024) !== 0) return undefined;
    let member: Q2Entity | null = entity;
    while (member !== null) { this.hooks.movers.linear.moveTo(member, game, member.pos1, this.secret1); member = game.entity(member.teamChain); }
    return undefined;
  };
  private readonly secretDie: Q2Die = (entity, game, reaction) => {
    game.host.combat.setHealth(entity.actor, entity.maxHealth); game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    const master = game.entity(entity.teamMaster);
    return (entity.flags & 1024) !== 0 && master !== null && game.host.combat.read(master.actor.id)?.canTakeDamage === true
      ? this.secretDie(master, game, { ...reaction, self: master.actor }) : this.secretUse(entity, game, reaction.inflictor, reaction.attacker);
  };
  private readonly secret1: Q2Think = (entity, game) => game.schedule(entity, 1, this.secret2);
  private readonly secret2: Q2Think = (entity, game) => this.hooks.movers.linear.moveTo(entity, game, entity.pos2, this.secret3);
  private readonly secret3: Q2Think = (entity, game) => (entity.spawnflags & 1) !== 0 ? undefined : game.schedule(entity, entity.wait, this.secret4);
  private readonly secret4: Q2Think = (entity, game) => this.hooks.movers.linear.moveTo(entity, game, entity.pos1, this.secret5);
  private readonly secret5: Q2Think = (entity, game) => game.schedule(entity, 1, this.secret6);
  private readonly secret6: Q2Think = (entity, game) => this.hooks.movers.linear.moveTo(entity, game, entity.movedir, this.secretDone);
  private readonly secretDone: Q2Think = (entity, game) => {
    if (entity.targetname === "" || (entity.spawnflags & 16) !== 0) {
      game.host.combat.setHealth(entity.actor, 1); game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); entity.die = this.secretDie;
    }
    return undefined;
  };
  private readonly secretBlocked: NonNullable<Q2Entity["blocked"]> = (entity, game, other) => {
    const body = game.host.bodies.read(other);
    if ((entity.flags & 1024) === 0 && body !== null) game.damage(other, entity, entity.actor.id, entity.damage, 0, zero, body.origin, zero, 20);
    return undefined;
  };
  private readonly secretTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other) || (game.host.combat.read(contact.other)?.health ?? 0) <= 0 || entity.timestamp > game.host.now()) return undefined;
    entity.timestamp = game.host.now() + 2;
    return entity.message === "" ? undefined : game.host.emit({ kind: "centerprint", actor: contact.other, text: entity.message });
  };
  private spawnSecret(entity: Q2Entity, game: Q2GameServices): undefined {
    const angles = game.body(entity).angles, axes = angleVectors(angles);
    game.move(entity, { angles: zero }); game.solid(entity, "brush"); game.motion(entity, "push");
    const body = game.body(entity), size = subtract(body.bounds.max, body.bounds.min);
    if (![0, 90, 180, 270].includes(angles.y)) { game.host.diagnostic("Secret door not at 0,90,180,270!"); return game.remove(entity); }
    const forward = scale(axes.forward, (angles.y === 0 || angles.y === 180 ? size.x : size.y) * ((entity.spawnflags & 64) !== 0 ? 1 : -1));
    const right = scale(axes.right, (angles.y === 0 || angles.y === 180 ? size.y : size.x) * ((entity.spawnflags & 32) !== 0 ? 1 : -1));
    entity.movedir = body.origin; entity.pos1 = add(body.origin, (entity.spawnflags & 4) !== 0 ? forward : right);
    entity.pos2 = add(entity.pos1, (entity.spawnflags & 4) !== 0 ? right : forward);
    entity.damage ||= 2; entity.wait ||= 5; entity.speed = entity.accel = entity.decel = 50;
    entity.touch = this.secretTouch; entity.blocked = this.secretBlocked; entity.use = this.secretUse;
    if (entity.targetname === "" || (entity.spawnflags & 16) !== 0) {
      entity.maxHealth = 1; entity.die = this.secretDie;
      game.host.combat.create(entity.actor, { health: 1, mass: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, canTakeDamage: true, invulnerable: false, team: null });
    }
    return game.show(entity);
  }

  private readonly forceThink: Q2Think = (entity, game) => {
    if (entity.wait === 0) this.hooks.emit({ kind: "force-wall", start: entity.pos1, end: entity.pos2, color: entity.style });
    return game.schedule(entity, 0.1, this.forceThink);
  };
  private readonly forceUse: Q2Use = (entity, game) => {
    if (entity.wait === 0) { entity.wait = 1; game.cancel(entity); return game.solid(entity, "none"); }
    entity.wait = 0; game.schedule(entity, 0.1, this.forceThink); game.solid(entity, "brush"); killQ2Box(entity, game); return game.link(entity);
  };
  private spawnForceWall(entity: Q2Entity, game: Q2GameServices): undefined {
    game.solid(entity, "brush");
    const body = game.body(entity), min = add(body.origin, body.bounds.min), max = add(body.origin, body.bounds.max), middle = scale(add(min, max), 0.5);
    if (max.x - min.x > max.y - min.y) { entity.pos1 = { x: min.x, y: middle.y, z: max.z }; entity.pos2 = { x: max.x, y: middle.y, z: max.z }; }
    else { entity.pos1 = { x: middle.x, y: min.y, z: max.z }; entity.pos2 = { x: middle.x, y: max.y, z: max.z }; }
    entity.style ||= 208; entity.wait = 1; entity.use = this.forceUse; entity.visible = false;
    game.motion(entity, "stationary");
    if ((entity.spawnflags & 1) !== 0) game.schedule(entity, 0.1, this.forceThink); else game.solid(entity, "none");
    return game.show(entity);
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    game.sourceCallbacks.register(this.callbacks);
    if (entity.classname === "func_plat2") this.spawnPlatform(entity, game);
    else if (entity.classname === "func_door_secret2") this.spawnSecret(entity, game);
    else if (entity.classname === "func_force_wall") this.spawnForceWall(entity, game);
    else return false;
    return true;
  }
}
