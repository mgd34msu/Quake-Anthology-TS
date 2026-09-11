import { add, numberField, movedir, scale, zero } from "../foundation/fields.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch, Q2Use } from "../foundation/host.ts";
import type { Q2RereleasePlayers } from "./players.ts";
import type { Q2RereleaseHooks } from "./types.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { killQ2RereleaseBox } from "./killbox.ts";

export class Q2RereleaseTriggers implements Q2SpawnModule {
  readonly soundTimes = new Map<ActorId, number>();
  constructor(readonly players: Q2RereleasePlayers, readonly hooks: Q2RereleaseHooks) {}

  private init(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.visible = false; entity.serverFlags |= 1; entity.movedir = movedir(game.body(entity).angles);
    game.move(entity, { angles: zero }, false); game.solid(entity, "trigger"); return undefined;
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "func_killbox": entity.visible = false; entity.serverFlags |= 1; game.solid(entity, "none"); entity.use = this.killboxUse; return true;
      case "trigger_push":
        this.init(entity, game); entity.speed ||= 1000; entity.touch = this.pushTouch;
        if ((entity.spawnflags & 2) !== 0) { entity.wait ||= 10; entity.delay = game.host.now() + 0.1 + entity.wait; game.schedule(entity, 0.1, this.pushActive); }
        if (entity.targetname !== "") { entity.use = this.toggleUse; if ((entity.spawnflags & 8) !== 0) game.solid(entity, "none"); }
        else if ((entity.spawnflags & 8) !== 0) { entity.serverFlags = 0; entity.touch = null; entity.visible = true; game.solid(entity, "brush"); game.motion(entity, "push"); }
        game.link(entity); return true;
      case "trigger_hurt":
        this.init(entity, game); entity.damage ||= 5; entity.touch = this.hurtTouch; entity.noise = "world/electro.wav";
        if ((entity.spawnflags & 1) !== 0) game.solid(entity, "none");
        if ((entity.spawnflags & 2) !== 0) entity.use = this.hurtUse;
        game.link(entity); return true;
      case "trigger_gravity":
        if (!entity.spawn.values.has("gravity")) { game.host.diagnostic("trigger_gravity: no gravity set"); game.remove(entity); return true; }
        this.init(entity, game); entity.gravity = numberField(entity.spawn, "gravity"); entity.touch = this.gravityTouch;
        if ((entity.spawnflags & 3) !== 0) entity.use = this.toggleUse;
        if ((entity.spawnflags & 2) !== 0) game.solid(entity, "none");
        game.link(entity); return true;
      case "trigger_monsterjump": {
        const angles = game.body(entity).angles;
        if (angles.y === 0) game.move(entity, { angles: { ...angles, y: 360 } }, false);
        this.init(entity, game); entity.speed ||= 200; entity.movedir = { ...entity.movedir, z: numberField(entity.spawn, "height") || 200 }; entity.touch = this.monsterJumpTouch;
        if ((entity.spawnflags & 3) !== 0) entity.use = this.toggleUse;
        if ((entity.spawnflags & 2) !== 0) game.solid(entity, "none");
        game.link(entity); return true;
      }
      case "target_gravity": entity.gravity = numberField(entity.spawn, "gravity"); entity.use = this.worldGravityUse; return true;
      case "target_soundfx": {
        entity.volume ||= 1; entity.attenuation = entity.attenuation === -1 ? 0 : entity.attenuation || 1;
        const sounds: ReadonlyMap<number, string> = new Map([[1, "world/x_alarm.wav"], [2, "world/flyby1.wav"], [4, "world/amb12.wav"], [5, "world/amb17.wav"], [7, "world/bigpump2.wav"]]);
        const sound = sounds.get(numberField(entity.spawn, "noise"));
        if (sound === undefined) { game.host.diagnostic(`target_soundfx: unknown noise ${entity.spawn.values.get("noise") ?? "0"}`); return true; }
        entity.noise = sound; entity.use = this.soundFxUse; return true;
      }
      default: return false;
    }
  }

  private readonly toggleUse: Q2Use = (entity, game) => { game.solid(entity, entity.solid === "none" ? "trigger" : "none"); return game.link(entity); };
  private readonly killboxUse: Q2Use = (entity, game) => {
    this.players.deadlyKillBox = (entity.spawnflags & 2) !== 0;
    game.solid(entity, "trigger"); game.link(entity);
    try { killQ2RereleaseBox(entity, game, this.players, false, (entity.spawnflags & 4) !== 0); }
    finally { game.solid(entity, "none"); game.link(entity); this.players.deadlyKillBox = false; }
    return undefined;
  };
  private readonly hurtUse: Q2Use = (entity, game, other, activator) => { this.toggleUse(entity, game, other, activator); if ((entity.spawnflags & 2) === 0) entity.use = null; return undefined; };
  private readonly worldGravityUse: Q2Use = entity => this.hooks.setWorldGravity(entity.gravity);
  private readonly soundFxUse: Q2Use = (entity, game) => game.schedule(entity, entity.delay, this.soundFxThink);
  private readonly soundFxThink: Q2Think = (entity, game) => game.sound(entity, entity.noise, 2, entity.volume, entity.attenuation);

  private readonly pushTouch: Q2Touch = (entity, game, contact) => {
    if ((entity.spawnflags & 16) !== 0 && !this.hooks.clipTrigger(entity, contact.other, game)) return undefined;
    const other = game.entity(contact.other), owner = game.host.actors.resolveOwned(contact.other), body = game.host.bodies.read(contact.other);
    if (owner !== null && body !== null && (other?.classname === "grenade" || (game.host.combat.read(contact.other)?.health ?? 0) > 0)) {
      const velocity = scale(entity.movedir, entity.speed * 10);
      game.host.bodies.write(owner, { ...body, velocity });
      if (other !== null) game.motion(other, other.motion);
      if (game.host.isPlayer(contact.other)) {
        const state = this.players.states.get(contact.other), extra = this.players.extra(contact.other);
        if (state !== undefined) state.oldVelocity = velocity;
        this.hooks.pushPlayer(contact.other, velocity);
        if ((entity.spawnflags & 4) === 0 && extra.windSoundTime < game.host.now()) {
          extra.windSoundTime = game.host.now() + 1.5;
          game.host.emit({ kind: "sound", actor: contact.other, origin: body.origin, path: "misc/windfly.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
        }
      }
    }
    if ((entity.spawnflags & 1) !== 0) game.remove(entity);
    return undefined;
  };

  private readonly pushActive: Q2Think = (entity, game) => {
    if (entity.delay > game.host.now()) {
      const body = game.body(entity); let origin = add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5));
      for (let index = 0; index < 10; index++) {
        origin = add(origin, { x: 0, y: 0, z: entity.speed * 0.01 * (index + game.host.random()) });
        game.host.emit({ kind: "effect", effect: "q2:tunnel-sparks", origin, direction: zero, count: 1, color: 0x74 + Math.floor(game.host.random() * 8) });
      }
      return game.schedule(entity, 0.1, this.pushActive);
    }
    entity.touch = null; entity.delay = game.host.now() + 0.1 + entity.wait;
    return game.schedule(entity, 0.1, this.pushInactive);
  };
  private readonly pushInactive: Q2Think = (entity, game) => {
    if (entity.delay > game.host.now()) return game.schedule(entity, 0.1, this.pushInactive);
    entity.touch = this.pushTouch; entity.delay = game.host.now() + 0.1 + entity.wait;
    return game.schedule(entity, 0.1, this.pushActive);
  };
  private readonly hurtTouch: Q2Touch = (entity, game, contact) => {
    const target = game.entity(contact.other), body = game.host.bodies.read(contact.other), player = game.host.isPlayer(contact.other), monster = game.host.isMonster(contact.other);
    if (body === null || game.host.combat.read(contact.other)?.canTakeDamage !== true || !player && !monster && target?.damageableTarget !== true && target?.classname !== "misc_explobox") return undefined;
    if ((entity.spawnflags & 32) !== 0 && player || (entity.spawnflags & 64) !== 0 && monster || entity.timestamp > game.host.now()) return undefined;
    if ((entity.spawnflags & 128) !== 0 && !this.hooks.clipTrigger(entity, contact.other, game)) return undefined;
    entity.timestamp = game.host.now() + ((entity.spawnflags & 16) !== 0 ? 1 : 0.1);
    if ((entity.spawnflags & 4) === 0 && (this.soundTimes.get(entity.actor.id) ?? 0) < game.host.now()) {
      this.soundTimes.set(entity.actor.id, game.host.now() + 1);
      game.host.emit({ kind: "sound", actor: contact.other, origin: body.origin, path: entity.noise, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
    }
    game.damage(contact.other, entity, entity.actor.id, entity.damage, entity.damage, zero, body.origin, zero, 31, (entity.spawnflags & 8) !== 0 ? 32 : 0);
    return undefined;
  };
  private readonly gravityTouch: Q2Touch = (entity, game, contact) => {
    if ((entity.spawnflags & 4) !== 0 && !this.hooks.clipTrigger(entity, contact.other, game)) return undefined;
    const target = game.entity(contact.other);
    if (target !== null) { target.gravity = entity.gravity; game.motion(target, target.motion); }
    return this.hooks.setActorGravity(contact.other, entity.gravity);
  };
  private readonly monsterJumpTouch: Q2Touch = (entity, game, contact) => {
    const target = game.entity(contact.other), body = game.host.bodies.read(contact.other);
    if (target === null || body === null || !game.host.isMonster(contact.other) || (target.flags & 3) !== 0 || (target.serverFlags & 2) !== 0) return undefined;
    if ((entity.spawnflags & 4) !== 0 && !this.hooks.clipTrigger(entity, contact.other, game)) return undefined;
    const grounded = body.ground !== null || game.host.trace({ start: body.origin, end: add(body.origin, { x: 0, y: 0, z: -0.25 }), bounds: body.bounds, ignore: target.actor.id, mask: target.clipMask }).fraction < 1;
    game.move(target, { velocity: { x: entity.movedir.x * entity.speed, y: entity.movedir.y * entity.speed, z: grounded ? entity.movedir.z : body.velocity.z }, ground: null }, false);
    game.motion(target, target.motion); return undefined;
  };
  readonly callbacks: Q2CallbackDefinitions = {
    think: { "rr.trigger_push_active": this.pushActive, "rr.trigger_push_inactive": this.pushInactive, "rr.update_target_soundfx": this.soundFxThink },
    touch: { "rr.trigger_push_touch": this.pushTouch, "rr.hurt_touch": this.hurtTouch, "rr.trigger_gravity_touch": this.gravityTouch, "rr.trigger_monsterjump_touch": this.monsterJumpTouch },
    use: { "rr.trigger_gravity_use": this.toggleUse, "rr.hurt_use": this.hurtUse, "rr.use_target_gravity": this.worldGravityUse, "rr.use_target_soundfx": this.soundFxUse, "rr.use_killbox": this.killboxUse },
  };
}
