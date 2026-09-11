/* doors.qc/buttons.qc/plats.qc, Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Actor } from "./entity.ts";
import { moveDirection } from "./entity.ts";
import type { Q1Foundation } from "./runtime.ts";
import { ZERO, vadd, vsub, vscale, dot, overlaps, vectors } from "./types.ts";

function doorSound(entity: Q1Actor, moving: boolean): string {
  if (entity.sounds === 1) return moving ? "doors/doormv1.wav" : "doors/drclos4.wav";
  if (entity.sounds === 2) return moving ? "doors/hydro1.wav" : "doors/hydro2.wav";
  if (entity.sounds === 3) return moving ? "doors/stndr1.wav" : "doors/stndr2.wav";
  if (entity.sounds === 4) return moving ? "doors/ddoor1.wav" : "doors/ddoor2.wav";
  return "misc/null.wav";
}
export function doorDown(game: Q1Foundation, entity: Q1Actor): undefined {
  game.sound(entity, doorSound(entity, true)); entity.state = "down";
  if (entity.maxHealth > 0) { game.host.combat.setHealth(entity.actor, entity.maxHealth); entity.damageable = true; }
  return game.calcMove(entity, entity.pos1, entity.speed, game.named.action(entity, "door_hit_bottom"));
}
export function doorUp(game: Q1Foundation, entity: Q1Actor): undefined {
  if (entity.state === "up") return undefined;
  if (entity.state === "top") {
    if (entity.wait >= 0 && (entity.spawnflags & 32) === 0) game.schedule(entity, entity.wait, game.named.action(entity, "door_go_down")); return undefined;
  }
  game.sound(entity, doorSound(entity, true)); entity.state = "up";
  game.calcMove(entity, entity.pos2, entity.speed, game.named.action(entity, "door_hit_top"));
  return game.useTargets(entity, entity.activator);
}
function doorUse(game: Q1Foundation, entity: Q1Actor, activator: ActorId | null): undefined {
  const master = entity.doorGroup[0] ?? entity;
  const down = (master.spawnflags & 32) !== 0 && (master.state === "up" || master.state === "top");
  for (const door of master.doorGroup.length === 0 ? [master] : master.doorGroup) {
    door.message = ""; door.activator = activator; if (down) doorDown(game, door); else doorUp(game, door);
  }
  return undefined;
}
export function spawnDoor(game: Q1Foundation, entity: Q1Actor): undefined {
  const body = game.body(entity); entity.movedir = moveDirection(body.angles); game.setBody(entity, { angles: ZERO });
  entity.solid = "bsp"; entity.movement = "push"; entity.speed ||= 100; entity.wait ||= 3; entity.damage ||= 2;
  if ((entity.spawnflags & 24) !== 0) entity.wait = -1;
  entity.pos1 = body.origin;
  const size = vsub(body.bounds.max, body.bounds.min);
  const absoluteDirection = { x: Math.abs(entity.movedir.x), y: Math.abs(entity.movedir.y), z: Math.abs(entity.movedir.z) };
  const distance = game.options.edition === "rerelease" ? dot(absoluteDirection, size) : Math.abs(dot(entity.movedir, size));
  entity.pos2 = vadd(entity.pos1, vscale(entity.movedir, distance - (entity.number("lip") || 8)));
  if ((entity.spawnflags & 1) !== 0) { const closed = entity.pos1; entity.pos1 = entity.pos2; entity.pos2 = closed; game.setOrigin(entity, entity.pos1); }
  entity.use = game.named.use(entity, "door_use");
  entity.blocked = game.named.blocked(entity, "door_blocked");
  if (entity.maxHealth > 0) { entity.damageable = true; entity.die = game.named.die(entity, "door_killed"); }
  entity.touch = game.named.touch(entity, "door_touch");
  return undefined;
}
export function linkDoors(game: Q1Foundation): undefined {
  const doors = [...game.entities.values()].filter(entity => entity.classname === "func_door");
  for (const master of doors) {
    if (master.doorGroup.length > 0) continue;
    const group: Q1Actor[] = [master]; let min = game.body(master).bounds.min, max = game.body(master).bounds.max;
    if ((master.spawnflags & 4) === 0) {
      let current = master;
      for (const candidate of doors.slice(doors.indexOf(master) + 1)) {
        if (!overlaps(game.body(current).bounds, game.body(candidate).bounds)) continue;
        if (candidate.doorGroup.length !== 0) throw new Error("cross connected doors");
        group.push(candidate); current = candidate; const bounds = game.body(candidate).bounds;
        min = { x: Math.min(min.x, bounds.min.x), y: Math.min(min.y, bounds.min.y), z: Math.min(min.z, bounds.min.z) };
        max = { x: Math.max(max.x, bounds.max.x), y: Math.max(max.y, bounds.max.y), z: Math.max(max.z, bounds.max.z) };
        if (candidate.targetname !== "") master.targetname = candidate.targetname;
        if (candidate.message !== "") master.message = candidate.message;
        if (candidate.maxHealth !== 0) { master.maxHealth = candidate.maxHealth; game.host.combat.setHealth(master.actor, candidate.maxHealth); }
      }
    }
    for (const door of group) door.doorGroup = group;
    if ((master.spawnflags & (4 | 8 | 16)) !== 0 || master.maxHealth > 0 || master.targetname !== "") continue;
    const trigger = game.create("door_trigger"); trigger.solid = "trigger";
    trigger.triggerBounds = { min: vsub(min, { x: 60, y: 60, z: 8 }), max: vadd(max, { x: 60, y: 60, z: 8 }) };
    game.setBounds(trigger, trigger.triggerBounds);
    trigger.owner = master.actor.id; trigger.touch = game.named.touch(trigger, "door_trigger_touch");
  }
  return undefined;
}
export function spawnButton(game: Q1Foundation, entity: Q1Actor): undefined {
  const body = game.body(entity); entity.solid = "bsp"; entity.movement = "push"; entity.speed ||= 40; entity.wait ||= 1;
  entity.movedir = moveDirection(body.angles); game.setBody(entity, { angles: ZERO });
  entity.pos1 = body.origin;
  entity.pos2 = vadd(body.origin, vscale(entity.movedir, Math.abs(dot(entity.movedir, vsub(body.bounds.max, body.bounds.min))) - (entity.number("lip") || 4)));
  entity.use = game.named.use(entity, "button_use");
  if (entity.maxHealth > 0) { entity.damageable = true; entity.die = game.named.die(entity, "button_killed"); }
  else entity.touch = game.named.touch(entity, "button_touch");
  return undefined;
}
export function spawnSecretDoor(game: Q1Foundation, entity: Q1Actor): undefined {
  const body = game.body(entity); entity.mangle = body.angles; game.setBody(entity, { angles: ZERO });
  entity.solid = "bsp"; entity.movement = "push"; entity.speed = 50; entity.wait ||= 5; entity.damage ||= 2;
  entity.pos1 = body.origin; entity.sounds ||= 3;
  entity.damageable = secretShootable(entity); game.host.combat.setHealth(entity.actor, 10000);
  entity.use = game.named.use(entity, "fd_secret_use"); entity.pain = game.named.pain(entity, "fd_secret_use"); entity.die = game.named.die(entity, "fd_secret_use");
  entity.blocked = game.named.blocked(entity, "fd_secret_blocked"); entity.touch = game.named.touch(entity, "fd_secret_touch");
  return undefined;
}
export function spawnPlat(game: Q1Foundation, entity: Q1Actor): undefined {
  const body = game.body(entity), size = vsub(body.bounds.max, body.bounds.min);
  entity.solid = "bsp"; entity.movement = "push"; entity.speed ||= 150; entity.pos1 = body.origin;
  entity.pos2 = vadd(body.origin, { x: 0, y: 0, z: -(entity.number("height") || size.z - 8) });
  game.setBody(entity, { angles: ZERO });
  entity.blocked = game.named.blocked(entity, "plat_crush"); entity.use = game.named.use(entity, "plat_use");
  entity.activated = entity.targetname === "";
  if (entity.activated) { entity.state = "bottom"; game.setOrigin(entity, entity.pos2); } else entity.state = "up";
  const trigger = game.create("plat_trigger"); trigger.solid = "trigger";
  let min = vadd(body.bounds.min, { x: 25, y: 25, z: 0 }), max = vsub(body.bounds.max, { x: 25, y: 25, z: -8 });
  min = { ...min, z: max.z - (entity.pos1.z - entity.pos2.z + 8) };
  if ((entity.spawnflags & 1) !== 0) max = { ...max, z: min.z + 8 };
  if (size.x <= 50) { min = { ...min, x: (body.bounds.min.x + body.bounds.max.x) / 2 }; max = { ...max, x: min.x + 1 }; }
  if (size.y <= 50) { min = { ...min, y: (body.bounds.min.y + body.bounds.max.y) / 2 }; max = { ...max, y: min.y + 1 }; }
  trigger.triggerBounds = { min, max }; game.setBounds(trigger, trigger.triggerBounds);
  trigger.owner = entity.actor.id; trigger.touch = game.named.touch(trigger, "plat_center_touch");
  return undefined;
}

function doorTouch(game: Q1Foundation, entity: Q1Actor, other: ActorId): undefined {
    if (!game.isPlayer(other)) return undefined;
    const master = entity.doorGroup[0] ?? entity; if (master.attackFinished > game.time) return undefined;
    master.attackFinished = game.time + 2; game.message(other, master.message);
    const key = (entity.spawnflags & 8) !== 0 ? "q1:key/gold" : (entity.spawnflags & 16) !== 0 ? "q1:key/silver" : null;
    if (key === null) return undefined;
    const player = game.player(other); if (player === null) return undefined;
    if (!game.host.inventory.consume(player.actor, key, 1)) {
      game.message(other, `$qc_need_${key === "q1:key/gold" ? "gold" : "silver"}_${game.worldType === 2 ? "keycard" : game.worldType === 1 ? "runekey" : "key"}`);
      return game.sound(entity, game.worldType === 2 ? "doors/basetry.wav" : game.worldType === 1 ? "doors/runetry.wav" : "doors/medtry.wav");
    }
    for (const door of master.doorGroup) door.touch = null;
    game.sound(entity, game.worldType === 2 ? "doors/baseuse.wav" : game.worldType === 1 ? "doors/runeuse.wav" : "doors/meduse.wav", "item");
    return doorUse(game, master, other);
}
function buttonFire(game: Q1Foundation, entity: Q1Actor, activator: ActorId | null): undefined {
  if (entity.state === "up" || entity.state === "top") return undefined;
  entity.activator = activator; entity.state = "up";
  game.sound(entity, ["buttons/airbut1.wav", "buttons/switch21.wav", "buttons/switch02.wav", "buttons/switch04.wav"][entity.sounds] ?? "buttons/airbut1.wav");
  return game.calcMove(entity, entity.pos2, entity.speed, game.named.action(entity, "button_wait"));
}
function secretShootable(entity: Q1Actor): boolean { return entity.targetname === "" || (entity.spawnflags & 16) !== 0; }
function secretSound(entity: Q1Actor, moving: boolean): string {
  return entity.sounds === 1 ? moving ? "doors/winch2.wav" : "doors/drclos4.wav" : entity.sounds === 2 ? moving ? "doors/airdoor1.wav" : "doors/airdoor2.wav" : moving ? "doors/basesec1.wav" : "doors/basesec2.wav";
}
function secretFire(game: Q1Foundation, entity: Q1Actor, activator: ActorId | null): undefined {
  game.host.combat.setHealth(entity.actor, 10000);
  if (entity.state !== "bottom" || entity.move !== null) return undefined;
  entity.message = ""; game.useTargets(entity, activator); entity.damageable = false; entity.state = "up";
  const basis = vectors(entity.mangle), bounds = game.body(entity).bounds, size = vsub(bounds.max, bounds.min);
  const width = entity.number("t_width") || Math.abs(dot((entity.spawnflags & 4) !== 0 ? basis.up : basis.right, size));
  const distance = entity.number("t_length") || Math.abs(dot(basis.forward, size));
  const direction = (entity.spawnflags & 4) !== 0 ? vscale(basis.up, -width) : vscale(basis.right, width * (1 - (entity.spawnflags & 2)));
  entity.dest1 = vadd(entity.pos1, direction); entity.dest2 = vadd(entity.dest1, vscale(basis.forward, distance));
  game.sound(entity, entity.sounds === 1 ? "doors/latch2.wav" : secretSound(entity, false)); game.sound(entity, secretSound(entity, true));
  return game.calcMove(entity, entity.dest1, entity.speed, game.named.action(entity, "fd_secret_move1"));
}
function platSound(entity: Q1Actor, moving: boolean): string {
  return entity.sounds === 1 ? moving ? "plats/plat1.wav" : "plats/plat2.wav" : moving ? "plats/medplat1.wav" : "plats/medplat2.wav";
}
function platDown(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.state = "down"; game.sound(entity, platSound(entity, true));
  return game.calcMove(entity, entity.pos2, entity.speed, game.named.action(entity, "plat_hit_bottom"));
}
function platUp(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.state = "up"; game.sound(entity, platSound(entity, true));
  return game.calcMove(entity, entity.pos1, entity.speed, game.named.action(entity, "plat_hit_top"));
}
export function registerMoverCallbacks(game: Q1Foundation): undefined {
  game.named.register("door_go_down", { action: doorDown });
  game.named.register("door_hit_bottom", { action: (runtime, entity) => { entity.state = "bottom"; return runtime.sound(entity, doorSound(entity, false)); } });
  game.named.register("door_hit_top", { action: (runtime, entity) => {
    entity.state = "top"; runtime.sound(entity, doorSound(entity, false));
    if (entity.wait >= 0 && (entity.spawnflags & 32) === 0) runtime.schedule(entity, entity.wait, runtime.named.action(entity, "door_go_down")); return undefined;
  } });
  game.named.register("door_use", { use: (runtime, entity, _other, activator) => doorUse(runtime, entity, activator) });
  game.named.register("door_blocked", { blocked: (runtime, entity, other) => {
    runtime.damage(other, entity.actor.id, entity.actor.id, entity.damage, null, "direct", "crush");
    if (entity.wait >= 0) { if (entity.state === "down") doorUp(runtime, entity); else doorDown(runtime, entity); } return undefined;
  } });
  game.named.register("door_killed", { die: (runtime, entity, attacker) => { const master = entity.doorGroup[0] ?? entity; runtime.host.combat.setHealth(master.actor, master.maxHealth); master.damageable = false; return doorUse(runtime, master, attacker); } });
  game.named.register("door_touch", { touch: doorTouch });
  game.named.register("door_trigger_touch", { touch: (runtime, entity, other) => {
    if (runtime.health(other) <= 0 || entity.attackFinished > runtime.time) return undefined;
    const master = runtime.entity(entity.owner); if (master === null) return undefined;
    entity.attackFinished = runtime.time + 1; return doorUse(runtime, master, other);
  } });
  game.named.register("button_use", { use: (runtime, entity, _other, activator) => buttonFire(runtime, entity, activator) });
  game.named.register("button_touch", { touch: (runtime, entity, other) => runtime.isPlayer(other) ? buttonFire(runtime, entity, other) : undefined });
  game.named.register("button_killed", { die: (runtime, entity, attacker) => { runtime.host.combat.setHealth(entity.actor, entity.maxHealth); entity.damageable = false; return buttonFire(runtime, entity, attacker); } });
  game.named.register("button_wait", { action: (runtime, entity) => {
    entity.state = "top"; if (entity.wait >= 0) runtime.schedule(entity, entity.wait, runtime.named.action(entity, "button_return"));
    runtime.useTargets(entity, entity.activator); entity.frame = 1; return undefined;
  } });
  game.named.register("button_return", { action: (runtime, entity) => {
    entity.state = "down"; entity.frame = 0; if (entity.maxHealth > 0) entity.damageable = true;
    return runtime.calcMove(entity, entity.pos1, entity.speed, runtime.named.action(entity, "button_done"));
  } });
  game.named.register("button_done", { action: (_runtime, entity) => { entity.state = "bottom"; return undefined; } });
  game.named.register("fd_secret_use", { use: (runtime, entity, _other, activator) => secretFire(runtime, entity, activator), pain: secretFire, die: secretFire });
  game.named.register("fd_secret_move1", { action: (runtime, entity) => { runtime.sound(entity, secretSound(entity, false)); return runtime.schedule(entity, 1, runtime.named.action(entity, "fd_secret_move2")); } });
  game.named.register("fd_secret_move2", { action: (runtime, entity) => { runtime.sound(entity, secretSound(entity, true)); return runtime.calcMove(entity, entity.dest2, entity.speed, runtime.named.action(entity, "fd_secret_move3")); } });
  game.named.register("fd_secret_move3", { action: (runtime, entity) => {
    entity.state = "top"; runtime.sound(entity, secretSound(entity, false));
    if ((entity.spawnflags & 1) === 0) runtime.schedule(entity, entity.wait, runtime.named.action(entity, "fd_secret_move4")); return undefined;
  } });
  game.named.register("fd_secret_move4", { action: (runtime, entity) => { runtime.sound(entity, secretSound(entity, true)); entity.state = "down"; return runtime.calcMove(entity, entity.dest1, entity.speed, runtime.named.action(entity, "fd_secret_move5")); } });
  game.named.register("fd_secret_move5", { action: (runtime, entity) => { runtime.sound(entity, secretSound(entity, false)); return runtime.schedule(entity, 1, runtime.named.action(entity, "fd_secret_move6")); } });
  game.named.register("fd_secret_move6", { action: (runtime, entity) => { runtime.sound(entity, secretSound(entity, true)); return runtime.calcMove(entity, entity.pos1, entity.speed, runtime.named.action(entity, "fd_secret_done")); } });
  game.named.register("fd_secret_done", { action: (runtime, entity) => { entity.state = "bottom"; entity.damageable = secretShootable(entity); runtime.host.combat.setHealth(entity.actor, 10000); return runtime.sound(entity, secretSound(entity, false)); } });
  game.named.register("fd_secret_blocked", { blocked: (runtime, entity, other) => { if (entity.attackFinished > runtime.time) return undefined; entity.attackFinished = runtime.time + 0.5; runtime.damage(other, entity.actor.id, entity.actor.id, entity.damage, null, "direct", "crush"); return undefined; } });
  game.named.register("fd_secret_touch", { touch: (runtime, entity, other) => { if (!runtime.isPlayer(other) || entity.attackFinished > runtime.time) return undefined; entity.attackFinished = runtime.time + 2; return runtime.message(other, entity.message); } });
  game.named.register("plat_go_down", { action: platDown });
  game.named.register("plat_hit_bottom", { action: (runtime, entity) => { entity.state = "bottom"; return runtime.sound(entity, platSound(entity, false)); } });
  game.named.register("plat_hit_top", { action: (runtime, entity) => { entity.state = "top"; runtime.sound(entity, platSound(entity, false)); return runtime.schedule(entity, 3, runtime.named.action(entity, "plat_go_down")); } });
  game.named.register("plat_crush", { blocked: (runtime, entity, other) => { runtime.damage(other, entity.actor.id, entity.actor.id, 1, null, "direct", "crush"); return entity.state === "up" ? platDown(runtime, entity) : platUp(runtime, entity); } });
  game.named.register("plat_use", { use: (runtime, entity) => { if (entity.activated) return undefined; entity.activated = true; return platDown(runtime, entity); } });
  game.named.register("plat_center_touch", { touch: (runtime, trigger, other) => {
    if (!runtime.isPlayer(other) || runtime.health(other) <= 0) return undefined;
    const entity = runtime.entity(trigger.owner); if (entity === null) return undefined;
    if (entity.state === "bottom") return platUp(runtime, entity); if (entity.state === "top") return runtime.schedule(entity, 1, runtime.named.action(entity, "plat_go_down")); return undefined;
  } });
  return undefined;
}
