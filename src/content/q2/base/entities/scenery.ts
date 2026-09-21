/* Quake II g_misc.c clocks, decorative models and teleporters. GPL-2.0-or-later. */
import type { Bounds } from "../../../../contracts/math.ts";
import { add, integerField, scale, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch, Q2Use, Q2Die } from "../../foundation/host.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { vectorAngles } from "../../foundation/weapons/vectors.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import { restoreQ2Actor } from "../../foundation/checkpoint.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

function model(entity: Q2Entity, game: Q2GameServices, path: string, bounds: Bounds, solid: Q2Entity["solid"]): undefined {
  entity.model = path; game.move(entity, { bounds }, false); game.solid(entity, solid); return game.show(entity);
}

export function q2ClockText(seconds: number, style: number): string {
  const sec = String(seconds % 60).padStart(2, "0");
  if (style === 0) return String(seconds).padStart(2, " ");
  if (style === 1) return `${String(Math.trunc(seconds / 60)).padStart(2, " ")}:${sec}`;
  const hours = Math.trunc(seconds / 3600), minutes = Math.trunc((seconds - hours * 3600) / 60);
  return `${String(hours).padStart(2, " ")}:${String(minutes).padStart(2, "0")}:${sec}`;
}

export interface Q2BaseSceneryCheckpoint {
  readonly animations: readonly { readonly actor: SavedActorId; readonly first: number; readonly end: number }[];
  readonly clocks: readonly { readonly actor: SavedActorId; readonly value: number }[];
}
export class Q2BaseScenery {
  private animations = new WeakMap<Q2Entity, { readonly first: number; readonly end: number }>();
  private clocks = new WeakMap<Q2Entity, { value: number }>();
  constructor(private readonly hooks: Q2BaseEntityHooks) {}
  private animate(entity: Q2Entity, game: Q2GameServices, first: number, end: number, initialDelay = 0.2): undefined {
    this.animations.set(entity, { first, end }); entity.frame = first;
    game.show(entity); return game.schedule(entity, initialDelay, this.animateStep);
  }
  private readonly animateStep: Q2Think = (self, game) => {
    const state = this.animations.get(self); if (state === undefined) throw new Error("Missing saved scenery animation");
    self.frame++; if (self.frame >= state.end) self.frame = state.first;
    game.show(self); return game.schedule(self, game.host.frameSeconds(), this.animateStep);
  };
  private clockState(entity: Q2Entity): { value: number } {
    const state = this.clocks.get(entity); if (state === undefined) throw new Error("Missing saved Q2 clock state"); return state;
  }
  private resetClock(entity: Q2Entity): undefined {
    const state = this.clockState(entity); entity.activator = null;
    if ((entity.spawnflags & 1) !== 0) { state.value = 0; entity.wait = entity.count; }
    else if ((entity.spawnflags & 2) !== 0) { state.value = entity.count; entity.wait = 0; }
    return undefined;
  }
  private readonly commanderUse: Q2Use = (self, game) => { game.sound(self, "tank/pain.wav", 4); return game.schedule(self, game.host.frameSeconds(), this.commanderCollapse); };
  private readonly removeUse: Q2Use = (self, game) => game.remove(self);
  private readonly removeDie: Q2Die = (self, game) => game.remove(self);
  private readonly removeThink: Q2Think = (self, game) => game.remove(self);
  private readonly clockTick: Q2Think = (self, services) => {
    const state = this.clockState(self);
    let display = services.entity(self.enemy);
    if (display === null) { display = services.targets(self.target)[0] ?? null; self.enemy = display?.actor.id ?? null; }
    if (display === null) return undefined;
    if ((self.spawnflags & 1) !== 0) { self.message = q2ClockText(state.value, integerField(self.spawn, "style")); state.value++; }
    else if ((self.spawnflags & 2) !== 0) { self.message = q2ClockText(state.value, integerField(self.spawn, "style")); state.value--; }
    else {
      const time = this.hooks.localTime(); self.message = `${String(time.hour).padStart(2, " ")}:${String(time.minute).padStart(2, "0")}:${String(time.second).padStart(2, "0")}`;
    }
    self.message = self.message.slice(0, 15);
    display.message = self.message; services.host.callbacks.use(display.actor, self.actor.id, self.actor.id);
    if ((self.spawnflags & 1) !== 0 && state.value > self.wait || (self.spawnflags & 2) !== 0 && state.value < self.wait) {
      const pathTarget = self.spawn.values.get("pathtarget") ?? "";
      if (pathTarget !== "") {
        const previousTarget = self.target, previousMessage = self.message;
        self.target = pathTarget; self.message = "";
        try { services.useTargets(self, self.activator); } finally { self.target = previousTarget; self.message = previousMessage; }
      }
      if ((self.spawnflags & 8) === 0 || !services.host.actors.isLive(self.actor.id)) return undefined;
      this.resetClock(self);
      if ((self.spawnflags & 4) !== 0) return undefined;
    }
    return services.schedule(self, 1, this.clockTick);
  };

