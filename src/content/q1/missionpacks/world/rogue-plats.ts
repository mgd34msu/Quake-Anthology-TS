/* newplats.qc / elevatr.qc. Copyright id Software / Rogue. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import { moveDirection } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, dot, vadd, vsub, vscale } from "../../foundation/types.ts";
import { brush, later, number } from "./common.ts";

function move(game: Q1EntityServices, entity: Q1Actor, up: boolean): undefined {
  game.sound(entity, entity.text("noise"), "voice"); entity.state = up ? "up" : "down";
  return game.calcMove(entity, up ? entity.pos1 : entity.pos2, entity.speed, game.named.action(entity, up ? "rogue:plat_top" : "rogue:plat_bottom"));
}
function elevatorGo(game: Q1EntityServices, entity: Q1Actor): undefined {
  game.sound(entity, entity.text("noise"), "voice"); entity.state = "up"; number(entity, "elevatorLastUse", game.time);
  return game.calcMove(entity, { ...entity.pos2, z: entity.pos2.z + entity.number("height") * entity.number("elevatorToFloor") }, entity.speed, game.named.action(entity, "rogue:elevator_stop"));
}
function buttonFire(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (entity.state === "up" || entity.state === "top") return undefined; game.sound(entity, entity.text("noise"), "voice"); entity.state = "up";
  return game.calcMove(entity, entity.pos2, entity.speed, game.named.action(entity, "rogue:elvbutton_wait"));
}
export function registerRoguePlats(game: Q1EntityServices): undefined {
  for (const up of [true, false]) {
    game.named.register(up ? "rogue:plat_up" : "rogue:plat_down", { action: (g, e) => move(g, e, up) });
    game.named.register(up ? "rogue:plat_top" : "rogue:plat_bottom", { action: (g, e) => {
      g.sound(e, e.text("noise1"), "voice"); e.state = up ? "top" : "bottom";
      if ((e.spawnflags & 1) !== 0 && !up) return later(g, e, g.health(e.actor.id), "rogue:plat_up");
      if ((e.spawnflags & 16) === 0) return undefined;
      number(e, "plat2LastMove", g.time);
      if (e.number("plat2Called") === 1) { number(e, "plat2Called", 0); number(e, "plat2LastMove", 0); return later(g, e, 1.5, up ? "rogue:plat_down" : "rogue:plat_up"); }
      if (up !== ((e.spawnflags & 8) !== 0)) { number(e, "plat2Called", 0); return later(g, e, e.delay, up ? "rogue:plat_down" : "rogue:plat_up"); } return undefined;
    } });
  }
  game.named.register("rogue:plat_blocked", { blocked: (g, e, other) => { g.damage(other, e.actor.id, e.actor.id, 1); if (e.state !== "up" && e.state !== "down") throw new Error("plat_new_crush: bad self.state"); return move(g, e, e.state === "down"); } });
  game.named.register("rogue:plat_use", { use: (g, e) => { if ((e.spawnflags & 1) !== 0) return e.state === "top" ? move(g, e, false) : undefined; return e.state === "top" ? move(g, e, false) : e.state === "bottom" ? move(g, e, true) : undefined; } });
  game.named.register("rogue:elevator_stop", { action: (g, e) => { number(e, "elevatorOnFloor", e.number("elevatorToFloor")); g.sound(e, e.text("noise1"), "voice"); e.state = "bottom"; return number(e, "elevatorLastUse", g.time); } });
  game.named.register("rogue:elevator_blocked", { blocked: (g, e) => { number(e, "elevatorToFloor", e.number("elevatorOnFloor")); return elevatorGo(g, e); } });
  game.named.register("rogue:elevator_use", { use: (g, e, other) => {
    if (e.number("elevatorLastUse") + 2 > g.time) return undefined; number(e, "elevatorLastUse", g.time);
    const direction = g.world?.number("rogue:elvButnDir") ?? 0; if (direction === 0) return undefined;
    const button = g.entity(other) ?? g.world; if (button === null) return undefined; const body = g.body(e), otherBody = g.body(button);
    const position = body.origin.z + (body.bounds.min.z + body.bounds.max.z) / 2, buttonPosition = otherBody.origin.z + (otherBody.bounds.min.z + otherBody.bounds.max.z) / 2, height = e.number("height"), floor = e.number("elevatorOnFloor");
    if (position > buttonPosition) number(e, "elevatorToFloor", floor - Math.ceil((position - buttonPosition) / height));
    else if (buttonPosition - position > height) number(e, "elevatorToFloor", floor + Math.floor((buttonPosition - position) / height));
    else if (direction === -1 && floor > 0) number(e, "elevatorToFloor", floor - 1);
    else if (direction === 1 && floor < e.number("cnt") - 1) number(e, "elevatorToFloor", floor + 1); else return undefined;
    return elevatorGo(g, e);
  } });
  game.named.register("rogue:plat2_enable", { use: (_g, e) => { number(e, "plat2Disabled", 0); e.use = null; return undefined; } });
  game.named.register("rogue:plat2_center", { touch: (g, trigger, other) => {
    if (!g.isPlayer(other) || g.health(other) <= 0) return undefined; const e = g.entity(trigger.owner), body = g.host.bodies.read(other); if (e === null || body === null || e.number("plat2LastMove") + 2 > g.time || e.number("plat2Disabled") !== 0) return undefined;
    const pending = e.number("plat2GoTo"); if (pending > 0) { if (e.number("plat2GoTime") < g.time) { move(g, e, pending === 1); number(e, "plat2GoTo", 0); } return undefined; }
    if (e.state === "up" || e.state === "down") return undefined;
    const platform = g.body(e), center = platform.origin.z + (platform.bounds.min.z + platform.bounds.max.z) / 2;
    const sameLevel = e.state === "top" ? center <= body.origin.z : body.origin.z - center <= e.number("height");
    number(e, "plat2Called", sameLevel ? 0 : 1); number(e, "plat2GoTime", g.time + (sameLevel ? 0.5 : 0.1)); number(e, "plat2GoTo", e.state === "bottom" ? 1 : 2); return undefined;
  } });
  game.registerSpawn("func_new_plat", (g, e) => {
    brush(g, e); e.speed ||= 150; e.sounds ||= 2; if (e.sounds === 1 || e.sounds === 2) { e.fields.set("noise", e.sounds === 1 ? "plats/plat1.wav" : "plats/medplat1.wav"); e.fields.set("noise1", e.sounds === 1 ? "plats/plat2.wav" : "plats/medplat2.wav"); }
    const body = g.body(e); let height = e.number("height"), negative = height < 0; height = Math.abs(height); if (height === 0) { negative = true; height = body.bounds.max.z - body.bounds.min.z - 8; } number(e, "height", height); e.pos1 = body.origin; e.pos2 = { ...body.origin, z: body.origin.z - height };
    if ((e.spawnflags & 3) !== 0) { e.use = g.named.use(e, "rogue:plat_use"); e.blocked = g.named.blocked(e, "rogue:plat_blocked"); e.state = negative ? "bottom" : "top"; if (negative) g.setOrigin(e, e.pos2); if ((e.spawnflags & 1) !== 0 && g.health(e.actor.id) === 0) g.host.combat.setHealth(e.actor, 5); }
    else if ((e.spawnflags & 4) !== 0) { const floor = (e.spawnflags & 8) !== 0 ? e.number("cnt") - 1 : 0; number(e, "elevatorOnFloor", floor); number(e, "elevatorToFloor", 0); number(e, "elevatorLastUse", 0); if ((e.spawnflags & 8) !== 0) e.pos2 = { ...body.origin, z: body.origin.z - height * (e.number("cnt") - 1) }; else { e.pos1 = { ...body.origin, z: body.origin.z + height * (e.number("cnt") - 1) }; e.pos2 = body.origin; } e.use = g.named.use(e, "rogue:elevator_use"); e.blocked = g.named.blocked(e, "rogue:elevator_blocked"); }
    else if ((e.spawnflags & 16) !== 0) {
      const t = g.create("rogue_plat2_trigger"); t.owner = e.actor.id; t.solid = "trigger"; t.movement = "none"; t.touch = g.named.touch(t, "rogue:plat2_center");
      let min = vadd(body.bounds.min, { x: 25, y: 25, z: 0 }), max = vsub(body.bounds.max, { x: 25, y: 25, z: -8 }); min = { ...min, z: max.z - height - 8 }; if ((e.spawnflags & 1) !== 0) max = { ...max, z: min.z + 8 };
      if (body.bounds.max.x - body.bounds.min.x <= 50) { min = { ...min, x: (body.bounds.min.x + body.bounds.max.x) / 2 }; max = { ...max, x: min.x + 1 }; }
      if (body.bounds.max.y - body.bounds.min.y <= 50) { min = { ...min, y: (body.bounds.min.y + body.bounds.max.y) / 2 }; max = { ...max, y: min.y + 1 }; } g.setBounds(t, { min, max });
      for (const key of ["plat2Called", "plat2LastMove", "plat2GoTo", "plat2GoTime"]) number(e, key, 0); e.blocked = g.named.blocked(e, "rogue:plat_blocked"); e.delay ||= 3;
      if (negative) { e.state = "bottom"; e.spawnflags = 16; g.setOrigin(e, e.pos2); } else { e.spawnflags |= 8; e.state = "top"; }
      if (e.targetname !== "") { number(e, "plat2Disabled", 1); e.use = g.named.use(e, "rogue:plat2_enable"); }
    }
    return undefined;
  });
  game.named.register("rogue:elvbutton_wait", { action: (g, e) => { if (g.world !== null) number(g.world, "rogue:elvButnDir", (e.spawnflags & 1) !== 0 ? -1 : 1); e.state = "top"; later(g, e, e.wait, "rogue:elvbutton_return"); g.useTargets(e, e.activator); e.frame = 1; return undefined; } });
  game.named.register("rogue:elvbutton_done", { action: (_g, e) => { e.state = "bottom"; return undefined; } });
  game.named.register("rogue:elvbutton_return", { action: (g, e) => { e.state = "down"; e.frame = 0; if (g.health(e.actor.id) !== 0) e.damageable = true; return g.calcMove(e, e.pos1, e.speed, g.named.action(e, "rogue:elvbutton_done")); } });
  game.named.register("rogue:elvbutton_fire", { use: (g, e, _other, a) => { e.activator = a; return buttonFire(g, e); }, touch: (g, e, other) => { if (!g.isPlayer(other)) return undefined; e.activator = other; return buttonFire(g, e); }, die: (g, e, a) => { e.activator = a; g.host.combat.setHealth(e.actor, e.maxHealth); e.damageable = false; return buttonFire(g, e); } });
  game.registerSpawn("func_elvtr_button", (g, e) => {
    const sounds = ["buttons/airbut1.wav", "buttons/switch21.wav", "buttons/switch02.wav", "buttons/switch04.wav"], sound = sounds[e.sounds]; if (sound !== undefined) e.fields.set("noise", sound);
    e.movedir = moveDirection(g.body(e).angles); g.setBody(e, { angles: ZERO }); e.movement = "push"; e.solid = "bsp"; e.use = g.named.use(e, "rogue:elvbutton_fire");
    if (g.health(e.actor.id) !== 0) { e.maxHealth = g.health(e.actor.id); e.die = g.named.die(e, "rogue:elvbutton_fire"); e.damageable = true; } else e.touch = g.named.touch(e, "rogue:elvbutton_fire");
    e.speed ||= 40; e.wait ||= 1; const body = g.body(e); e.state = "bottom"; e.pos1 = body.origin; e.pos2 = vadd(e.pos1, vscale(e.movedir, Math.abs(dot(e.movedir, vsub(body.bounds.max, body.bounds.min))) - (e.number("lip") || 4))); return undefined;
  });
  return undefined;
}
