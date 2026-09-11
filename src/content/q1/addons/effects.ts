/* quakec_mg1/misc_fx.qc, fog.qc and quakec_mg3 variants.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { callbackName } from "../foundation/callbacks.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

export function registerAddonEffects(context: Q1AddonContext): undefined {
  const { game } = context, prefix = `${context.program}:fx:`, random = (): number => Math.fround(game.host.random() * 2 - 1);
  const schedule = (entity: Q1Actor, name: string, delay: number): undefined => game.schedule(entity, delay, game.named.action(entity, prefix + name));
  const spawnUse = (classname: string, name: string, initialize: (entity: Q1Actor) => undefined): undefined => game.registerSpawn(classname, (_game, entity) => {
    if (context.removedOutsideCoop(entity)) return undefined;
    initialize(entity); entity.use = game.named.use(entity, prefix + name); return undefined;
  });
  game.named.register(prefix + "shake", { action: (_game, entity) => {
    if (game.intermission !== null) return undefined;
    const end = entity.number("storednextthink"), start = end - entity.wait;
    if (game.time > end) {
      if ((entity.spawnflags & 1) === 0) game.sound(entity, entity.text("noise1"));
      for (const player of game.host.players()) context.services.emit({ kind: "view-roll", player, roll: 0 });
      return undefined;
    }
    const intensity = Math.fround(entity.damage * (game.time < entity.delay ? (game.time - start) / (entity.wait / 3) : 1));
    for (const player of game.host.players()) context.services.emit({ kind: "punch-angle", player, angles: {
      x: Math.fround(game.host.random() * intensity), y: Math.fround(random() * intensity), z: Math.fround(game.host.random() * intensity),
    } });
    return schedule(entity, "shake", 0.05);
  }, use: (_game, entity) => {
    context.setNumber(entity, "storednextthink", game.time + entity.wait); entity.delay = Math.fround(game.time + entity.wait / 3);
    if ((entity.spawnflags & 1) === 0) game.sound(entity, entity.text("noise"));
    return schedule(entity, "shake", 0.05);
  } });
  spawnUse("trigger_screenshake", "shake", entity => {
    entity.wait ||= 2; entity.damage ||= 3; entity.fields.set("noise", "misc/quake.wav"); entity.fields.set("noise1", "misc/quakeend.wav"); return undefined;
  });
  game.named.register(prefix + "sound", { use: (_game, entity) => entity.text("noise") === "" ? undefined : game.sound(entity, entity.text("noise")) });
  game.registerSpawn("trigger_sound", (_game, entity) => {
    if (entity.text("noise") === "") return game.remove(entity);
    entity.use = game.named.use(entity, prefix + "sound"); return undefined;
  });

  const damageLightning = (entity: Q1Actor, start: Vec3, end: Vec3): undefined => {
    // QC discards normalize's return, then assigns y from the already changed x.
    const difference = vsub(end, start), side = { x: Math.fround(-difference.y * 16), y: Math.fround(-difference.y * 16), z: 0 };
    const hits: ActorId[] = [];
    for (const offset of [ZERO, side, vscale(side, -1)]) {
      const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: entity.actor.id, monsters: true });
      const target = trace.actor;
      if (target === null || hits.some(hit => sameActor(hit, target))) continue;
      hits.push(target); if (!game.host.combat.read(target)?.canTakeDamage) continue;
      game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 225, count: entity.damage * 4 });
      game.damage(target, entity.actor.id, entity.actor.id, entity.damage);
    }
    return undefined;
  };
  game.named.register(prefix + "lightning", { use: (_game, entity, _other, activator) => {
    const targets = game.find(entity.target), chosen = (entity.spawnflags & 1) !== 0 ? Math.floor(targets.length * game.host.random()) : -1;
    for (const [index, target] of targets.entries()) {
      if (chosen >= 0 && chosen !== index) continue;
      const reverse = (entity.spawnflags & 2) !== 0, start = game.body(reverse ? target : entity).origin;
      const trace = game.host.trace({ start, end: game.body(reverse ? entity : target).origin, bounds: POINT, ignore: entity.actor.id, monsters: false });
      if (context.program !== "mg3" || (entity.spawnflags & 16) === 0) game.host.emit({ kind: "sound", actor: target.actor.id, path: entity.text("noise"), channel: "auto", volume: entity.number("volume"), attenuation: 1 });
      const style = entity.number("style");
      context.services.emit({ kind: "lightning", actor: target.actor.id, start, end: trace.end, style: style === 1 ? 1 : style === 2 ? 2 : 3 });
      if (entity.damage !== 0) damageLightning(entity, start, trace.end);
      if ((entity.spawnflags & 4) !== 0 || target.target === "") continue;
      game.useTargets(target, activator);
      if ((entity.spawnflags & 8) === 0 && game.live(target)) {
        const delay = target.delay; target.delay = Math.fround(delay + 0.2); game.useTargets(target, activator); target.delay = delay;
      }
    }
    return undefined;
  } });
  game.registerSpawn("trigger_lightning", (_game, entity) => {
    if (entity.text("noise") === "") entity.fields.set("noise", "misc/power.wav");
    if (entity.number("volume") === 0) context.setNumber(entity, "volume", 1);
    if (context.program === "mg3" && (entity.spawnflags & 16) !== 0) context.setNumber(entity, "volume", 0);
    entity.use = game.named.use(entity, prefix + "lightning"); return undefined;
  });
  game.named.register(prefix + "fade_targets", { action: (_game, entity) => {
    const targets = game.find(entity.target); let count = 0;
    if (!entity.activated) { for (const target of targets) context.alpha(target, 1); entity.activated = true; }
    for (const target of targets) if (game.health(target.actor.id) <= 0) {
      if (target.number("alpha") > 0) { context.alpha(target, Math.fround(target.number("alpha") - context.frameTime / entity.delay)); count++; }
      else game.remove(target);
    }
    return count > 0 ? schedule(entity, "fade_targets", 0) : game.remove(entity);
  } });
  game.named.register(prefix + "fade", { use: (_game, entity) => {
    const manager = game.create("fade_manager"); manager.target = entity.target; manager.delay = entity.delay;
    return schedule(manager, "fade_targets", 0);
  } });
  spawnUse("trigger_fade", "fade", entity => { entity.delay ||= 1; return undefined; });
  game.named.register(prefix + "freeze", { use: (_game, entity) => {
    for (const target of game.find(entity.target)) {
      if (target.number("is_frozen") === 0) {
        context.setNumber(target, "storednextthink", target.nextThink);
        target.fields.set("addon.storedthink", callbackName(target.think) ?? "");
        context.setNumber(target, "addon.frozenDamageable", target.damageable ? 1 : 0); target.damageable = false;
        game.cancel(target); target.think = game.named.action(target, "SUB_Null"); context.setNumber(target, "is_frozen", 1);
      } else {
        const name = target.text("addon.storedthink"), due = target.number("storednextthink");
        target.think = name === "" ? null : game.named.action(target, name);
        if (target.think !== null && due >= 0) game.schedule(target, due - game.time, target.think);
        context.setNumber(target, "storednextthink", -1); context.setNumber(target, "is_frozen", 0);
        target.damageable = target.number("addon.frozenDamageable") !== 0;
      }
    }
    return undefined;
  } });
  spawnUse("trigger_freeze", "freeze", () => undefined);

  game.named.register(prefix + "embers", { action: (_game, entity) => {
    const velocity = game.body(entity).velocity, size = entity.vector("size"), origin = game.body(entity).origin;
    const up = Math.fround(game.host.random() * 2 + 2), direction = { x: Math.fround(random() * velocity.x), y: Math.fround(random() * velocity.y), z: Math.fround(up * velocity.z) };
    game.host.emit({ kind: "particles", origin: { x: origin.x + size.x * random(), y: origin.y + size.y * random(), z: origin.z }, direction, color: 234, count: 2 });
    return schedule(entity, "embers", entity.wait + entity.delay * game.host.random());
  } });
  const spawnEmbers = (_game: typeof game, entity: Q1Actor): undefined => {
    const tall = entity.classname === "particle_embers_tall";
    if (length(entity.vector("size")) === 0) context.setVector(entity, "size", tall ? { x: 40, y: 40, z: 0 } : { x: 128, y: 128, z: 0 });
    entity.wait ||= 0.05; entity.delay ||= 0.1;
    if (length(game.body(entity).velocity) === 0) game.setBody(entity, { velocity: { x: 1, y: 1, z: tall ? 2 : 1 } });
    return schedule(entity, "embers", entity.wait + entity.delay * game.host.random());
  };
  game.registerSpawn("particle_embers", spawnEmbers); game.registerSpawn("particle_embers_tall", spawnEmbers);
  game.named.register(prefix + "tele", { action: (_game, entity) => {
    const direction = normalize({ x: random() * 10, y: random() * 10, z: random() * 5 }), distance = context.program === "mg3" ? entity.number("distance") : 64;
    game.host.emit({ kind: "particles", origin: vadd(game.body(entity).origin, vscale(direction, distance)), direction: vscale(direction, distance * -0.125), color: 3, count: 3 });
    return schedule(entity, "tele", entity.wait + entity.delay * game.host.random());
  } });
  game.registerSpawn("particle_tele", (_game, entity) => {
    entity.delay ||= 0.1; if (entity.number("distance") === 0) context.setNumber(entity, "distance", 64);
    return schedule(entity, "tele", entity.wait + entity.delay * game.host.random());
  });
  game.named.register(prefix + "fountain", { action: (_game, entity) => {
    const velocity = game.body(entity).velocity;
    game.host.emit({ kind: "particles", origin: game.body(entity).origin, direction: { x: random() * velocity.x, y: random() * velocity.y, z: velocity.z }, color: 13, count: 2 });
    return schedule(entity, "fountain", entity.wait + entity.delay * game.host.random());
  }, use: (_game, entity) => schedule(entity, "fountain", 0.1) });
  game.registerSpawn("particle_tele_fountain", (_game, entity) => {
    entity.wait ||= 0.05; entity.delay ||= 0.1;
    if (length(game.body(entity).velocity) === 0) game.setBody(entity, { velocity: { x: 1, y: 1, z: 6 } });
    if ((entity.spawnflags & 1) !== 0) { entity.use = game.named.use(entity, prefix + "fountain"); return undefined; }
    return schedule(entity, "fountain", entity.wait + entity.delay * game.host.random());
  });
  return undefined;
}

export function registerAddonFog(context: Q1AddonContext): undefined {
  const { game } = context, prefix = `${context.program}:fog:`;
  const info = (entity: Q1Actor, field = "fog_info_entity"): Q1Actor | null => {
    const name = entity.text(field); if (name === "") return null;
    const source = game.find(name)[0]; return source?.classname === "info_fog" ? source : null;
  };
  const setFog = (player: ActorId, density: number, color: Vec3, duration: number): undefined => {
    context.setPlayerNumber(player, "fog_density", density);
    context.setPlayerNumber(player, "fog_color_x", color.x); context.setPlayerNumber(player, "fog_color_y", color.y); context.setPlayerNumber(player, "fog_color_z", color.z);
    return context.services.emit({ kind: "fog", player, density, color, duration, skyFactor: 0 });
  };
  const activate = (entity: Q1Actor, player: ActorId | null): undefined => {
    if (player === null || !game.isPlayer(player)) return undefined;
    const previous = context.playerReference(player, "fog.active");
    if (previous !== null && sameActor(previous, entity.actor.id)) return undefined;
    context.setPlayerReference(player, "fog.active", entity.actor.id);
    const source = info(entity); if (source === null) return undefined;
    const density = source.number("fog_density"), color = source.vector("fog_color");
    return density !== 0 || length(color) !== 0 || (source.spawnflags & 1) !== 0 ? setFog(player, density, color, entity.delay) : undefined;
  };
  game.named.register(prefix + "activate", { touch: (_game, entity, other) => activate(entity, other), use: (_game, entity, other) => activate(entity, other) });
  game.registerSpawn("info_fog", (_game, entity) => {
    if (entity.number("fog_density") === 0) context.setNumber(entity, "fog_density", 0.05);
    else { const color = entity.vector("fog_color"); if (color.x > 1 || color.y > 1 || color.z > 1) context.setVector(entity, "fog_color", vscale(color, 1 / 255)); }
    return undefined;
  });
  game.registerSpawn("trigger_fog", (_game, entity) => {
    if (game.options.coop || game.options.deathmatch !== 0) return game.remove(entity);
    entity.delay ||= 0.5; context.initTrigger(entity); entity.use = game.named.use(entity, prefix + "activate");
    if ((entity.spawnflags & 1) === 0) entity.touch = game.named.touch(entity, prefix + "activate"); return undefined;
  });
  game.named.register(prefix + "transition", { touch: (_game, entity, player) => {
    if (!game.isPlayer(player)) return undefined;
    const body = game.host.bodies.read(player); if (body === null) return undefined;
    const bounds = game.body(entity).bounds, size = vsub(bounds.max, bounds.min), position = vsub(body.origin, bounds.min), axis = entity.number("style");
    const tween = Math.min(1, Math.max(0, axis === 0 ? position.x / size.x : axis === 1 ? position.y / size.y : position.z / size.z));
    const first = info(entity), second = info(entity, "target");
    const density = (1 - tween) * (first?.number("fog_density") ?? 0) + tween * (second?.number("fog_density") ?? 0);
    const color = vadd(vscale(first?.vector("fog_color") ?? ZERO, 1 - tween), vscale(second?.vector("fog_color") ?? ZERO, tween));
    return setFog(player, density, color, 0);
  } });
  game.registerSpawn("trigger_fog_transition", (_game, entity) => {
    if (game.options.coop || game.options.deathmatch !== 0) return game.remove(entity);
    const axis = entity.number("style"); if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error("Invalid style for trigger_fog_transition");
    context.initTrigger(entity); entity.touch = game.named.touch(entity, prefix + "transition"); return undefined;
  });
  return undefined;
}