  private readonly clockUse: Q2Use = (self, services, _other, activator) => {
    if ((self.spawnflags & 8) === 0) self.use = null;
    if (self.activator !== null) return undefined;
    self.activator = activator; return this.clockTick(self, services);
  };

  private readonly teleporterTouch: Q2Touch = (self, services, contact) => {
    if (!services.host.isPlayer(contact.other)) return undefined;
    const destination = services.targets(self.target)[0], player = services.entity(contact.other);
    const owned = services.host.actors.resolveOwned(contact.other), body = services.host.bodies.read(contact.other);
    if (destination === undefined) { services.host.diagnostic(`Teleporter destination missing: ${self.target}`); return undefined; }
    if (owned === null || body === null) return undefined;
    const target = services.body(destination), origin = add(target.origin, { x: 0, y: 0, z: 10 });
    services.host.bodies.unlink(owned);
    services.host.bodies.write(owned, { ...body, origin, velocity: zero, angles: zero });
    this.hooks.teleportPlayer(contact.other, target.origin, target.angles);
    services.host.emit({ kind: "effect", effect: "q2:player-teleport", origin: (self.owner === null ? services.body(self).origin : services.host.bodies.read(self.owner)?.origin ?? services.body(self).origin), direction: zero, count: 1, color: 0 });
    services.host.emit({ kind: "effect", effect: "q2:player-teleport", origin, direction: zero, count: 1, color: 0 });
    if (player !== null) killQ2Box(player, services);
    else {
      for (;;) {
        const trace = services.host.trace({ start: origin, end: origin, bounds: body.bounds, ignore: contact.other, mask: 0x2010003 });
        if (trace.hit.kind !== "actor") break;
        const victim = trace.hit.actor;
        services.host.combat.apply({ attack: { ...services.attack(self, contact.other, 21, 32, null), inflictor: contact.other },
          target: victim, amount: 100000, knockback: 0, direction: zero, point: origin, normal: zero, delivery: "direct" });
        const check = services.host.trace({ start: origin, end: origin, bounds: body.bounds, ignore: contact.other, mask: 0x2010003 });
        if (check.hit.kind === "actor" && check.hit.actor.equals(victim)) break;
      }
    }
    services.host.bodies.link(owned); return undefined;
  };

  private readonly bombPrethink: Q2Think = (current, host) => {
    const diff = Math.max(-1, current.timestamp - host.host.now());
    const angles = vectorAngles({ ...scale(current.movedir, 1 + diff), z: diff });
    host.move(current, { ground: null, angles: { ...angles, z: host.body(current).angles.z + 10 } }, false);
    return undefined;
  };

  private readonly bombTouch: Q2Touch = (current, host) => {
    host.useTargets(current, current.activator);
    if (!host.host.actors.isLive(current.actor.id)) return undefined;
    const body = host.body(current); host.move(current, { origin: { ...body.origin, z: body.origin.z + body.bounds.min.z + 1 } }, false);
    host.radiusDamage(current, current.actor.id, current.damage, null, current.damage + 40, 27);
    host.host.emit({ kind: "effect", effect: "q2:explosion2", origin: host.body(current).origin, direction: zero, count: 1, color: 0 });
    return host.remove(current);
  };

  private readonly commanderCollapse: Q2Think = (self, services) => {
    self.frame++; services.show(self);
    if (self.frame === 22) services.sound(self, "tank/thud.wav", 4);
    if (self.frame < 24) services.schedule(self, services.host.frameSeconds(), this.commanderCollapse);
    return undefined;
  };

