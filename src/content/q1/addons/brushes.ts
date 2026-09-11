/* MG1/MG3 func_bob.qc, func_toss.qc, rotate.qc, misc.qc, misc_model.qc.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { Q1Actor } from "../foundation/entity.ts";
import { ZERO, vadd, vsub, vscale, length, normalize } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

export function registerAddonBrushes(context: Q1AddonContext): undefined {
  const { game } = context, prefix = `${context.program}:brush:`;
  const schedule = (entity: Q1Actor, name: string, delay: number): undefined => game.schedule(entity, delay, game.named.action(entity, prefix + name));
  const pushBrush = (entity: Q1Actor): undefined => { entity.solid = "bsp"; entity.movement = "push"; return game.link(entity); };
  const bobPosition = (entity: Q1Actor, angle: number) => {
    entity.count = Math.fround(Math.fround(entity.count + angle) % 360);
    return vadd(vscale(entity.vector("dest"), Math.fround(Math.sin(entity.count))), vscale(entity.vector("dest2"), Math.fround(Math.cos(entity.count))));
  };
  game.named.register(prefix + "bob_tick", { action: (_game, entity) => game.setOrigin(entity, bobPosition(entity, Math.fround(entity.angularVelocity.x * context.frameTime))) });
  game.named.register(prefix + "bob_think", { action: (_game, entity) => {
    const position = bobPosition(entity, Math.fround(entity.angularVelocity.x * 0.05));
    game.setBody(entity, { velocity: vscale(vsub(position, game.body(entity).origin), 20) }); return schedule(entity, "bob_think", 0.05);
  } });
  game.named.register(prefix + "bob_use", { use: (_game, entity) => {
    const solid = entity.solid !== "none";
    if (entity.activated) {
      if (solid) { game.setBody(entity, { velocity: ZERO }); game.cancel(entity); } else context.removeFrameTick(entity);
    } else if (solid) game.named.action(entity, prefix + "bob_think")();
    else context.addFrameTick(entity, prefix + "bob_tick");
    entity.activated = !entity.activated; return undefined;
  } });
  game.named.register(prefix + "bob_blocked", { blocked: (_game, entity, other) => {
    if (entity.attackFinished > game.time) return undefined;
    game.damage(other, entity.actor.id, entity.actor.id, entity.damage); entity.attackFinished = Math.fround(game.time + 0.5); return undefined;
  } });
  game.registerSpawn("func_bob", (_game, entity) => {
    if (length(entity.vector("dest")) === 0) context.setVector(entity, "dest", { x: 0, y: 0, z: 64 });
    entity.wait ||= 10; entity.damage ||= 1; entity.angularVelocity = { x: Math.fround(360 / entity.wait), y: 0, z: 0 };
    entity.count = Math.fround(360 * entity.delay); entity.use = game.named.use(entity, prefix + "bob_use");
    entity.blocked = game.named.blocked(entity, prefix + "bob_blocked");
    entity.solid = (entity.spawnflags & 1) !== 0 ? "none" : "bsp"; entity.movement = entity.solid === "none" ? "none" : "push";
    if ((entity.spawnflags & 2) !== 0) entity.use(null, null); return undefined;
  });

  game.named.register(prefix + "toss_think", { action: (_game, entity) => {
    if (length(game.body(entity).velocity) < 0.01) {
      if ((entity.spawnflags & 2) !== 0 && ((entity.spawnflags & 8) === 0 || length(vsub(entity.vector("oldorigin"), game.body(entity).origin)) > 64)) return game.remove(entity);
      game.setBody(entity, { velocity: ZERO }); return pushBrush(entity);
    }
    return schedule(entity, "toss_think", 0.5);
  } });
  game.named.register(prefix + "toss", { action: (_game, entity) => {
    const body = game.body(entity); entity.solid = "bbox"; entity.movement = (entity.spawnflags & 4) !== 0 ? "toss" : "bounce";
    game.setBody(entity, { velocity: entity.movedir, bounds: { min: vadd(body.bounds.min, { x: 4, y: 4, z: 0 }), max: body.bounds.max } });
    if (entity.text("noise") !== "") game.sound(entity, entity.text("noise"));
    game.link(entity); return schedule(entity, "toss_think", 0.25);
  } });
  game.named.register(prefix + "toss_use", { use: (_game, entity) => {
    entity.use = null; return entity.delay !== 0 ? schedule(entity, "toss", entity.delay) : game.named.action(entity, prefix + "toss")();
  } });
  game.named.register(prefix + "toss_cascade", { action: (_game, entity) => {
    const bounds = game.body(entity).bounds, position = vscale(vadd(bounds.min, bounds.max), 0.5); let nearest = 16384;
    for (const other of game.entities.values()) if (other.text("netname") === "_toss_origin" && other.targetname === entity.targetname) {
      const otherBounds = game.body(other).bounds;
      nearest = Math.min(nearest, Math.fround(length(vsub(position, vscale(vadd(otherBounds.min, otherBounds.max), 0.5))) / other.speed));
    }
    if (nearest < 16384) entity.delay = nearest; return undefined;
  } });
  game.registerSpawn("func_toss", (_game, entity) => {
    pushBrush(entity); context.setVector(entity, "oldorigin", game.body(entity).origin); entity.movedir = entity.vector("movedir");
    if (length(entity.movedir) === 0) entity.movedir = { x: 0, y: 0, z: 200 };
    const variance = entity.vector("dest");
    if (length(variance) !== 0) entity.movedir = vadd(entity.movedir, { x: (game.host.random() * 2 - 1) * variance.x, y: (game.host.random() * 2 - 1) * variance.y, z: (game.host.random() * 2 - 1) * variance.z });
    entity.use = game.named.use(entity, prefix + "toss_use");
    if ((entity.spawnflags & 1) !== 0) { entity.fields.set("netname", "_toss_origin"); entity.speed ||= 200; return undefined; }
    return entity.delay === 0 ? schedule(entity, "toss_cascade", 0.2) : undefined;
  });
  game.named.register(prefix + "shatter", { use: (_game, entity) => {
    entity.use = null; entity.solid = "none"; entity.movement = "toss"; game.setBody(entity, { velocity: entity.movedir }); return game.link(entity);
  } });
  game.registerSpawn("func_shatter", (_game, entity) => {
    pushBrush(entity); const body = game.body(entity);
    entity.pos1 = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)); entity.pos2 = entity.vector("pos2");
    if (length(entity.pos2) === 0) entity.pos2 = vsub(body.origin, { x: 0, y: 0, z: 100 });
    const difference = vsub(entity.pos1, entity.pos2), distance = length(difference);
    entity.speed = Math.fround(Math.fround((entity.speed || 200) * 10000) / Math.fround(distance * distance)); entity.wait ||= 10;
    entity.movedir = vadd(vscale(normalize(difference), entity.speed), { x: (game.host.random() * 2 - 1) * entity.wait,
      y: (game.host.random() * 2 - 1) * entity.wait, z: (game.host.random() * 2 - 1) * entity.wait });
    entity.use = game.named.use(entity, prefix + "shatter"); return undefined;
  });
  game.named.register(prefix + "debris_fade", { action: (_game, entity) => {
    const alpha = Math.fround(entity.number("alpha", 1) - Math.fround(Math.fround(1 / entity.wait) * context.frameTime)); context.alpha(entity, alpha);
    if (alpha < 0) {
      context.alpha(entity, 1); game.setOrigin(entity, entity.vector("oldorigin")); entity.movement = "toss";
      game.setBody(entity, { velocity: { x: (game.host.random() * 2 - 1) * 8, y: (game.host.random() * 2 - 1) * 8, z: 0 } });
      return schedule(entity, "debris_fade", entity.delay);
    }
    return schedule(entity, "debris_fade", 0.01);
  } });
  game.named.register(prefix + "debris_wake", { action: (_game, entity) => {
    entity.use = null; entity.solid = "none"; entity.movement = "toss"; context.alpha(entity, 1);
    game.setBody(entity, { velocity: { ...game.body(entity).velocity, x: (game.host.random() * 2 - 1) * 8, y: (game.host.random() * 2 - 1) * 8 } });
    game.link(entity); return schedule(entity, "debris_fade", entity.delay);
  } });
  game.named.register(prefix + "debris_wait", { use: (_game, entity) => schedule(entity, "debris_wake", game.host.random()) });
  game.registerSpawn("func_debris", (_game, entity) => {
    pushBrush(entity); context.setVector(entity, "oldorigin", game.body(entity).origin); entity.delay ||= 1.5; entity.wait ||= 0.1;
    entity.movedir = { x: 0, y: 0, z: 200 }; entity.use = game.named.use(entity, prefix + "debris_wait"); return context.alpha(entity, 1);
  });
  game.named.register(prefix + "explode", { action: (_game, entity) => {
    const body = game.body(entity), position = vscale(vadd(body.bounds.min, body.bounds.max), 0.5);
    entity.model = ""; game.setOrigin(entity, position); game.radiusDamage(entity.actor.id, entity.actor.id, 160, null, null);
    game.sound(entity, "weapons/r_exp3.wav"); game.effect("explosion", position); game.useTargets(entity, entity.activator); return game.remove(entity);
  } });
  game.named.register(prefix + "explode_die", { die: (_game, entity, attacker) => {
    entity.damageable = false; entity.activator = attacker; return schedule(entity, "explode", 0.15);
  } });
  game.registerSpawn("func_explode", (_game, entity) => {
    pushBrush(entity); game.setBody(entity, { angles: ZERO }); game.host.combat.setHealth(entity.actor, 20); entity.damageable = true; entity.aimedDamage = true;
    entity.die = game.named.die(entity, prefix + "explode_die"); return undefined;
  });
  game.named.register(prefix + "hurt_use", { use: (_game, entity) => { entity.activated = !entity.activated; entity.attackFinished = 0; return undefined; } });
  game.named.register(prefix + "hurt_touch", { touch: (_game, entity, other) => {
    if (!entity.activated || entity.attackFinished > game.time || game.health(other) <= 0 || !game.host.combat.read(other)?.canTakeDamage) return undefined;
    if (!game.isPlayer(other) && !context.services.isMonster(other)) return undefined;
    game.damage(other, entity.actor.id, game.world?.actor.id ?? null, entity.damage); entity.attackFinished = Math.fround(game.time + entity.wait); return undefined;
  } });
  game.registerSpawn("func_hurt", (_game, entity) => {
    pushBrush(entity); entity.damage ||= 10; entity.wait ||= 0.2; entity.activated = (entity.spawnflags & 1) !== 0;
    entity.use = game.named.use(entity, prefix + "hurt_use"); entity.touch = game.named.touch(entity, prefix + "hurt_touch"); return undefined;
  });
  // The official function unconditionally delegates to func_wall before its obsolete fade code.
  game.registerSpawn("func_fade", (_game, entity) => { entity.use = game.named.use(entity, "func_wall_use"); return pushBrush(entity); });
  game.named.register(prefix + "model_loop", { action: (_game, entity) => {
    entity.frame++; if (entity.frame === entity.number("cnt")) entity.frame = entity.count;
    return schedule(entity, "model_loop", 0.1);
  } });
  game.named.register(prefix + "model_once", { action: (_game, entity) => { entity.frame++; return entity.frame < entity.number("cnt") ? schedule(entity, "model_once", 0.1) : undefined; } });
  game.named.register(prefix + "model_use_once", { use: (_game, entity) => { entity.frame = entity.count; return schedule(entity, "model_once", 0.1); } });
  game.named.register(prefix + "model_use_loop", { use: (_game, entity) => {
    entity.spawnflags ^= 4; return (entity.spawnflags & 4) === 0 ? game.named.action(entity, prefix + "model_loop")() : game.cancel(entity);
  } });
  game.registerSpawn("misc_model", (_game, entity) => {
    if (entity.model === "") throw new Error("misc_model requires a model"); entity.frame = entity.number("frame"); entity.solid = "none";
    if (entity.spawnflags === 0) return undefined;
    if (entity.number("cnt") < entity.frame || entity.targetname === "") throw new Error("misc_model requires a valid frame range and targetname");
    entity.count = entity.frame;
    if ((entity.spawnflags & 2) !== 0) entity.use = game.named.use(entity, prefix + "model_use_once");
    else if ((entity.spawnflags & 5) !== 0) { entity.use = game.named.use(entity, prefix + "model_use_loop"); entity.spawnflags ^= 4; entity.use(null, null); }
    return undefined;
  });
  game.registerSpawn("info_rotate_axis", (_game, entity) => game.remove(entity));
  const rotate = (entity: Q1Actor, scale: number): undefined => {
    const body = game.body(entity), angles = vadd(body.angles, vscale(entity.angularVelocity, Math.fround(context.frameTime * scale)));
    const angle = (value: number): number => value > 360 ? value - Math.ceil((value - 360) / 360) * 360 : value < 0 ? value + Math.ceil(-value / 360) * 360 : value;
    // Source ModAngles mistakenly tests x for the negative-z adjustment.
    return game.setBody(entity, { angles: { x: angle(angles.x), y: angle(angles.y), z: angles.z > 360 ? angle(angles.z) : angles.z } });
  };
  game.named.register(prefix + "rotate_tick", { action: (_game, entity) => rotate(entity, 1) });
  game.named.register(prefix + "rotate_tween", { action: (_game, entity) => {
    entity.speed = Math.min(1, Math.max(0, Math.fround(entity.speed + Math.fround(entity.number("distance") * context.frameTime))));
    if (entity.speed === 0) { context.setNumber(entity, "rotate.state", 0); return context.removeFrameTick(entity); }
    if (entity.speed === 1) { context.setNumber(entity, "rotate.state", 2); entity.fields.set("addon.frameTick", prefix + "rotate_tick"); return rotate(entity, 1); }
    return rotate(entity, entity.speed);
  } });
  game.named.register(prefix + "rotate_use", { use: (_game, entity) => {
    const state = entity.number("rotate.state");
    if (entity.delay <= 0) {
      context.setNumber(entity, "rotate.state", state === 0 ? 2 : 0);
      return state === 0 ? context.addFrameTick(entity, prefix + "rotate_tick") : context.removeFrameTick(entity);
    }
    entity.fields.set("addon.frameTick", prefix + "rotate_tween");
    context.setNumber(entity, "rotate.state", state === 0 || state === 3 ? 1 : 3);
    context.setNumber(entity, "distance", Math.abs(entity.number("distance")) * (state === 0 || state === 3 ? 1 : -1));
    return state === 0 ? context.addFrameTick(entity, prefix + "rotate_tween") : undefined;
  } });
  game.registerSpawn("rotate_object_continuously", (_game, entity) => {
    entity.angularVelocity = entity.vector("avelocity"); if (length(entity.angularVelocity) === 0) entity.angularVelocity = { x: 0, y: 30, z: 0 };
    if (entity.delay > 0) context.setNumber(entity, "distance", 1 / entity.delay);
    entity.solid = (entity.spawnflags & 4) !== 0 ? "bsp" : "none"; entity.movement = entity.solid === "bsp" ? "push" : "none";
    game.setBody(entity, { angles: ZERO }); const pos = entity.vector("pos2"); if (length(pos) !== 0) game.setOrigin(entity, pos);
    entity.use = game.named.use(entity, prefix + "rotate_use"); const off = (entity.spawnflags & 1) !== 0;
    context.setNumber(entity, "rotate.state", off ? 0 : 2); if (!off) { entity.speed = 1; context.addFrameTick(entity, prefix + "rotate_tick"); } return undefined;
  });
  if (context.program === "mg3") {
    game.named.register(prefix + "breakable_stop", { action: (_game, entity) => game.setBody(entity, { velocity: ZERO }) });
    game.named.register(prefix + "breakable_pain", { pain: (_game, entity) => {
      game.host.combat.setHealth(entity.actor, 10000); game.setBody(entity, { velocity: { x: 0, y: 0, z: -20 } }); return schedule(entity, "breakable_stop", entity.number("ltime") + 1 - game.time);
    } });
    game.named.register(prefix + "breakable_die", { die: (_game, entity) => game.remove(entity) });
    game.registerSpawn("func_breakable", (_game, entity) => {
      pushBrush(entity); game.host.combat.setHealth(entity.actor, 10000); entity.maxHealth = 10000; entity.damageable = true; entity.aimedDamage = false;
      entity.pain = game.named.pain(entity, prefix + "breakable_pain"); entity.die = game.named.die(entity, prefix + "breakable_die"); return undefined;
    });
  }
  return undefined;
}
