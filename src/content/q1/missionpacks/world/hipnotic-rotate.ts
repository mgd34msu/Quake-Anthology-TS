/* hiprot.qc / hipclock.qc. Copyright id Software. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import { moveDirection } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, length, vadd, vscale, vsub } from "../../foundation/types.ts";
import { later, number, targetEvent, vector } from "./common.ts";
import { damageOnTargets, linkRotateTargets, normalizeAngles, rotateTargets, rotateTargetsFinal, setTargetOrigin } from "./rotate-targets.ts";

function continuousThink(game: Q1EntityServices, entity: Q1Actor): undefined {
  let elapsed = game.time - entity.number("ltime"); number(entity, "ltime", game.time);
  const state = entity.number("rotate_state");
  if (state === 2) { entity.count = Math.min(1, entity.count + entity.number("cnt") * elapsed); elapsed *= entity.count; }
  else if (state === 3) {
    entity.count -= entity.number("cnt") * elapsed;
    if (entity.count < 0) { rotateTargetsFinal(game, entity); number(entity, "rotate_state", 1); return game.cancel(entity); }
    elapsed *= entity.count;
  }
  game.setBody(entity, { angles: normalizeAngles(vadd(game.body(entity).angles, vscale(entity.vector("rotate"), elapsed))) });
  rotateTargets(game, entity); return later(game, entity, 0.02, "hip:rotate_entity");
}
function continuousUse(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.frame = 1 - entity.frame; const state = entity.number("rotate_state");
  if (state === 0) {
    if ((entity.spawnflags & 1) !== 0) {
      if (entity.speed !== 0) { entity.count = 1; number(entity, "rotate_state", 3); }
      else { number(entity, "rotate_state", 1); game.cancel(entity); }
    }
  } else if (state === 1) {
    number(entity, "ltime", game.time); entity.count = 0; number(entity, "rotate_state", entity.speed !== 0 ? 2 : 0);
    later(game, entity, 0.02, "hip:rotate_entity");
  } else if (state === 2) { if ((entity.spawnflags & 1) !== 0) number(entity, "rotate_state", 3); }
  else number(entity, "rotate_state", 2);
  return undefined;
}
function reverseDoor(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.frame = 1 - entity.frame; const closing = entity.number("rotate_state") === 7;
  const start = closing ? entity.dest1 : entity.dest2, destination = closing ? entity.dest2 : entity.dest1;
  vector(entity, "dest", destination); number(entity, "rotate_state", closing ? 6 : 7);
  game.sound(entity, entity.text("noise2")); vector(entity, "rotate", vscale(vsub(destination, start), 1 / entity.speed));
  number(entity, "endtime", game.time + entity.speed - (entity.number("endtime") - game.time)); number(entity, "ltime", game.time);
  return later(game, entity, 0.02, "hip:rotate_door");
}
function reverseGroup(game: Q1EntityServices, entity: Q1Actor): undefined {
  const group = entity.text("group");
  for (const member of group === "" ? [entity] : [...game.entities.values()].filter(value => value.text("group") === group && game.live(value))) reverseDoor(game, member);
  return undefined;
}
function trainStop(game: Q1EntityServices, entity: Q1Actor, wait: boolean): undefined {
  const goal = game.entity(entity.references.get("goalentity") ?? null); if (goal === null) throw new Error("rotate_train: missing goal");
  number(entity, "rotate_state", wait ? 0 : 2); game.sound(entity, goal.text("noise") || entity.text("noise"));
  if ((goal.spawnflags & 2) !== 0) { vector(entity, "rotate", ZERO); game.setBody(entity, { angles: entity.vector("finalangle") }); }
  if ((goal.spawnflags & 8) !== 0) vector(entity, "rotate", ZERO);
  if (wait) number(entity, "endtime", entity.number("ltime") + goal.wait); else entity.damage = 0;
  entity.fields.set("think1", "hip:rotate_train_next"); return undefined;
}
function trainNext(game: Q1EntityServices, entity: Q1Actor): undefined {
  number(entity, "rotate_state", 4);
  const current = game.entity(entity.references.get("goalentity") ?? null), target = game.find(entity.text("path"))[0];
  if (current === null || target?.classname !== "path_rotate") throw new Error("rotate_train_next: next target is not path_rotate");
  if (current.text("noise1") !== "") entity.fields.set("noise1", current.text("noise1"));
  game.sound(entity, entity.text("noise1")); entity.references.set("goalentity", target.actor.id); entity.fields.set("path", target.target);
  if (target.target === "") throw new Error("rotate_train_next: no next target");
  entity.fields.set("think1", (target.spawnflags & 4) !== 0 ? "hip:rotate_train_stop" : target.wait !== 0 ? "hip:rotate_train_wait" : "hip:rotate_train_next");
  if (current.text("event") !== "") targetEvent(game, entity, current.text("event"), current.message);
  if ((current.spawnflags & 2) !== 0) { vector(entity, "rotate", ZERO); game.setBody(entity, { angles: entity.vector("finalangle") }); }
  if ((current.spawnflags & 1) !== 0) vector(entity, "rotate", current.vector("rotate"));
  if ((current.spawnflags & 16) !== 0) entity.damage = current.damage;
  if ((current.spawnflags & 64) !== 0) damageOnTargets(game, entity, current.damage);
  const targetBody = game.body(target), body = game.body(entity);
  if (current.speed === -1) {
    game.setOrigin(entity, targetBody.origin); number(entity, "endtime", entity.number("ltime") + 0.01); setTargetOrigin(game, entity);
    if ((target.spawnflags & 2) !== 0) game.setBody(entity, { angles: targetBody.angles });
    number(entity, "duration", 1); number(entity, "cnt", game.time); entity.dest2 = ZERO; entity.dest1 = targetBody.origin;
    return vector(entity, "finaldest", targetBody.origin);
  }
  number(entity, "rotate_state", 1); vector(entity, "finaldest", targetBody.origin);
  const delta = vsub(targetBody.origin, body.origin), distance = length(delta);
  if (distance === 0) {
    game.setBody(entity, { velocity: ZERO }); number(entity, "endtime", entity.number("ltime") + 0.1);
    number(entity, "duration", 1); number(entity, "cnt", game.time); entity.dest2 = ZERO; entity.dest1 = body.origin; return undefined;
  }
  if ((current.spawnflags & 32) === 0 && current.speed > 0) entity.speed = current.speed;
  if ((current.spawnflags & 32) === 0 && entity.speed === 0) throw new Error("rotate_train: no speed defined");
  const travel = (current.spawnflags & 32) !== 0 ? current.speed : distance / entity.speed;
  if (travel < 0.1) {
    game.setBody(entity, { velocity: ZERO, ...((target.spawnflags & 2) !== 0 ? { angles: targetBody.angles } : {}) });
    return number(entity, "endtime", entity.number("ltime") + 0.1);
  }
  const inverse = 1 / travel;
  if ((target.spawnflags & 2) !== 0) { vector(entity, "finalangle", normalizeAngles(targetBody.angles)); vector(entity, "rotate", vscale(vsub(targetBody.angles, game.body(entity).angles), inverse)); }
  number(entity, "endtime", entity.number("ltime") + travel); game.setBody(entity, { velocity: vscale(delta, inverse) });
  number(entity, "duration", inverse); number(entity, "cnt", game.time); entity.dest2 = delta; entity.dest1 = body.origin; return undefined;
}

export function registerHipnoticRotation(game: Q1EntityServices): undefined {
  game.registerSpawn("info_rotate", (g, e) => later(g, e, 2, "SUB_Remove"));
  game.registerSpawn("path_rotate", () => undefined);
  game.registerSpawn("rotate_object", (_g, e) => { e.solid = "none"; e.movement = "none"; return undefined; });
  game.named.register("hip:rotate_entity", { action: continuousThink, use: continuousUse });
  game.named.register("hip:rotate_first", { action: (g, e) => {
    linkRotateTargets(g, e); e.use = g.named.use(e, "hip:rotate_entity"); number(e, "rotate_state", (e.spawnflags & 2) !== 0 ? 0 : 1);
    if ((e.spawnflags & 2) !== 0) { number(e, "ltime", g.time); later(g, e, 0.02, "hip:rotate_entity"); } return undefined;
  } });
  game.registerSpawn("func_rotate_entity", (g, e) => { e.solid = "none"; e.movement = "none"; if (e.speed !== 0) number(e, "cnt", 1 / e.speed); number(e, "ltime", g.time); return later(g, e, 0.1, "hip:rotate_first"); });
  game.named.register("hip:rotate_door", { action: (g, e) => {
    const elapsed = g.time - e.number("ltime"); number(e, "ltime", g.time);
    const moving = g.time < e.number("endtime");
    g.setBody(e, { angles: moving ? vadd(g.body(e).angles, vscale(e.vector("rotate"), elapsed)) : e.vector("dest") }); rotateTargets(g, e);
    return later(g, e, 0.01, moving ? "hip:rotate_door" : "hip:rotate_door_done");
  }, use: (g, e) => {
    const state = e.number("rotate_state"); if (state !== 4 && state !== 5) return undefined;
    if (e.number("cnt") === 0) { number(e, "cnt", 1); linkRotateTargets(g, e); }
    e.frame = 1 - e.frame; const destination = state === 4 ? e.dest2 : e.dest1, start = state === 4 ? e.dest1 : e.dest2;
    vector(e, "dest", destination); number(e, "rotate_state", state === 4 ? 6 : 7); vector(e, "rotate", vscale(vsub(destination, start), 1 / e.speed));
    g.sound(e, e.text("noise2")); number(e, "endtime", g.time + e.speed); number(e, "ltime", g.time); return later(g, e, 0.01, "hip:rotate_door");
  } });
  game.named.register("hip:rotate_door_done", { action: (g, e) => {
    number(e, "ltime", g.time); e.frame = 1 - e.frame; g.setBody(e, { angles: e.vector("dest") });
    if (e.number("rotate_state") === 6) number(e, "rotate_state", 5);
    else if ((e.spawnflags & 1) !== 0) return reverseGroup(g, e); else number(e, "rotate_state", 4);
    g.sound(e, e.text("noise3")); return rotateTargetsFinal(g, e);
  } });
  game.registerSpawn("func_rotate_door", (g, e) => {
    if (e.target === "") throw new Error("rotate_door without target");
    e.dest1 = ZERO; e.dest2 = g.body(e).angles; g.setBody(e, { angles: ZERO }); e.speed ||= 2;
    e.damage = e.damage === 0 ? 2 : Math.max(0, e.damage); number(e, "cnt", 0); number(e, "rotate_state", 4);
    e.sounds ||= 1; e.fields.set("noise2", e.sounds === 2 ? "doors/airdoor1.wav" : e.sounds === 3 ? "doors/basesec1.wav" : "doors/winch2.wav");
    e.fields.set("noise3", e.sounds === 2 ? "doors/airdoor2.wav" : e.sounds === 3 ? "doors/basesec2.wav" : "doors/drclos4.wav");
    e.solid = "none"; e.movement = "none"; e.use = g.named.use(e, "hip:rotate_door"); return undefined;
  });
  game.named.register("hip:movewall", { action: (g, e) => { number(e, "ltime", g.time); return later(g, e, 0.02, "hip:movewall"); },
    touch: (g, e, other) => {
      const owner = g.entity(e.owner); if (owner === null || g.time < owner.attackFinished) return undefined;
      const damage = e.damage || owner.damage; if (damage !== 0) { g.damage(other, e.actor.id, owner.actor.id, damage); owner.attackFinished = g.time + 0.5; } return undefined;
    }, blocked: (g, e, other) => {
      const owner = g.entity(e.owner); if (owner === null || g.time < owner.attackFinished) return undefined;
      owner.attackFinished = g.time + 0.5; if (owner.classname === "func_rotate_door") reverseGroup(g, owner);
      const damage = e.damage || owner.damage; if (damage !== 0) g.damage(other, e.actor.id, owner.actor.id, damage); return undefined;
    } });
  game.registerSpawn("func_movewall", (g, e) => {
    e.movement = "push"; e.solid = (e.spawnflags & 4) !== 0 ? "none" : "bsp"; g.setBody(e, { angles: ZERO });
    if (e.solid === "bsp") e.blocked = g.named.blocked(e, "hip:movewall"); if ((e.spawnflags & 2) !== 0) e.touch = g.named.touch(e, "hip:movewall");
    if ((e.spawnflags & 1) === 0) e.model = ""; number(e, "ltime", g.time); return later(g, e, 0.02, "hip:movewall");
  });
  game.named.register("hip:rotate_train_next", { action: trainNext });
  game.named.register("hip:rotate_train_wait", { action: (g, e) => trainStop(g, e, true) });
  game.named.register("hip:rotate_train_stop", { action: (g, e) => trainStop(g, e, false) });
  game.named.register("hip:rotate_train_find", { action: (g, e) => {
    number(e, "rotate_state", 3); linkRotateTargets(g, e); const target = g.find(e.text("path"))[0];
    if (target?.classname !== "path_rotate") throw new Error("rotate_train_find: next target is not path_rotate");
    e.references.set("goalentity", target.actor.id); if ((target.spawnflags & 2) !== 0) { g.setBody(e, { angles: g.body(target).angles }); vector(e, "finalangle", normalizeAngles(g.body(target).angles)); }
    e.fields.set("path", target.target); g.setOrigin(e, g.body(target).origin); setTargetOrigin(g, e); rotateTargetsFinal(g, e);
    e.fields.set("think1", "hip:rotate_train_next"); number(e, "endtime", e.targetname === "" ? e.number("ltime") + 0.1 : 0);
    number(e, "duration", 1); number(e, "cnt", g.time); e.dest2 = ZERO; e.dest1 = g.body(e).origin; return undefined;
  } });
  game.named.register("hip:rotate_train", { action: (g, e) => {
    const elapsed = g.time - e.number("ltime"); number(e, "ltime", g.time);
    if (e.number("endtime") !== 0 && g.time >= e.number("endtime")) {
      number(e, "endtime", 0); if (e.number("rotate_state") === 1) g.setBody(e, { origin: e.vector("finaldest"), velocity: ZERO });
      if (e.text("think1") !== "") g.named.action(e, e.text("think1"))();
    } else g.setOrigin(e, vadd(e.dest1, vscale(e.dest2, Math.min(1, (g.time - e.number("cnt")) * e.number("duration")))));
    g.setBody(e, { angles: normalizeAngles(vadd(g.body(e).angles, vscale(e.vector("rotate"), elapsed))) }); rotateTargets(g, e);
    return later(g, e, 0.02, "hip:rotate_train");
  }, use: (g, e) => {
    const velocity = g.body(e).velocity;
    if (e.text("think1") === "hip:rotate_train_find" || velocity.x !== 0 || velocity.y !== 0 || velocity.z !== 0) return undefined;
    return e.text("think1") === "" ? undefined : g.named.action(e, e.text("think1"))();
  } });
  game.registerSpawn("func_rotate_train", (g, e) => {
    if (e.target === "") throw new Error("rotate_train without target"); e.speed ||= 100; e.solid = "none"; e.movement = "step";
    if (e.text("noise") === "") e.fields.set("noise", e.sounds === 1 ? "plats/train2.wav" : "misc/null.wav");
    if (e.text("noise1") === "") e.fields.set("noise1", e.sounds === 1 ? "plats/train1.wav" : "misc/null.wav");
    e.use = g.named.use(e, "hip:rotate_train"); e.fields.set("think1", "hip:rotate_train_find"); number(e, "rotate_state", 3);
    number(e, "ltime", g.time); number(e, "endtime", g.time + 0.1); number(e, "duration", 1); number(e, "cnt", 0.1);
    e.dest2 = ZERO; e.dest1 = g.body(e).origin; return later(g, e, 0.1, "hip:rotate_train");
  });
  game.named.register("hip:clock", { action: (g, e) => {
    const pos = (g.time + e.number("cnt")) / e.count, angle = 360 * (pos - Math.floor(pos));
    if (e.text("event") !== "" && e.number("ltime") > angle) targetEvent(g, e, e.text("event"));
    g.setBody(e, { angles: vscale(e.movedir, angle) }); rotateTargetsFinal(g, e); number(e, "ltime", angle); return later(g, e, 1, "hip:clock");
  } });
  game.named.register("hip:clock_first", { action: (g, e) => { linkRotateTargets(g, e); return g.named.action(e, "hip:clock")(); } });
  game.registerSpawn("func_clock", (g, e) => {
    const direction = moveDirection(g.body(e).angles); e.movedir = { x: -direction.y, y: -direction.z, z: -direction.x }; g.setBody(e, { angles: ZERO });
    e.count ||= 60; number(e, "cnt", e.number("cnt") * e.count / 12); number(e, "ltime", g.time); return later(g, e, 0.1, "hip:clock_first");
  });
  return undefined;
}