  private readonly commanderRelease: Q2Think = (self, services) => {
    services.move(self, { origin: add(services.body(self).origin, { x: 0, y: 0, z: 2 }) }); return services.motion(self, "toss");
  };

  private readonly bombUse: Q2Use = (self, services, _other, activator) => {
    const viper = [...services.entities.values()].find(candidate => candidate.classname === "misc_viper");
    if (viper === undefined) { services.host.diagnostic("misc_viper_bomb has no misc_viper"); return undefined; }
    const direction = this.hooks.movers.getTrainDirection(viper, services); self.movedir = direction; self.timestamp = services.host.now();
    self.visible = true; self.use = null; self.activator = activator; self.effects |= 16;
    services.move(self, { velocity: scale(direction, viper.speed) }, false);
    services.solid(self, "box"); services.motion(self, "toss"); services.show(self);
    self.prethink = this.bombPrethink;
    self.touch = this.bombTouch;
    return undefined;
  };
  private readonly stringUse: Q2Use = (self, services) => {
    const team = self.spawn.values.get("team");
    for (const member of services.entities.values()) {
      if (member.count === 0 || (team === undefined ? member !== self : member.spawn.values.get("team") !== team)) continue;
      const character = self.message[member.count - 1] ?? "";
      member.frame = /^[0-9]$/.test(character) ? Number(character) : character === "-" ? 10 : character === ":" ? 11 : 12;
      services.show(member);
    }
    return undefined;
  };
  private viperBomb(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.visible = false; entity.damage ||= 1000;
    model(entity, game, "models/objects/bomb/tris.md2", { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, "none");
    entity.use = this.bombUse; return undefined;
  }
  private clock(entity: Q2Entity, game: Q2GameServices): undefined {
    if (entity.target === "" || (entity.spawnflags & 2) !== 0 && entity.count === 0) {
      game.host.diagnostic(`func_clock without ${(entity.spawnflags & 2) !== 0 ? "count or target" : "target"}`); return game.remove(entity);
    }
    if ((entity.spawnflags & 1) !== 0 && entity.count === 0) entity.count = 3600;
    this.clocks.set(entity, { value: 0 }); this.resetClock(entity);
    if ((entity.spawnflags & 4) !== 0) entity.use = this.clockUse;
    else game.schedule(entity, 1, this.clockTick);
    return undefined;
  }
  get callbacks(): Q2CallbackDefinitions {
    return { think: { q2_base_scenery_animate: this.animateStep, func_clock_think: this.clockTick, misc_viper_bomb_prethink: this.bombPrethink,
      commander_body_think: this.commanderCollapse, commander_body_drop: this.commanderRelease, q2_base_scenery_remove: this.removeThink },
      use: { func_clock_use: this.clockUse, misc_viper_bomb_use: this.bombUse, commander_body_use: this.commanderUse, misc_blackhole_use: this.removeUse, target_string_use: this.stringUse },
      touch: { teleporter_touch: this.teleporterTouch, misc_viper_bomb_touch: this.bombTouch }, die: { q2_base_scenery_die: this.removeDie } };
  }
  capture(game: Q2GameServices): Q2BaseSceneryCheckpoint {
    const animations: Q2BaseSceneryCheckpoint["animations"][number][] = [], clocks: Q2BaseSceneryCheckpoint["clocks"][number][] = [];
    for (const entity of game.entities.values()) {
      const actor = { slot: entity.actor.id.slot, generation: entity.actor.id.generation }, animation = this.animations.get(entity), clock = this.clocks.get(entity);
      if (animation !== undefined) animations.push({ actor, ...animation });
      if (clock !== undefined) clocks.push({ actor, value: clock.value });
    }
    return { animations, clocks };
  }
  restore(game: Q2GameServices, checkpoint: Q2BaseSceneryCheckpoint): undefined {
    this.animations = new WeakMap<Q2Entity, { readonly first: number; readonly end: number }>(); this.clocks = new WeakMap<Q2Entity, { value: number }>();
    const reference = (actor: SavedActorId): Q2Entity => {
      const entity = game.entity(restoreQ2Actor(game, actor).id); if (entity === null) throw new Error("Missing saved Q2 scenery"); return entity;
    };
    for (const entry of checkpoint.animations) this.animations.set(reference(entry.actor), { first: entry.first, end: entry.end });
    for (const entry of checkpoint.clocks) this.clocks.set(reference(entry.actor), { value: entry.value });
    return undefined;
  }
  private teleporter(entity: Q2Entity, game: Q2GameServices): undefined {
    if (entity.target === "") { game.host.diagnostic("teleporter without a target"); return game.remove(entity); }
    entity.skin = 1; entity.effects = 0x20000;
    model(entity, game, "models/objects/dmspot/tris.md2", { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } }, "box");
    game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin,
      path: "world/amb10.wav", channel: 0, volume: 1, attenuation: 3, reliable: false, loop: "start" });
    const trigger = game.create("teleporter_trigger"); trigger.target = entity.target; trigger.owner = entity.actor.id; trigger.visible = false;
    game.move(trigger, { origin: game.body(entity).origin, bounds: { min: { x: -8, y: -8, z: 8 }, max: { x: 8, y: 8, z: 24 } } }, false);
    trigger.touch = this.teleporterTouch;
    return game.solid(trigger, "trigger");
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "viewthing":
        entity.renderFlags = 64;
        model(entity, game, "models/objects/banner/tris.md2", { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, "box");
        this.animate(entity, game, 0, 7, 0.5); return true;
      case "misc_blackhole":
        entity.renderFlags = 32; entity.use = this.removeUse;
        model(entity, game, "models/objects/black/tris.md2", { min: { x: -64, y: -64, z: 0 }, max: { x: 64, y: 64, z: 8 } }, "none");
        this.animate(entity, game, 0, 19); return true;
      case "misc_eastertank":
        model(entity, game, "models/monsters/tank/tris.md2", { min: { x: -32, y: -32, z: -16 }, max: { x: 32, y: 32, z: 32 } }, "box");
        this.animate(entity, game, 254, 293); return true;
      case "misc_easterchick": case "misc_easterchick2":
        model(entity, game, "models/monsters/bitch/tris.md2", { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 32 } }, "box");
        this.animate(entity, game, entity.classname === "misc_easterchick" ? 208 : 248, entity.classname === "misc_easterchick" ? 247 : 287); return true;
      case "monster_commander_body": {
        entity.renderFlags |= 64; entity.flags |= 16;
        model(entity, game, "models/monsters/commandr/tris.md2", { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 48 } }, "box");
        game.host.combat.create(entity.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: true, team: null });

        entity.use = this.commanderUse;
        game.schedule(entity, 5 * game.host.frameSeconds(), this.commanderRelease);
        return true;
      }
      case "misc_bigviper":
        model(entity, game, "models/ships/bigviper/tris.md2", { min: { x: -176, y: -120, z: -24 }, max: { x: 176, y: 120, z: 72 } }, "box"); return true;
      case "misc_viper_bomb": this.viperBomb(entity, game); return true;
      case "light_mine1": case "light_mine2":
        entity.model = entity.classname === "light_mine1" ? "models/objects/minelite/light1/tris.md2" : "models/objects/minelite/light2/tris.md2";
        game.link(entity); game.show(entity); return true;
      case "misc_gib_arm": case "misc_gib_leg":
        entity.model = `models/objects/gibs/${entity.classname === "misc_gib_arm" ? "arm" : "leg"}/tris.md2`;
        entity.effects |= 2; entity.serverFlags |= 4;
        entity.angularVelocity = { x: game.host.random() * 200, y: game.host.random() * 200, z: game.host.random() * 200 };
        game.host.combat.create(entity.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
        entity.die = this.removeDie;
        game.motion(entity, "toss"); game.solid(entity, "none"); game.show(entity);
        game.schedule(entity, 30, this.removeThink); return true;
      case "target_character":
        entity.frame = 12; game.motion(entity, "push"); game.solid(entity, "brush"); game.show(entity); return true;
      case "target_string":
        entity.use = this.stringUse;
        return true;
      case "func_clock": this.clock(entity, game); return true;
      case "misc_teleporter": this.teleporter(entity, game); return true;
      case "misc_teleporter_dest":
        entity.skin = 0; model(entity, game, "models/objects/dmspot/tris.md2", { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } }, "box"); return true;
      default: return false;
    }
  }

}
