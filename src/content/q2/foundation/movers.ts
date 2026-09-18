/* Doors, buttons, trains and rotating brushes from Quake II game/g_func.c. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { add, dot, integerField, length, movedir, normalize, numberField, scale, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use, Q2Touch, Q2Die } from "./host.ts";
import { Q2LinearMotion } from "./motion.ts";
import { Q2AngularMotion } from "./angular-motion.ts";
import type { Q2LinearMotionCheckpoint } from "./motion.ts";
import type { Q2AngularMotionCheckpoint } from "./angular-motion.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "./callbacks.ts";
import { restoreQ2Actor } from "./checkpoint.ts";

interface DoorState {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly distance: number;
  readonly button: boolean;
  readonly angular: boolean;
  readonly water: boolean;
  readonly safeDirection: Vec3;
  readonly waterDivisor: number;
  reversed: boolean;
  activated: boolean;
  phase: "bottom" | "up" | "top" | "down";
  master: Q2Entity;
  team: Q2Entity[];
  debounce: number;
}
interface TrainState { destination: Q2Entity | null; debounce: number; readonly ship: boolean; }
export interface Q2TrainRoute {
  readonly running: boolean;
  readonly destination: ActorId | null;
  readonly stops: readonly { readonly actor: ActorId; readonly origin: Vec3; readonly next: ActorId | null;
    readonly wait: number; readonly teleport: boolean }[];
}
export interface Q2MoversCheckpoint {
  readonly doors: readonly { readonly actor: SavedActorId; readonly state: Omit<DoorState, "master" | "team">;
    readonly master: SavedActorId; readonly team: readonly SavedActorId[] }[];
  readonly trains: readonly { readonly actor: SavedActorId; readonly destination: SavedActorId | null; readonly debounce: number; readonly ship: boolean }[];
  readonly linear: Q2LinearMotionCheckpoint;
  readonly angular: Q2AngularMotionCheckpoint;
}
export interface Q2MoverHooks {
  pathCorner(corner: Q2Entity, game: Q2GameServices, other: ActorId): undefined;
  combatPoint(point: Q2Entity, game: Q2GameServices, other: ActorId): undefined;
}

export class Q2MoverModule implements Q2SpawnModule {
  readonly linear = new Q2LinearMotion("q2:foundation/linear");
  readonly angular = new Q2AngularMotion("q2:foundation/angular");
  private doors = new WeakMap<Q2Entity, DoorState>();
  private trains = new WeakMap<Q2Entity, TrainState>();
  constructor(private readonly hooks: Q2MoverHooks) {}

  /** Observes the deterministic source route without advancing callbacks or consuming target-selection randomness. */
  trainRoute(entity: Q2Entity, game: Q2GameServices): Q2TrainRoute | null {
    const state = this.trains.get(entity);
    if (state === undefined || state.ship) return null;
    const targets = new Map<string, Q2Entity | null>();
    for (const candidate of game.entities.values()) {
      if (candidate.targetname === "") continue;
      targets.set(candidate.targetname, targets.has(candidate.targetname) || candidate.classname !== "path_corner" ? null : candidate);
    }
    const target = (name: string): Q2Entity | null => targets.get(name) ?? null;
    let corner = target(entity.spawn.values.get("target") ?? entity.target);
    const stops: Q2TrainRoute["stops"][number][] = [], visited = new Set<ActorId>();
    while (corner !== null && !visited.has(corner.actor.id)) {
      visited.add(corner.actor.id);
      const next = target(corner.target);
      if (corner.target !== "" && next === null) return null;
      stops.push({ actor: corner.actor.id, origin: this.trainDestination(entity, corner, game), next: next?.actor.id ?? null,
        wait: corner.wait, teleport: (corner.spawnflags & 1) !== 0 });
      corner = next;
    }
    if (state.destination !== null && !visited.has(state.destination.actor.id)) return null;
    return { running: (entity.spawnflags & 1) !== 0, destination: state.destination?.actor.id ?? null, stops };
  }

  traversal(entity: Q2Entity): { readonly locked: boolean; readonly destination: Vec3 | null } {
    const state = this.doors.get(entity);
    const master = state?.master ?? entity, door = this.doors.get(master);
    return { locked: door !== undefined && (door.phase === "bottom" || door.phase === "down")
      && (master.use === this.doorActivate || !door.button && (master.maxHealth > 0 || master.targetname !== "" && !door.activated)),
      destination: this.linear.destination(entity) };
  }

  get callbacks(): Q2CallbackDefinitions {
    return { think: { ...this.linear.callbacks.think, ...this.angular.callbacks.think, door_hit_bottom: this.bottom, door_go_down: this.down, door_hit_top: this.top,
      Think_SpawnDoorTrigger: this.prepareDoor, smart_water_go_up: this.smartWater, train_wait: this.trainWait, train_next: this.trainNext,
      train_piece_wait: this.trainPieceWait, func_train_find: this.trainFind },
      use: { door_use: this.doorUse, Door_Activate: this.doorActivate, train_use: this.trainUse, rotating_use: this.rotatingUse },
      touch: { button_touch: this.buttonTouch, door_touch: this.doorTouch, Touch_DoorTrigger: this.doorTriggerTouch, rotating_touch: this.rotatingTouch, q2_path_touch: this.pathTouch },
      die: { door_killed: this.doorKilled }, blocked: { door_blocked: this.doorBlocked, smart_water_blocked: this.smartWaterBlocked, train_blocked: this.trainBlocked, rotating_blocked: this.rotatingDamage } };
  }

  capture(game: Q2GameServices): Q2MoversCheckpoint {
    const doors: Q2MoversCheckpoint["doors"][number][] = [], trains: Q2MoversCheckpoint["trains"][number][] = [];
    const reference = (entity: Q2Entity): SavedActorId => ({ slot: entity.actor.id.slot, generation: entity.actor.id.generation });
    for (const entity of game.entities.values()) {
      const door = this.doors.get(entity), train = this.trains.get(entity);
      if (door !== undefined) {
        const { master, team, ...state } = door;
        doors.push({ actor: reference(entity), state: structuredClone(state), master: reference(master), team: team.map(reference) });
      }
      if (train !== undefined) trains.push({ actor: reference(entity), destination: train.destination === null ? null : reference(train.destination), debounce: train.debounce, ship: train.ship });
    }
    return { doors, trains, linear: this.linear.capture(game), angular: this.angular.capture(game) };
  }

  restore(game: Q2GameServices, checkpoint: Q2MoversCheckpoint): undefined {
    this.doors = new WeakMap<Q2Entity, DoorState>(); this.trains = new WeakMap<Q2Entity, TrainState>();
    const reference = (saved: SavedActorId): Q2Entity => {
      const entity = game.entity(restoreQ2Actor(game, saved).id);
      if (entity === null) throw new Error("Q2 mover checkpoint has no source actor");
      return entity;
    };
    for (const saved of checkpoint.doors) this.doors.set(reference(saved.actor), { ...structuredClone(saved.state), master: reference(saved.master), team: saved.team.map(reference) });
    for (const saved of checkpoint.trains) this.trains.set(reference(saved.actor), { destination: saved.destination === null ? null : reference(saved.destination), debounce: saved.debounce, ship: saved.ship });
    this.linear.restore(game, checkpoint.linear); this.angular.restore(game, checkpoint.angular);
    return undefined;
  }

  private readonly trainPieceWait: Q2Think = () => undefined;
  private readonly rotatingTouch: Q2Touch = (entity, game, contact) => this.rotatingDamage(entity, game, contact.other);

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "func_door": case "func_door_rotating": case "func_water": case "func_button": this.spawnDoor(entity, game); return true;
      case "func_train": case "misc_strogg_ship": case "misc_viper": this.spawnTrain(entity, game); return true;
      case "func_rotating": this.spawnRotating(entity, game); return true;
      case "path_corner": case "point_combat": this.spawnPath(entity, game); return true;
      default: return false;
    }
  }

  private door(entity: Q2Entity): DoorState {
    const state = this.doors.get(entity);
    if (state === undefined) throw new Error("Missing Q2 door state");
    return state;
  }

  private loop(entity: Q2Entity, game: Q2GameServices, path: string, start: boolean): undefined {
    if (path === "") return undefined;
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path,
      channel: 2, volume: 1, attenuation: 3, reliable: false, loop: start ? "start" : "stop" });
  }

  private doorSound(entity: Q2Entity, game: Q2GameServices, start: boolean): undefined {
    const state = this.door(entity), sounds = integerField(entity.spawn, "sounds");
    const enabled = state.water ? sounds === 1 || sounds === 2 : sounds !== 1;
    const defaults = state.water ? ["world/mov_watr.wav", "", "world/stp_watr.wav"] : state.button ? ["switches/butn2.wav", "", ""] : ["doors/dr1_strt.wav", "doors/dr1_mid.wav", "doors/dr1_end.wav"];
    const select = (key: string, index: number): string => {
      const value = game.options.edition === "rerelease" ? entity.spawn.values.get(key) : undefined;
      return value === undefined ? enabled ? defaults[index] ?? "" : "" : value === "0" || value === " " ? "" : value;
    };
    const sound = select(start ? "noise_start" : "noise_end", start ? 0 : 2), middle = select("noise_middle", 1);
    const attenuation = game.options.edition === "rerelease" && !state.water ? numberField(entity.spawn, "attenuation", 3) : 3;
    if (state.master === entity && sound !== "") {
      let origin = game.body(entity).origin;
      if (game.options.edition === "rerelease" && state.team.length > 1) {
        const center = scale(state.team.reduce((sum, member) => {
          const body = game.body(member); return add(sum, add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)));
        }, zero), 1 / state.team.length);
        if ((game.host.pointContents(center) & 1) === 0) origin = center;
      }
      game.host.emit({ kind: "sound", actor: entity.actor.id, origin, path: sound, channel: 2, volume: 1, attenuation: attenuation === -1 ? 0 : attenuation, reliable: false, loop: "once" });
    }
    if (middle !== "") game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: middle, channel: 2,
      volume: 1, attenuation: attenuation === -1 ? 0 : attenuation, reliable: false, loop: start ? "start" : "stop" });
    return undefined;
  }

  private portals(entity: Q2Entity, game: Q2GameServices, open: boolean): undefined {
    for (const portal of game.targets(entity.target)) {
      if (portal.classname === "func_areaportal") game.host.setAreaPortal(integerField(portal.spawn, "style"), open);
    }
    return undefined;
  }

  private readonly bottom: Q2Think = (entity, game) => {
    const state = this.door(entity); state.phase = "bottom";
    if (state.button) { entity.effects = entity.effects & ~0x800 | 0x400; game.show(entity); }
    else { this.doorSound(entity, game, false); if (game.options.edition === "classic" || (entity.spawnflags & 1) === 0) this.portals(entity, game, false); }
    return undefined;
  };

  private readonly down: Q2Think = (entity, game) => {
    const state = this.door(entity); state.phase = "down";
    if (entity.maxHealth > 0 && !state.water) {
      game.host.combat.setHealth(entity.actor, entity.maxHealth);
      game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    }
    if (state.button) { entity.frame = 0; game.show(entity); }
    else this.doorSound(entity, game, true);
    (state.angular ? this.angular : this.linear).moveTo(entity, game, state.start, this.bottom);
    if (game.options.edition === "rerelease" && !state.button && (entity.spawnflags & 1) !== 0) this.portals(entity, game, true);
    return undefined;
  };

  private readonly top: Q2Think = (entity, game) => {
    const state = this.door(entity); state.phase = "top";
    if (state.button) {
      entity.effects = entity.effects & ~0x400 | 0x800; entity.frame = 1;
      game.show(entity); game.useTargets(entity, entity.activator);
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    } else {
      this.doorSound(entity, game, false);
      if ((entity.spawnflags & 32) !== 0) return undefined;
    }
    if (entity.wait >= 0) game.schedule(entity, entity.wait, this.down);
    if (game.options.edition === "rerelease" && !state.button && (entity.spawnflags & 1) !== 0) this.portals(entity, game, false);
    return undefined;
  };

  private up(entity: Q2Entity, game: Q2GameServices, activator: ActorId | null): undefined {
    const state = this.door(entity);
    if (state.phase === "up") return undefined;
    if (state.phase === "top") {
      if (!state.button && entity.wait >= 0 && (entity.spawnflags & 32) === 0) game.schedule(entity, entity.wait, this.down);
      return undefined;
    }
    entity.activator = activator; state.phase = "up"; this.doorSound(entity, game, true);
    (state.angular ? this.angular : this.linear).moveTo(entity, game, state.reversed ? scale(state.end, -1) : state.end, this.top);
    if (!state.button) { game.useTargets(entity, activator); if (game.options.edition === "classic" || (entity.spawnflags & 1) === 0) this.portals(entity, game, true); }
    return undefined;
  }

  private use(entity: Q2Entity, game: Q2GameServices, activator: ActorId | null): undefined {
    const state = this.door(entity);
    if (state.master !== entity) return undefined;
    if (game.options.edition === "rerelease" && state.angular && (entity.spawnflags & 0x20000) !== 0 && (state.phase === "bottom" || state.phase === "down") && activator !== null) {
      const body = game.host.bodies.read(activator);
      if (body !== null) state.reversed = dot(normalize(subtract(body.origin, game.body(entity).origin)), state.safeDirection) > 0;
    }
    const close = !state.button && (entity.spawnflags & 32) !== 0 && (state.phase === "up" || state.phase === "top");
    if (!close && game.options.edition === "rerelease" && state.water && (entity.spawnflags & 2) !== 0 && (game.host.pointContents(scale(add(game.body(entity).bounds.min, game.body(entity).bounds.max), 0.5)) & 56) !== 0) {
      entity.message = ""; entity.touch = null; entity.enemy = activator;
      return this.smartWater(entity, game);
    }
    for (const member of state.team) {
      member.message = ""; member.touch = null;
      if (close) this.down(member, game); else this.up(member, game, activator);
    }
    return undefined;
  }

  private spawnDoor(entity: Q2Entity, game: Q2GameServices): undefined {
    const button = entity.classname === "func_button";
    const angular = entity.classname === "func_door_rotating", water = entity.classname === "func_water";
    const safeDirection = angular && (entity.spawnflags & 0x20000) !== 0 ? movedir(game.body(entity).angles) : zero;
    const waterDivisor = entity.accel || 20;
    entity.movedir = angular ? (entity.spawnflags & 64) !== 0 ? { x: 0, y: 0, z: 1 } : (entity.spawnflags & 128) !== 0 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 } : movedir(game.body(entity).angles);
    if (angular && (entity.spawnflags & 2) !== 0) entity.movedir = scale(entity.movedir, -1);
    game.move(entity, { angles: zero }, false);
    game.solid(entity, "brush"); game.motion(entity, button ? "stop" : "push");
    entity.speed ||= button ? 40 : water ? 25 : 100;
    if (!button && !angular && !water && game.options.mode === "deathmatch") entity.speed *= 2;
    entity.accel ||= entity.speed; entity.decel ||= entity.speed; entity.wait ||= water ? -1 : 3; entity.damage ||= 2;
    const body = game.body(entity), size = subtract(body.bounds.max, body.bounds.min);
    const direction = { x: Math.abs(entity.movedir.x), y: Math.abs(entity.movedir.y), z: Math.abs(entity.movedir.z) };
    const distance = angular ? numberField(entity.spawn, "distance") || 90 : dot(direction, size) - (numberField(entity.spawn, "lip") || (button ? 4 : water ? 0 : 8));
    let start = angular ? zero : body.origin, end = add(start, scale(entity.movedir, distance));
    if (!button && (entity.spawnflags & 1) !== 0) {
      if (game.options.edition === "rerelease" && angular && (entity.spawnflags & 0x20000) !== 0) {
        entity.spawnflags &= ~0x20000; game.host.diagnostic("Q2 rotating door SAFE_OPEN is incompatible with START_OPEN");
      }
      const previous = start; start = end; end = previous;
      game.move(entity, angular ? { angles: start } : { origin: start });
      if (angular) entity.movedir = scale(entity.movedir, -1);
    }
    this.doors.set(entity, { start, end, distance, button, angular, water, safeDirection, waterDivisor, reversed: false, activated: false, phase: "bottom", master: entity, team: [entity], debounce: 0 });
    if (!entity.spawn.values.get("team")) entity.teamMaster = entity.actor.id;
    if (water) {
      entity.accel = entity.decel = entity.speed;
      if (entity.wait === -1) entity.spawnflags |= 32;
      if (game.options.edition === "classic") entity.classname = "func_door";
    }
    if (button) entity.effects |= 0x400;
    else if (!water) { if ((entity.spawnflags & 16) !== 0) entity.effects |= 0x1000; if (!angular && (entity.spawnflags & 64) !== 0) entity.effects |= 0x2000; }
    entity.use = this.doorUse;
    if (entity.maxHealth > 0 && !water) {
      game.host.combat.create(entity.actor, { health: entity.maxHealth, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
      entity.die = this.doorKilled;
    } else if (button && entity.targetname === "") {
      entity.touch = this.buttonTouch;
    } else if (!button && entity.targetname !== "" && entity.message !== "") {
      entity.touch = this.doorTouch;
    }
    entity.blocked = this.doorBlocked;
    game.show(entity);
    if (!button && !water) game.schedule(entity, game.host.frameSeconds(), this.prepareDoor);
    if (water) {
      entity.blocked = null;
      if (game.options.edition === "rerelease" && (entity.spawnflags & 2) !== 0) {
        entity.blocked = this.smartWaterBlocked;
      }
    }
    if (game.options.edition === "rerelease" && angular && (entity.spawnflags & 0x10000) !== 0) {
      if (entity.maxHealth > 0) game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
      entity.die = null; game.cancel(entity);
      entity.use = this.doorActivate;
    }
    return undefined;
  }

  private readonly prepareDoor: Q2Think = (entity, game) => {
    const team = game.pushTeam(entity.actor.id).flatMap(actor => {
      const member = game.entity(actor.id); return member !== null && this.doors.has(member) ? [member] : [];
    });
    const master = team[0] ?? entity;
    for (const member of team) { const state = this.door(member); state.master = master; state.team = team; }
    if (master !== entity) return undefined;
    if (game.options.edition === "rerelease" && !this.door(entity).angular && (entity.spawnflags & 1) !== 0) this.portals(entity, game, true);
    const shortest = Math.min(...team.map(member => Math.abs(this.door(member).distance)));
    const time = shortest / entity.speed;
    if (time > 0) for (const member of team) {
      const speed = Math.abs(this.door(member).distance) / time, ratio = speed / member.speed;
      member.accel *= ratio; member.decel *= ratio; member.speed = speed;
    }
    if (entity.maxHealth > 0 || entity.targetname !== "" && !this.door(entity).activated) return undefined;
    let min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }, max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const member of team) {
      const body = game.body(member), low = add(body.origin, body.bounds.min), high = add(body.origin, body.bounds.max);
      min = { x: Math.min(min.x, low.x), y: Math.min(min.y, low.y), z: Math.min(min.z, low.z) };
      max = { x: Math.max(max.x, high.x), y: Math.max(max.y, high.y), z: Math.max(max.z, high.z) };
    }
    const trigger = game.create("door_trigger"); trigger.owner = entity.actor.id; trigger.visible = false;
    game.move(trigger, { bounds: { min: { x: min.x - 60, y: min.y - 60, z: min.z }, max: { x: max.x + 60, y: max.y + 60, z: max.z } } }, false);
    trigger.touch = this.doorTriggerTouch;
    game.solid(trigger, "trigger");
    if ((entity.spawnflags & 1) !== 0) this.portals(entity, game, true);
    return undefined;
  };

  private readonly smartWater: Q2Think = (entity, game) => {
    const state = this.door(entity), body = game.body(entity), top = body.origin.z + body.bounds.max.z + 1;
    if (state.phase === "top") {
      if (entity.wait >= 0) game.schedule(entity, entity.wait, this.smartWater);
      return undefined;
    }
    if (entity.maxHealth !== 0 && top >= entity.maxHealth) {
      game.move(entity, { velocity: zero }, false); game.motion(entity, entity.motion); game.cancel(entity);
      state.phase = "top"; return undefined;
    }
    this.doorSound(entity, game, true);
    let lowest: ActorId | null = null, height = 999999;
    for (const actor of game.host.players()) {
      if ((game.host.combat.read(actor)?.health ?? 0) <= 0) continue;
      const player = game.host.bodies.read(actor);
      if (player !== null && player.origin.z + player.bounds.min.z - 1 < height) {
        lowest = actor; height = player.origin.z + player.bounds.min.z - 1;
      }
    }
    if (lowest === null) return undefined;
    const distance = height - top, speed = Math.min(entity.speed, Math.max(5, distance < state.waterDivisor ? 5 : distance / state.waterDivisor));
    game.move(entity, { velocity: { x: 0, y: 0, z: speed } }, false); game.motion(entity, entity.motion);
    if (state.phase !== "up") {
      game.useTargets(entity, lowest); this.portals(entity, game, true); state.phase = "up";
    }
    return game.schedule(entity, game.host.frameSeconds(), this.smartWater);
  };

  private train(entity: Q2Entity): TrainState {
    const state = this.trains.get(entity);
    if (state === undefined) throw new Error("Missing Q2 train state");
    return state;
  }

  resumeTrainAt(entity: Q2Entity, game: Q2GameServices, corner: Q2Entity): undefined {
    const state = this.train(entity); state.destination = corner;
    entity.spawnflags |= 1;
    return this.linear.moveTo(entity, game, this.trainDestination(entity, corner, game), this.trainWait);
  }

  getTrainDirection(entity: Q2Entity, game: Q2GameServices): Vec3 {
    const corner = this.train(entity).destination;
    if (corner === null) return zero;
    const delta = subtract(this.trainDestination(entity, corner, game), game.body(entity).origin), distance = length(delta);
    return distance === 0 ? zero : scale(delta, 1 / distance);
  }

  private trainDestination(entity: Q2Entity, target: Q2Entity, game: Q2GameServices): Vec3 {
    const origin = game.body(target).origin;
    if (game.options.edition === "rerelease" && (entity.spawnflags & 32) !== 0) return origin;
    const destination = subtract(origin, game.body(entity).bounds.min);
    return game.options.edition === "rerelease" && (entity.spawnflags & 16) !== 0 ? subtract(destination, { x: 1, y: 1, z: 1 }) : destination;
  }

  private readonly trainWait: Q2Think = (entity, game) => {
    const target = this.train(entity).destination;
    if (target === null) return undefined;
    const pathTarget = target.spawn.values.get("pathtarget") ?? "";
    if (pathTarget !== "") {
      const previous = target.target; target.target = pathTarget;
      try { game.useTargets(target, entity.activator); } finally { target.target = previous; }
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    }
    if (target.wait === 0) return this.trainNext(entity, game);
    if (target.wait > 0) game.schedule(entity, target.wait, this.trainNext);
    else if ((entity.spawnflags & 2) !== 0) {
      if (game.options.edition === "rerelease") this.train(entity).destination = null;
      else this.trainNext(entity, game);
      entity.spawnflags &= ~1;
      game.move(entity, { velocity: zero }, false); game.motion(entity, entity.motion); game.cancel(entity);
    }
    return this.loop(entity, game, entity.spawn.values.get("noise") ?? "", false);
  };

  private readonly trainNext: Q2Think = (entity, game) => {
    let teleported = false;
    for (;;) {
      if (entity.target === "") return this.loop(entity, game, entity.spawn.values.get("noise") ?? "", false);
      const target = game.pickTarget(entity.target);
      if (target === null) { game.host.diagnostic(`Q2 train target missing: ${entity.target}`); return undefined; }
      entity.target = target.target;
      if ((target.spawnflags & 1) !== 0) {
        if (teleported) { game.host.diagnostic("Q2 train has consecutive teleport corners"); return undefined; }
        teleported = true; game.move(entity, { origin: this.trainDestination(entity, target, game) });
        game.host.emit({ kind: "effect", effect: "q2:other-teleport", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
        continue;
      }
      this.train(entity).destination = target;
      if (game.options.edition === "rerelease" && target.speed !== 0) {
        entity.speed = target.speed; entity.accel = target.accel || target.speed; entity.decel = target.decel || target.speed;
      }
      this.loop(entity, game, entity.spawn.values.get("noise") ?? "", true);
      entity.spawnflags |= 1;
      const destination = this.trainDestination(entity, target, game), delta = subtract(destination, game.body(entity).origin);
      this.linear.moveTo(entity, game, destination, this.trainWait);
      if (game.options.edition === "rerelease" && (entity.spawnflags & 8) !== 0) {
        for (const actor of game.pushTeam(entity.actor.id)) {
          const member = game.entity(actor.id); if (member === null || member === entity) continue;
          member.speed = entity.speed; member.accel = entity.accel; member.decel = entity.decel; game.motion(member, "push");
          this.linear.moveTo(member, game, add(game.body(member).origin, delta), this.trainPieceWait);
        }
      }
      return undefined;
    }
  };

  spawnTrain(entity: Q2Entity, game: Q2GameServices): undefined {
    const ship = entity.classname !== "func_train";
    this.trains.set(entity, { destination: null, debounce: 0, ship });
    if (ship) {
      entity.model = entity.classname === "misc_strogg_ship" ? "models/ships/strogg1/tris.md2" : "models/ships/viper/tris.md2";
      entity.visible = false;
      game.move(entity, { bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 32 } } }, false);
    }
    game.solid(entity, ship ? "none" : "brush"); game.motion(entity, "push"); game.move(entity, { angles: zero });
    entity.speed ||= ship ? 300 : 100; entity.accel = entity.decel = entity.speed;
    entity.damage = (entity.spawnflags & 4) !== 0 ? 0 : entity.damage || 100;
    entity.use = this.trainUse;
    entity.blocked = this.trainBlocked;
    game.show(entity);
    game.schedule(entity, game.host.frameSeconds(), this.trainFind);
    return undefined;
  }

  private spawnRotating(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.movedir = (entity.spawnflags & 4) !== 0 ? { x: 0, y: 0, z: 1 } : (entity.spawnflags & 8) !== 0 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    if ((entity.spawnflags & 2) !== 0) entity.movedir = scale(entity.movedir, -1);
    entity.speed ||= 100; entity.damage ||= 2;
    game.solid(entity, "brush"); game.motion(entity, (entity.spawnflags & 32) !== 0 ? "stop" : "push");
    
    entity.blocked = this.rotatingDamage;
    entity.use = this.rotatingUse;
    if ((entity.spawnflags & 1) !== 0) entity.use(entity, game, null, null);
    if ((entity.spawnflags & 64) !== 0) entity.effects |= 0x1000;
    if ((entity.spawnflags & 128) !== 0) entity.effects |= 0x2000;
    game.show(entity);
    return undefined;
  }

  private spawnPath(entity: Q2Entity, game: Q2GameServices): undefined {
    if (entity.targetname === "" && entity.classname === "path_corner") { game.remove(entity); return undefined; }
    game.move(entity, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }, false);
    entity.visible = false;
    entity.touch = this.pathTouch;
    game.solid(entity, "trigger");
    return undefined;
  }

  private readonly doorUse: Q2Use = (self, services, _other, activator) => this.use(self, services, activator);

  private readonly doorKilled: Q2Die = (self, services, reaction) => {
        const state = this.door(self);
        for (const member of state.team) {
          if (member.maxHealth <= 0) continue;
          services.host.combat.setHealth(member.actor, member.maxHealth);
          services.host.combat.setTraits(member.actor, { canTakeDamage: false });
        }
        return this.use(state.master, services, reaction.attacker);
      };

  private readonly buttonTouch: Q2Touch = (self, services, contact) => {
        if (services.host.isPlayer(contact.other) && (services.host.combat.read(contact.other)?.health ?? 0) > 0) this.use(self, services, contact.other);
        return undefined;
      };

  private readonly doorTouch: Q2Touch = (self, services, contact) => {
        const state = this.door(self);
        if (!services.host.isPlayer(contact.other) || services.host.now() < state.debounce) return undefined;
        state.debounce = services.host.now() + 5;
        services.host.emit({ kind: "centerprint", actor: contact.other, text: self.message });
        return services.sound(self, "misc/talk1.wav", 0);
      };

  private readonly doorBlocked: NonNullable<Q2Entity["blocked"]> = (self, services, other) => {
      const body = services.host.bodies.read(other);
      if (body === null) return undefined;
      if (!services.host.isPlayer(other) && !services.host.isMonster(other)) {
        if (services.host.combat.read(other) !== null) services.damage(other, self, self.actor.id, 100000, 1, zero, body.origin, zero, 20);
        const victim = services.entity(other); if (victim !== null) services.remove(victim);
        return undefined;
      }
      services.damage(other, self, self.actor.id, self.damage, 1, zero, body.origin, zero, 20);
      if ((self.spawnflags & 4) !== 0 || self.wait < 0) return undefined;
      const state = this.door(self), reverse = state.phase === "down";
      for (const member of state.team) if (reverse) this.up(member, services, member.activator); else this.down(member, services);
      return undefined;
    };

  private readonly smartWaterBlocked: NonNullable<Q2Entity["blocked"]> = (self, services, other) => {
          const body = services.host.bodies.read(other); if (body === null) return undefined;
          const living = services.host.isPlayer(other) || services.host.isMonster(other);
          if (services.host.combat.read(other) !== null) services.damage(other, self, self.actor.id, living ? 100 : 100000, 1, zero, body.origin, zero, 19);
          const victim = services.entity(other);
          if (!living && victim !== null && services.host.actors.isLive(other) && victim.solid !== "none") services.remove(victim);
          return undefined;
        };

  private readonly doorActivate: Q2Use = (self, services) => {
        self.use = null; self.die = self.maxHealth > 0 ? this.doorKilled : null; this.door(self).activated = true;
        if (self.maxHealth > 0) services.host.combat.setTraits(self.actor, { canTakeDamage: true });
        return services.schedule(self, services.host.frameSeconds(), this.prepareDoor);
      };

  private readonly doorTriggerTouch: Q2Touch = (self, services, contact) => {
      const entity=services.entity(self.owner); if(entity===null)return undefined;
      if ((services.host.combat.read(contact.other)?.health ?? 0) <= 0 || services.host.now() < self.timestamp) return undefined;
      const monster = services.host.isMonster(contact.other);
      if (!monster && !services.host.isPlayer(contact.other) || monster && (entity.spawnflags & 8) !== 0) return undefined;
      self.timestamp = services.host.now() + 1;
      return this.use(entity, services, contact.other);
    };

  private readonly trainUse: Q2Use = (self, services, _other, activator) => {
      self.activator = activator;
      if (this.train(self).ship && !self.visible) { self.visible = true; services.show(self); }
      if ((self.spawnflags & 1) !== 0) {
        if ((self.spawnflags & 2) === 0) return undefined;
        self.spawnflags &= ~1; services.move(self, { velocity: zero }, false); services.motion(self, self.motion); return services.cancel(self);
      }
      const destination = this.train(self).destination;
      if (destination === null) return this.trainNext(self, services);
      self.spawnflags |= 1;
      return this.linear.moveTo(self, services, this.trainDestination(self, destination, services), this.trainWait);
    };

  private readonly trainBlocked: NonNullable<Q2Entity["blocked"]> = (self, services, other) => {
      const state = this.train(self), body = services.host.bodies.read(other);
      if (body === null || self.damage === 0 || services.host.now() < state.debounce) return undefined;
      state.debounce = services.host.now() + 0.5;
      if (services.host.combat.read(other) !== null) services.damage(other, self, self.actor.id, self.damage, 1, zero, body.origin, zero, 20);
      return undefined;
    };

  private readonly trainFind: Q2Think = (self, services) => {
      const target = services.pickTarget(self.target);
      if (target === null) { services.host.diagnostic(`Q2 train first target missing: ${self.target}`); return undefined; }
      self.target = target.target;
      services.move(self, { origin: this.trainDestination(self, target, services) });
      if (self.targetname === "") self.spawnflags |= 1;
      if ((self.spawnflags & 1) !== 0) { self.activator = self.actor.id; services.schedule(self, services.host.frameSeconds(), this.trainNext); }
      return undefined;
    };

  private readonly rotatingDamage: NonNullable<Q2Entity["blocked"]> = (self: Q2Entity, services: Q2GameServices, other: ActorId): undefined => {
      const body = services.host.bodies.read(other);
      if (body !== null && services.host.combat.read(other) !== null) services.damage(other, self, self.actor.id, self.damage, 1, zero, body.origin, zero, 20);
      return undefined;
    };

  private readonly rotatingUse: Q2Use = (self, services) => {
      const stop = length(self.angularVelocity) !== 0;
      self.angularVelocity = stop ? zero : scale(self.movedir, self.speed);
      self.touch = !stop && (self.spawnflags & 16) !== 0 ? this.rotatingTouch : null;
      return services.motion(self, self.motion);
    };

  private readonly pathTouch: Q2Touch = (self, services, contact) => {
      return self.classname === "path_corner" ? this.hooks.pathCorner(self, services, contact.other) : this.hooks.combatPoint(self, services, contact.other);
    };

}

export function createQ2MoverModule(hooks: Q2MoverHooks): Q2MoverModule { return new Q2MoverModule(hooks); }
